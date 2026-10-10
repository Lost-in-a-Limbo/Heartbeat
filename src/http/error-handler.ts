import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import {
  DeviceNotFoundError,
  DomainError,
  DuplicateDeviceError,
  ValidationError,
} from "../domain/errors.js";
import type { Logger } from "../lib/logger.js";

function statusFor(error: DomainError): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof DeviceNotFoundError) return 404;
  if (error instanceof DuplicateDeviceError) return 409;
  return 500;
}

function sendError(res: Response, status: number, code: string, message: string, field?: string): void {
  res.status(status).json({ error: { code, message, ...(field === undefined ? {} : { field }) } });
}

/** Errors raised by express.json() carry an HTTP status and a `type` tag. */
function isBodyParserError(error: unknown): error is { status: number; type: string } {
  return typeof error === "object" && error !== null && "type" in error && "status" in error;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, "NOT_FOUND", `No route for ${req.method} ${req.path}`);
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    if (error instanceof DomainError) {
      const field = error instanceof ValidationError ? error.field : undefined;
      sendError(res, statusFor(error), error.code, error.message, field);
      return;
    }
    if (isBodyParserError(error) && error.type === "entity.parse.failed") {
      sendError(res, 400, "VALIDATION_ERROR", "Request body is not valid JSON");
      return;
    }
    if (isBodyParserError(error) && error.type === "entity.too.large") {
      sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
      return;
    }
    const log: Logger = res.locals.log ?? logger;
    log.error({ err: error }, "unhandled error");
    sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  };
}
