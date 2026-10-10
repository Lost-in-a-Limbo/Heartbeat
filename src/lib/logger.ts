import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({ level });
}

/** Gives each request a child logger tagged with a request id, and logs the outcome. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = req.get("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", requestId);
    res.locals.log = logger.child({ requestId });
    res.on("finish", () => {
      res.locals.log.info({ method: req.method, url: req.originalUrl, status: res.statusCode }, "request");
    });
    next();
  };
}
