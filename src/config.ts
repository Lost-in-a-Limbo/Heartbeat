import { z } from "zod";
import { ValidationError } from "./domain/errors.js";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CLOCK_SKEW_WARN_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
});

export interface Config {
  port: number;
  heartbeatTimeoutMs: number;
  clockSkewWarnMs: number;
  logLevel: string;
}

/**
 * Throws on any invalid value rather than falling back to a default: a monitor
 * running with a timeout nobody chose is worse than one that refuses to start.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") ?? "environment";
    throw new ValidationError(`Invalid ${field}: ${issue?.message ?? "invalid value"}`, field);
  }
  const parsed = result.data;
  return {
    port: parsed.PORT,
    heartbeatTimeoutMs: parsed.HEARTBEAT_TIMEOUT_MS,
    clockSkewWarnMs: parsed.CLOCK_SKEW_WARN_MS,
    logLevel: parsed.LOG_LEVEL,
  };
}
