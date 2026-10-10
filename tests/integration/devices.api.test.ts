import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { START, testApp } from "./test-app.js";

let app: ReturnType<typeof testApp>["app"];

beforeEach(() => {
  ({ app } = testApp());
});

function register(id = "device-01", name = "Lab Device 01") {
  return request(app).post("/devices").send({ id, name });
}

describe("POST /devices", () => {
  it("returns 201 with the created device", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "device-01",
      name: "Lab Device 01",
      status: "OFFLINE",
      last_heartbeat: null,
      registered_at: new Date(START).toISOString(),
    });
  });

  it("returns 409 for a duplicate id", async () => {
    await register();
    const res = await register("device-01", "Again");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DEVICE_ALREADY_EXISTS");
  });

  it("returns 400 naming the field when id is missing", async () => {
    const res = await request(app).post("/devices").send({ name: "No id" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "id" });
  });

  it.each([
    ["empty", ""],
    ["unsafe characters", "dev/01"],
    ["too long", "x".repeat(65)],
  ])("returns 400 for an id that is %s", async (_label, id) => {
    const res = await register(id);
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("id");
  });

  it("returns 400 for a blank name", async () => {
    const res = await register("device-01", "   ");
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("name");
  });

  it("returns 400 for unknown fields", async () => {
    const res = await request(app).post("/devices").send({ id: "a", name: "A", extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/devices")
      .set("Content-Type", "application/json")
      .send('{"id": "a",');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when the body is missing", async () => {
    const res = await request(app).post("/devices");
    expect(res.status).toBe(400);
  });
});

describe("POST /devices/:id/heartbeat", () => {
  beforeEach(async () => {
    await register();
  });

  it("returns 200 and the device becomes ONLINE", async () => {
    const res = await request(app)
      .post("/devices/device-01/heartbeat")
      .send({ timestamp: "2026-10-10T07:00:00Z", status: "OK", cpu_usage: 42, signal_strength: -71 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ONLINE",
      last_heartbeat: new Date(START).toISOString(),
      last_reported_timestamp: "2026-10-10T07:00:00.000Z",
      metrics: { status: "OK", cpu_usage: 42, signal_strength: -71 },
    });
  });

  it("accepts a heartbeat with no body as a liveness ping", async () => {
    const res = await request(app).post("/devices/device-01/heartbeat");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ONLINE");
  });

  it("returns 404 for an unknown device", async () => {
    const res = await request(app).post("/devices/ghost/heartbeat").send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: "DEVICE_NOT_FOUND",
      message: "No device registered with id 'ghost'",
    });
  });

  it.each([
    ["a malformed timestamp", { timestamp: "yesterday" }, "timestamp"],
    ["a lowercase status", { status: "ok" }, "status"],
    ["cpu_usage below 0", { cpu_usage: -1 }, "cpu_usage"],
    ["cpu_usage above 100", { cpu_usage: 101 }, "cpu_usage"],
    ["signal_strength below -150", { signal_strength: -151 }, "signal_strength"],
    ["signal_strength above 0", { signal_strength: 1 }, "signal_strength"],
    ["a non-numeric cpu_usage", { cpu_usage: "42" }, "cpu_usage"],
    ["a misspelt field", { cpu_usge: 5 }, "cpu_usge"],
  ])("returns 400 for %s", async (_label, body, field) => {
    const res = await request(app).post("/devices/device-01/heartbeat").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    if (field) expect(res.body.error.field).toBe(field);
  });

  it("names the unknown field in the error message", async () => {
    const res = await request(app).post("/devices/device-01/heartbeat").send({ cpu_usge: 5 });
    expect(res.body.error.message).toContain("cpu_usge");
  });

  it.each([
    ["cpu_usage", 0],
    ["cpu_usage", 100],
    ["signal_strength", -150],
    ["signal_strength", 0],
  ])("accepts %s at its boundary value %d", async (field, value) => {
    const res = await request(app).post("/devices/device-01/heartbeat").send({ [field]: value });
    expect(res.status).toBe(200);
  });

  it("accepts a timestamp with a UTC offset", async () => {
    const res = await request(app)
      .post("/devices/device-01/heartbeat")
      .send({ timestamp: "2026-10-10T12:30:00+05:30" });
    expect(res.status).toBe(200);
    expect(res.body.last_reported_timestamp).toBe("2026-10-10T07:00:00.000Z");
  });
});

describe("GET /devices and /devices/:id", () => {
  beforeEach(async () => {
    await register("device-01");
    await register("device-02");
    await request(app).post("/devices/device-01/heartbeat").send({});
  });

  it("lists all devices with derived status", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "device-01", name: "Lab Device 01", status: "ONLINE", last_heartbeat: new Date(START).toISOString() },
      { id: "device-02", name: "Lab Device 01", status: "OFFLINE", last_heartbeat: null },
    ]);
  });

  it("filters by status", async () => {
    const res = await request(app).get("/devices?status=OFFLINE");
    expect(res.body.map((d: { id: string }) => d.id)).toEqual(["device-02"]);
  });

  it("returns 400 for an invalid status filter", async () => {
    const res = await request(app).get("/devices?status=SLEEPING");
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("status");
  });

  it("returns one device with full detail", async () => {
    const res = await request(app).get("/devices/device-01");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("metrics");
    expect(res.body).toHaveProperty("last_reported_timestamp");
  });

  it("returns 404 for an unknown device", async () => {
    const res = await request(app).get("/devices/ghost");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DEVICE_NOT_FOUND");
  });
});

describe("other routes", () => {
  it("reports health", async () => {
    const res = await request(app).get("/healthz");
    expect(res.body).toEqual({ status: "ok", uptime_seconds: 0 });
  });

  it("returns the uniform error shape for an unknown route", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
