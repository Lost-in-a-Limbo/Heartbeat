import { z } from "zod";
import { REPORTED_STATUSES } from "../domain/device.js";
import { heartbeatSchema, listQuerySchema, registerSchema } from "./schemas.js";

// Response shapes exist only to document the API; tests check real responses
// against them so the document cannot drift from what the server returns.
const isoOrNull = z.iso.datetime().nullable();

export const deviceSummaryResponse = z.strictObject({
  id: z.string(),
  name: z.string(),
  status: z.enum(["ONLINE", "OFFLINE"]),
  last_heartbeat: isoOrNull.describe("Server receive time of the latest heartbeat"),
});

export const deviceResponse = deviceSummaryResponse.extend({
  registered_at: z.iso.datetime(),
  last_reported_timestamp: isoOrNull.describe("Newest time the device has claimed; never used for status"),
  metrics: z
    .strictObject({
      status: z.enum(REPORTED_STATUSES).nullable(),
      cpu_usage: z.number().nullable(),
      signal_strength: z.number().nullable(),
    })
    .nullable(),
});

export const summaryResponse = z.strictObject({
  total: z.number().int().nonnegative(),
  online: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
});

export const healthResponse = z.strictObject({
  status: z.literal("ok"),
  uptime_seconds: z.number().int().nonnegative(),
});

export const errorResponse = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      "VALIDATION_ERROR",
      "DEVICE_NOT_FOUND",
      "NOT_FOUND",
      "DEVICE_ALREADY_EXISTS",
      "PAYLOAD_TOO_LARGE",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    field: z.string().optional(),
  }),
});

function schema(zodSchema: z.ZodType, io: "input" | "output"): object {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(zodSchema, { io });
  return rest;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (name: string) => ({ content: { "application/json": { schema: ref(name) } } });
const reply = (description: string, name: string) => ({ description, ...body(name) });
const fail = (description: string) => reply(description, "Error");
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Device Fleet Monitor",
    version: "1.0.0",
    description:
      "Tracks devices by heartbeat. A device is ONLINE if its latest heartbeat was received within " +
      "HEARTBEAT_TIMEOUT_MS (default 30 s, inclusive), otherwise OFFLINE. Status is derived on every read.",
  },
  paths: {
    "/devices": {
      post: {
        summary: "Register a device",
        requestBody: { required: true, ...body("RegisterRequest") },
        responses: {
          "201": reply("Registered; OFFLINE until its first heartbeat", "Device"),
          "400": fail("Invalid body"),
          "409": fail("Id already registered"),
        },
      },
      get: {
        summary: "List devices",
        parameters: [{ name: "status", in: "query", required: false, schema: schema(listQuerySchema.shape.status, "input") }],
        responses: {
          "200": { description: "All devices, optionally filtered", content: { "application/json": { schema: { type: "array", items: ref("DeviceSummary") } } } },
          "400": fail("Invalid status filter"),
        },
      },
    },
    "/devices/{id}": {
      get: {
        summary: "Get one device",
        parameters: [idParam],
        responses: { "200": reply("The device", "Device"), "404": fail("Unknown device") },
      },
    },
    "/devices/{id}/heartbeat": {
      post: {
        summary: "Record a heartbeat",
        description:
          "Every field is optional; an empty body is a liveness ping. Stored metrics are replaced only " +
          "by a heartbeat whose device timestamp is equal or newer (or absent).",
        parameters: [idParam],
        requestBody: { required: false, ...body("HeartbeatRequest") },
        responses: {
          "200": reply("Recorded", "Device"),
          "400": fail("Invalid body"),
          "404": fail("Unknown device"),
        },
      },
    },
    "/summary": {
      get: { summary: "Fleet summary", responses: { "200": reply("Counts; total = online + offline", "Summary") } },
    },
    "/healthz": {
      get: { summary: "Health check", responses: { "200": reply("Server is up", "Health") } },
    },
    "/openapi.json": {
      get: { summary: "This document", responses: { "200": { description: "OpenAPI 3.1 document" } } },
    },
  },
  components: {
    schemas: {
      RegisterRequest: schema(registerSchema, "input"),
      HeartbeatRequest: schema(heartbeatSchema, "input"),
      DeviceSummary: schema(deviceSummaryResponse, "output"),
      Device: schema(deviceResponse, "output"),
      Summary: schema(summaryResponse, "output"),
      Health: schema(healthResponse, "output"),
      Error: schema(errorResponse, "output"),
    },
  },
};
