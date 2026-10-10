import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { Clock } from "./lib/clock.js";
import { requestLogger, type Logger } from "./lib/logger.js";
import type { DeviceRepository } from "./repository/device-repository.js";
import { errorHandler, notFoundHandler } from "./http/error-handler.js";
import { openApiDocument } from "./http/openapi.js";
import { deviceRoutes } from "./http/routes.js";
import { FleetService, type FleetConfig } from "./services/fleet-service.js";

export interface AppDeps {
  clock: Clock;
  repo: DeviceRepository;
  config: FleetConfig;
  logger: Logger;
}

const publicDir = fileURLToPath(new URL("./public", import.meta.url));

export function buildApp({ clock, repo, config, logger }: AppDeps): Express {
  const service = new FleetService(clock, repo, config, logger);
  const startedAt = clock.now();

  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(logger));
  app.use(express.json({ limit: "10kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", uptime_seconds: Math.floor((clock.now() - startedAt) / 1000) });
  });
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(deviceRoutes(service));
  app.use(express.static(publicDir));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
