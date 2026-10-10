import { pino } from "pino";
import { buildApp } from "../../src/app.js";
import { FakeClock } from "../../src/lib/clock.js";
import { InMemoryDeviceRepository } from "../../src/repository/in-memory-device-repository.js";

export const START = Date.UTC(2026, 9, 10, 7, 0, 0);
export const TIMEOUT_MS = 30_000;

export function testApp() {
  const clock = new FakeClock(START);
  const app = buildApp({
    clock,
    repo: new InMemoryDeviceRepository(),
    config: { heartbeatTimeoutMs: TIMEOUT_MS, clockSkewWarnMs: 60_000 },
    logger: pino({ level: "silent" }),
  });
  return { app, clock };
}
