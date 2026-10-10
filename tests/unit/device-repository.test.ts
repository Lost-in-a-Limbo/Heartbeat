import { describe, expect, it } from "vitest";
import { applyHeartbeat, newDevice } from "../../src/domain/device.js";
import { DeviceNotFoundError, DuplicateDeviceError } from "../../src/domain/errors.js";
import type { DeviceRepository } from "../../src/repository/device-repository.js";
import { FileDeviceRepository } from "../../src/repository/file-device-repository.js";
import { InMemoryDeviceRepository } from "../../src/repository/in-memory-device-repository.js";
import { tempPath } from "./temp-path.js";

const implementations: [string, () => DeviceRepository][] = [
  ["InMemoryDeviceRepository", () => new InMemoryDeviceRepository()],
  ["FileDeviceRepository", () => new FileDeviceRepository(tempPath())],
];

describe.each(implementations)("%s contract", (_name, create) => {
  it("stores and returns an inserted device", () => {
    const repo = create();
    const device = newDevice("a", "A", 1);
    repo.insert(device);
    expect(repo.get("a")).toEqual(device);
    expect(repo.list()).toEqual([device]);
  });

  it("returns undefined for an unknown id", () => {
    expect(create().get("ghost")).toBeUndefined();
  });

  it("rejects a duplicate id and keeps the original", () => {
    const repo = create();
    repo.insert(newDevice("a", "A", 1));
    expect(() => repo.insert(newDevice("a", "Other", 2))).toThrow(DuplicateDeviceError);
    expect(repo.get("a")?.name).toBe("A");
  });

  it("applies an update and returns the new state", () => {
    const repo = create();
    repo.insert(newDevice("a", "A", 1));
    const updated = repo.update("a", (d) => applyHeartbeat(d, { metrics: {} }, 500));
    expect(updated.lastHeartbeatAt).toBe(500);
    expect(repo.get("a")?.lastHeartbeatAt).toBe(500);
  });

  it("rejects an update to an unknown id", () => {
    expect(() => create().update("ghost", (d) => d)).toThrow(DeviceNotFoundError);
  });
});
