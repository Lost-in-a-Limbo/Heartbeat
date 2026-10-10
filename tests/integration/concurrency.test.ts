import request from "supertest";
import { describe, expect, it } from "vitest";
import { START, testApp } from "./test-app.js";

describe("concurrent heartbeats", () => {
  it("leaves every device ONLINE with a consistent state after 50 parallel heartbeats", async () => {
    const { app } = testApp();
    const ids = Array.from({ length: 5 }, (_, i) => `device-0${i + 1}`);
    for (const id of ids) await request(app).post("/devices").send({ id, name: id });

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(app)
          .post(`/devices/${ids[i % ids.length]}/heartbeat`)
          .send({ cpu_usage: i }),
      ),
    );
    expect(responses.every((res) => res.status === 200)).toBe(true);

    const devices = (await request(app).get("/devices")).body;
    expect(devices).toHaveLength(5);
    for (const device of devices) {
      expect(device.status).toBe("ONLINE");
      expect(device.last_heartbeat).toBe(new Date(START).toISOString());
    }
    expect((await request(app).get("/summary")).body).toEqual({ total: 5, online: 5, offline: 0 });
  });

  it("registers a contested id exactly once", async () => {
    const { app } = testApp();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/devices").send({ id: "same", name: "Same" })),
    );
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });
});
