import { beforeEach, describe, expect, it } from "vitest";
import { DeviceNotFoundError, DuplicateDeviceError } from "../../src/domain/errors.js";
import { FakeClock } from "../../src/lib/clock.js";
import { InMemoryDeviceRepository } from "../../src/repository/in-memory-device-repository.js";
import { FleetService } from "../../src/services/fleet-service.js";

const START = Date.UTC(2026, 9, 10, 7, 0, 0);
const TIMEOUT = 30_000;

let clock: FakeClock;
let warnings: object[];
let service: FleetService;

beforeEach(() => {
  clock = new FakeClock(START);
  warnings = [];
  service = new FleetService(
    clock,
    new InMemoryDeviceRepository(),
    { heartbeatTimeoutMs: TIMEOUT, clockSkewWarnMs: 60_000 },
    { warn: (details) => warnings.push(details) },
  );
});

describe("FleetService.register", () => {
  it("returns a new device as OFFLINE with no heartbeat", () => {
    const view = service.register("device-01", "Lab Device 01");
    expect(view.status).toBe("OFFLINE");
    expect(view.last_heartbeat).toBeNull();
    expect(view.registered_at).toBe(new Date(START).toISOString());
  });

  it("rejects a duplicate id", () => {
    service.register("device-01", "Lab Device 01");
    expect(() => service.register("device-01", "Other")).toThrow(DuplicateDeviceError);
  });
});

describe("FleetService.recordHeartbeat", () => {
  it("marks the device ONLINE using server receive time", () => {
    service.register("device-01", "Lab Device 01");
    clock.advance(1_000);
    const view = service.recordHeartbeat("device-01", { reportedAt: START - 5_000, metrics: {} });
    expect(view.status).toBe("ONLINE");
    expect(view.last_heartbeat).toBe(new Date(START + 1_000).toISOString());
    expect(view.last_reported_timestamp).toBe(new Date(START - 5_000).toISOString());
  });

  it("rejects a heartbeat from an unregistered device", () => {
    expect(() => service.recordHeartbeat("ghost", { metrics: {} })).toThrow(DeviceNotFoundError);
  });

  it("warns when the device clock is skewed beyond the threshold, but still accepts", () => {
    service.register("device-01", "Lab Device 01");
    const view = service.recordHeartbeat("device-01", { reportedAt: START - 60_001, metrics: {} });
    expect(view.status).toBe("ONLINE");
    expect(warnings).toEqual([{ deviceId: "device-01", skewMs: -60_001 }]);
  });

  it("does not warn when skew is exactly at the threshold", () => {
    service.register("device-01", "Lab Device 01");
    service.recordHeartbeat("device-01", { reportedAt: START + 60_000, metrics: {} });
    expect(warnings).toEqual([]);
  });
});

describe("FleetService.get", () => {
  it("throws for an unknown device", () => {
    expect(() => service.get("ghost")).toThrow(DeviceNotFoundError);
  });
});

describe("FleetService.list and summary", () => {
  beforeEach(() => {
    for (const id of ["a", "b", "c"]) service.register(id, id.toUpperCase());
    service.recordHeartbeat("a", { metrics: {} });
    clock.advance(20_000);
    service.recordHeartbeat("b", { metrics: {} });
    clock.advance(10_001);
  });

  it("derives status per device at read time", () => {
    const statuses = Object.fromEntries(service.list().map((d) => [d.id, d.status]));
    expect(statuses).toEqual({ a: "OFFLINE", b: "ONLINE", c: "OFFLINE" });
  });

  it("filters by status", () => {
    expect(service.list("ONLINE").map((d) => d.id)).toEqual(["b"]);
    expect(service.list("OFFLINE").map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("counts a mixed fleet with total === online + offline", () => {
    expect(service.summary()).toEqual({ total: 3, online: 1, offline: 2 });
  });

  it("reports an empty fleet as all zeros", () => {
    const empty = new FleetService(
      clock,
      new InMemoryDeviceRepository(),
      { heartbeatTimeoutMs: TIMEOUT, clockSkewWarnMs: 60_000 },
      { warn: () => undefined },
    );
    expect(empty.summary()).toEqual({ total: 0, online: 0, offline: 0 });
  });
});
