import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyHeartbeat, newDevice } from "../../src/domain/device.js";
import { ValidationError } from "../../src/domain/errors.js";
import { FileDeviceRepository } from "../../src/repository/file-device-repository.js";
import { tempPath } from "./temp-path.js";

describe("FileDeviceRepository", () => {
  it("starts empty when the file does not exist yet, without creating it", () => {
    const path = tempPath();
    expect(new FileDeviceRepository(path).list()).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("creates missing parent directories", () => {
    const path = join(dirname(tempPath()), "nested", "deeper", "fleet.json");
    new FileDeviceRepository(path).insert(newDevice("a", "A", 1));
    expect(existsSync(path)).toBe(true);
  });

  it("survives a restart with every field intact, including metrics", () => {
    const path = tempPath();
    const first = new FileDeviceRepository(path);
    first.insert(newDevice("a", "A", 1));
    first.insert(newDevice("b", "B", 2));
    first.update("a", (d) =>
      applyHeartbeat(d, { reportedAt: 900, metrics: { status: "WARN", cpuUsage: 88.5 } }, 1_000),
    );

    const restarted = new FileDeviceRepository(path);
    expect(restarted.list()).toEqual(first.list());
    expect(restarted.get("a")?.lastMetrics).toEqual({ status: "WARN", cpuUsage: 88.5, reportedAt: 900 });
  });

  it("does not write when a duplicate insert is rejected", () => {
    const path = tempPath();
    const repo = new FileDeviceRepository(path);
    repo.insert(newDevice("a", "A", 1));
    const before = readFileSync(path, "utf8");
    expect(() => repo.insert(newDevice("a", "Other", 2))).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("leaves no temporary file behind after a write", () => {
    const path = tempPath();
    new FileDeviceRepository(path).insert(newDevice("a", "A", 1));
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("keeps memory unchanged when a write fails, so memory never runs ahead of disk", () => {
    const path = tempPath();
    const repo = new FileDeviceRepository(path);
    repo.insert(newDevice("a", "A", 1));

    // Replace the data directory with a plain file so every later write fails.
    const dir = dirname(path);
    rmSync(dir, { recursive: true });
    writeFileSync(dir, "");

    expect(() => repo.insert(newDevice("b", "B", 2))).toThrow();
    expect(() => repo.update("a", (d) => applyHeartbeat(d, { metrics: {} }, 5_000))).toThrow();
    expect(repo.list().map((d) => d.id)).toEqual(["a"]);
    expect(repo.get("a")?.lastHeartbeatAt).toBeNull();
  });

  it.each([
    ["is not JSON", "{ not json"],
    ["has the wrong shape", JSON.stringify({ version: 1, devices: [{ id: "a" }] })],
    ["has an unknown version", JSON.stringify({ version: 2, devices: [] })],
    ["has an invalid device status", JSON.stringify({
      version: 1,
      devices: [{
        id: "a", name: "A", registeredAt: 1, lastHeartbeatAt: null, lastReportedTimestamp: null,
        lastMetrics: { status: "BROKEN", reportedAt: null },
      }],
    })],
  ])("refuses to start when the file %s, naming DATA_FILE", (_label, content) => {
    const path = tempPath();
    writeFileSync(path, content);
    expect(() => new FileDeviceRepository(path)).toThrow(ValidationError);
    expect(() => new FileDeviceRepository(path)).toThrow(/DATA_FILE/);
  });
});
