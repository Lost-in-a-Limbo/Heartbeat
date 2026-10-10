import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  deviceResponse,
  deviceSummaryResponse,
  errorResponse,
  healthResponse,
  summaryResponse,
} from "../../src/http/openapi.js";
import { testApp } from "./test-app.js";

let app: ReturnType<typeof testApp>["app"];

function conforms(schema: z.ZodType, body: unknown): void {
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
}

beforeEach(async () => {
  ({ app } = testApp());
});

describe("GET /openapi.json", () => {
  it("serves an OpenAPI 3.1 document covering every route", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).sort()).toEqual([
      "/devices",
      "/devices/{id}",
      "/devices/{id}/heartbeat",
      "/healthz",
      "/openapi.json",
      "/summary",
    ]);
  });

  it("documents the same request rules the server enforces", async () => {
    const { components } = (await request(app).get("/openapi.json")).body;
    expect(components.schemas.HeartbeatRequest.additionalProperties).toBe(false);
    expect(components.schemas.HeartbeatRequest.properties.cpu_usage).toMatchObject({ minimum: 0, maximum: 100 });
    expect(components.schemas.HeartbeatRequest.properties.status.enum).toEqual(["OK", "WARN", "ERROR"]);
    expect(components.schemas.RegisterRequest.required).toEqual(["id", "name"]);
  });
});

describe("real responses match the documented shapes", () => {
  it("for devices before and after a heartbeat", async () => {
    conforms(deviceResponse, (await request(app).post("/devices").send({ id: "a", name: "A" })).body);
    conforms(deviceResponse, (await request(app).get("/devices/a")).body);

    const beat = await request(app)
      .post("/devices/a/heartbeat")
      .send({ timestamp: "2026-10-10T07:00:00Z", status: "OK", cpu_usage: 1, signal_strength: -1 });
    conforms(deviceResponse, beat.body);
    conforms(deviceResponse, (await request(app).post("/devices/a/heartbeat").send({ cpu_usage: 2 })).body);

    const list = (await request(app).get("/devices")).body as unknown[];
    expect(list).toHaveLength(1);
    for (const item of list) conforms(deviceSummaryResponse, item);
  });

  it("for summary and health", async () => {
    conforms(summaryResponse, (await request(app).get("/summary")).body);
    conforms(healthResponse, (await request(app).get("/healthz")).body);
  });

  it.each([
    ["validation", () => request(app).post("/devices").send({}), 400],
    ["malformed JSON", () => request(app).post("/devices").set("Content-Type", "application/json").send("{"), 400],
    ["unknown device", () => request(app).get("/devices/ghost"), 404],
    ["unknown route", () => request(app).get("/nope"), 404],
    ["oversized body", () => request(app).post("/devices").send({ id: "a", name: "x".repeat(20_000) }), 413],
  ])("for the %s error", async (_label, send, status) => {
    const res = await send();
    expect(res.status).toBe(status);
    conforms(errorResponse, res.body);
  });

  it("for the duplicate error", async () => {
    await request(app).post("/devices").send({ id: "a", name: "A" });
    const res = await request(app).post("/devices").send({ id: "a", name: "A" });
    expect(res.status).toBe(409);
    conforms(errorResponse, res.body);
  });
});
