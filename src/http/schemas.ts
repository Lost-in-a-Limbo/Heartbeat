import { z } from "zod";
import { REPORTED_STATUSES } from "../domain/device.js";
import { ValidationError } from "../domain/errors.js";

// Strict objects reject unknown fields, so a typo like `cpu_usge` fails loudly
// instead of being silently dropped.
export const registerSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/, "must be 1-64 characters of letters, digits, '.', '_' or '-'"),
  name: z.string().trim().min(1, "must not be empty").max(100),
});

export const heartbeatSchema = z.strictObject({
  timestamp: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(REPORTED_STATUSES).optional(),
  cpu_usage: z.number().min(0).max(100).optional(),
  signal_strength: z.number().min(-150).max(0).optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(["ONLINE", "OFFLINE"]).optional(),
});

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.code === "unrecognized_keys" ? [...issue.path, ...issue.keys] : (issue?.path ?? []);
  const field = path.join(".") || undefined;
  const detail = issue?.message ?? "invalid input";
  throw new ValidationError(field ? `${field}: ${detail}` : detail, field);
}
