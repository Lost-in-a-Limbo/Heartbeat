import { describe, expect, it } from "vitest";
import { applyHeartbeat, newDevice, toDeviceView, type Device } from "../../src/domain/device.js";

const REGISTERED_AT = 1_000;

function fresh(): Device {
  return newDevice("device-01", "Lab Device 01", REGISTERED_AT);
}

describe("applyHeartbeat - liveness", () => {
  it("records server receive time as lastHeartbeatAt", () => {
    const device = applyHeartbeat(fresh(), { reportedAt: 5, metrics: {} }, 2_000);
    expect(device.lastHeartbeatAt).toBe(2_000);
  });

  it("never moves lastHeartbeatAt backwards", () => {
    const newer = applyHeartbeat(fresh(), { metrics: {} }, 5_000);
    const after = applyHeartbeat(newer, { metrics: {} }, 4_000);
    expect(after.lastHeartbeatAt).toBe(5_000);
  });

  it("ignores the device timestamp for liveness", () => {
    const device = applyHeartbeat(fresh(), { reportedAt: 999_999_999, metrics: {} }, 2_000);
    expect(device.lastHeartbeatAt).toBe(2_000);
  });

  it("keeps lastReportedTimestamp at the newest claim the device has made", () => {
    const first = applyHeartbeat(fresh(), { reportedAt: 300, metrics: {} }, 2_000);
    const delayed = applyHeartbeat(first, { reportedAt: 200, metrics: {} }, 3_000);
    const untimed = applyHeartbeat(delayed, { metrics: {} }, 4_000);
    expect(untimed.lastReportedTimestamp).toBe(300);
  });
});

describe("applyHeartbeat - metric ordering", () => {
  const withReading = applyHeartbeat(
    fresh(),
    { reportedAt: 100, metrics: { cpuUsage: 10, signalStrength: -60, status: "OK" } },
    2_000,
  );

  it("leaves stored metrics alone for an older device timestamp, but still updates liveness", () => {
    const after = applyHeartbeat(withReading, { reportedAt: 99, metrics: { cpuUsage: 90 } }, 3_000);
    expect(after.lastMetrics?.cpuUsage).toBe(10);
    expect(after.lastHeartbeatAt).toBe(3_000);
  });

  it("overwrites stored metrics for an equal device timestamp", () => {
    const after = applyHeartbeat(withReading, { reportedAt: 100, metrics: { cpuUsage: 20 } }, 3_000);
    expect(after.lastMetrics?.cpuUsage).toBe(20);
  });

  it("overwrites stored metrics for a newer device timestamp", () => {
    const after = applyHeartbeat(withReading, { reportedAt: 101, metrics: { cpuUsage: 30 } }, 3_000);
    expect(after.lastMetrics?.cpuUsage).toBe(30);
  });

  it("treats a heartbeat with no device timestamp as the newest reading", () => {
    const after = applyHeartbeat(withReading, { metrics: { cpuUsage: 40 } }, 3_000);
    expect(after.lastMetrics?.cpuUsage).toBe(40);
  });

  it("still rejects a delayed reading older than one replaced by an untimed heartbeat", () => {
    const untimed = applyHeartbeat(withReading, { metrics: { cpuUsage: 40 } }, 3_000);
    const delayed = applyHeartbeat(untimed, { reportedAt: 50, metrics: { cpuUsage: 99 } }, 4_000);
    expect(delayed.lastMetrics?.cpuUsage).toBe(40);
  });

  it("accepts a delayed reading that is newer than the stored one even after a newer bare ping", () => {
    const ping = applyHeartbeat(withReading, { reportedAt: 500, metrics: {} }, 3_000);
    const delayed = applyHeartbeat(ping, { reportedAt: 200, metrics: { cpuUsage: 55 } }, 4_000);
    expect(delayed.lastMetrics?.cpuUsage).toBe(55);
  });

  it("accepts the first reading regardless of its timestamp", () => {
    const after = applyHeartbeat(fresh(), { reportedAt: 0, metrics: { cpuUsage: 1 } }, 2_000);
    expect(after.lastMetrics?.cpuUsage).toBe(1);
  });
});

describe("applyHeartbeat - partial and empty metrics", () => {
  const withReading = applyHeartbeat(
    fresh(),
    { reportedAt: 100, metrics: { cpuUsage: 10, signalStrength: -60, status: "OK" } },
    2_000,
  );

  it("replaces the whole snapshot when a heartbeat carries only some metrics", () => {
    const after = applyHeartbeat(withReading, { reportedAt: 101, metrics: { cpuUsage: 50 } }, 3_000);
    expect(after.lastMetrics).toEqual({ cpuUsage: 50, reportedAt: 101 });
  });

  it("treats a heartbeat with no metrics as a liveness ping that keeps stored metrics", () => {
    const after = applyHeartbeat(withReading, { reportedAt: 101, metrics: {} }, 3_000);
    expect(after.lastMetrics).toEqual(withReading.lastMetrics);
    expect(after.lastHeartbeatAt).toBe(3_000);
  });
});

describe("applyHeartbeat - purity", () => {
  it("does not mutate the device it was given", () => {
    const device = fresh();
    const snapshot = structuredClone(device);
    applyHeartbeat(device, { reportedAt: 1, metrics: { cpuUsage: 5 } }, 2_000);
    expect(device).toEqual(snapshot);
  });
});

describe("toDeviceView", () => {
  it("presents a never-heard-from device as OFFLINE with null timestamps and metrics", () => {
    const view = toDeviceView(fresh(), 5_000, 30_000);
    expect(view).toEqual({
      id: "device-01",
      name: "Lab Device 01",
      status: "OFFLINE",
      last_heartbeat: null,
      registered_at: new Date(REGISTERED_AT).toISOString(),
      last_reported_timestamp: null,
      metrics: null,
    });
  });

  it("reports absent metric fields as null", () => {
    const device = applyHeartbeat(fresh(), { reportedAt: 1, metrics: { cpuUsage: 42 } }, 2_000);
    expect(toDeviceView(device, 2_000, 30_000).metrics).toEqual({
      status: null,
      cpu_usage: 42,
      signal_strength: null,
    });
  });
});
