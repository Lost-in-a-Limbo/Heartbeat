import { describe, expect, it } from "vitest";
import { deriveStatus } from "../../src/domain/device.js";

const TIMEOUT = 30_000;
const NOW = 1_000_000;

describe("deriveStatus", () => {
  it("is ONLINE for a heartbeat received 0 ms ago", () => {
    expect(deriveStatus(NOW, NOW, TIMEOUT)).toBe("ONLINE");
  });

  it("is ONLINE for a heartbeat received 29,999 ms ago", () => {
    expect(deriveStatus(NOW - 29_999, NOW, TIMEOUT)).toBe("ONLINE");
  });

  it("is ONLINE for a heartbeat exactly 30,000 ms old (inclusive boundary)", () => {
    expect(deriveStatus(NOW - 30_000, NOW, TIMEOUT)).toBe("ONLINE");
  });

  it("is OFFLINE for a heartbeat 30,001 ms old", () => {
    expect(deriveStatus(NOW - 30_001, NOW, TIMEOUT)).toBe("OFFLINE");
  });

  it("is OFFLINE for a device that has never sent a heartbeat", () => {
    expect(deriveStatus(null, NOW, TIMEOUT)).toBe("OFFLINE");
  });

  it("respects a non-default timeout", () => {
    expect(deriveStatus(NOW - 5_000, NOW, 5_000)).toBe("ONLINE");
    expect(deriveStatus(NOW - 5_001, NOW, 5_000)).toBe("OFFLINE");
  });
});
