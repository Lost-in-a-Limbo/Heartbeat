import { existsSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { SystemClock } from "./lib/clock.js";
import { createLogger } from "./lib/logger.js";
import { InMemoryDeviceRepository } from "./repository/in-memory-device-repository.js";

const SHUTDOWN_GRACE_MS = 10_000;

if (existsSync(".env")) process.loadEnvFile(".env");

function loadConfigOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const config = loadConfigOrExit();

const logger = createLogger(config.logLevel);
const app = buildApp({
  clock: new SystemClock(),
  repo: new InMemoryDeviceRepository(),
  config,
  logger,
});

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs,
      clockSkewWarnMs: config.clockSkewWarnMs,
    },
    "device fleet monitor listening",
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
  // Keep-alive connections can hold close() open indefinitely.
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
