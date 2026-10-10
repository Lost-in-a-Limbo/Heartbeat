import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ValidationError } from "../../src/domain/errors.js";

describe("loadConfig", () => {
  it("uses documented defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      heartbeatTimeoutMs: 30_000,
      clockSkewWarnMs: 60_000,
      logLevel: "info",
    });
  });

  it("reads overrides", () => {
    expect(loadConfig({ HEARTBEAT_TIMEOUT_MS: "5000", PORT: "8080" })).toMatchObject({
      heartbeatTimeoutMs: 5000,
      port: 8080,
    });
  });

  it.each(["abc", "0", "-5", "1.5"])("rejects HEARTBEAT_TIMEOUT_MS=%s, naming the variable", (value) => {
    expect(() => loadConfig({ HEARTBEAT_TIMEOUT_MS: value })).toThrow(ValidationError);
    expect(() => loadConfig({ HEARTBEAT_TIMEOUT_MS: value })).toThrow(/HEARTBEAT_TIMEOUT_MS/);
  });

  it("uses in-memory storage when DATA_FILE is unset", () => {
    expect(loadConfig({}).dataFile).toBeUndefined();
  });

  it("reads DATA_FILE", () => {
    expect(loadConfig({ DATA_FILE: "./data/fleet.json" }).dataFile).toBe("./data/fleet.json");
  });

  it("rejects a blank DATA_FILE rather than guessing what was meant", () => {
    expect(() => loadConfig({ DATA_FILE: "  " })).toThrow(/DATA_FILE/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
