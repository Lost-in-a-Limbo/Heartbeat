import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { FakeClock } from "../../src/lib/clock.js";
import { TIMEOUT_MS, testApp } from "./test-app.js";

let app: ReturnType<typeof testApp>["app"];
let clock: FakeClock;

async function statusOf(id: string): Promise<string> {
  return (await request(app).get(`/devices/${id}`)).body.status;
}

beforeEach(async () => {
  ({ app, clock } = testApp());
  await request(app).post("/devices").send({ id: "device-01", name: "One" });
  await request(app).post("/devices/device-01/heartbeat").send({});
});

describe("30-second ONLINE/OFFLINE rule over HTTP", () => {
  it("stays ONLINE exactly at the timeout", async () => {
    clock.advance(TIMEOUT_MS);
    expect(await statusOf("device-01")).toBe("ONLINE");
  });

  it("goes OFFLINE 1 ms past the timeout with no further requests", async () => {
    clock.advance(TIMEOUT_MS + 1);
    expect(await statusOf("device-01")).toBe("OFFLINE");
  });

  it("comes back ONLINE on a fresh heartbeat after going OFFLINE", async () => {
    clock.advance(TIMEOUT_MS + 10_000);
    expect(await statusOf("device-01")).toBe("OFFLINE");

    await request(app).post("/devices/device-01/heartbeat").send({});
    expect(await statusOf("device-01")).toBe("ONLINE");
  });

  it("is reflected in /summary and the list", async () => {
    await request(app).post("/devices").send({ id: "device-02", name: "Two" });
    clock.advance(20_000);
    await request(app).post("/devices/device-02/heartbeat").send({});

    expect((await request(app).get("/summary")).body).toEqual({ total: 2, online: 2, offline: 0 });

    clock.advance(10_001);
    expect((await request(app).get("/summary")).body).toEqual({ total: 2, online: 1, offline: 1 });
    const offline = (await request(app).get("/devices?status=OFFLINE")).body;
    expect(offline.map((d: { id: string }) => d.id)).toEqual(["device-01"]);
  });

  it("keeps a device ONLINE as long as heartbeats keep arriving within the window", async () => {
    for (let i = 0; i < 5; i++) {
      clock.advance(TIMEOUT_MS);
      await request(app).post("/devices/device-01/heartbeat").send({});
    }
    clock.advance(TIMEOUT_MS);
    expect(await statusOf("device-01")).toBe("ONLINE");
  });
});
