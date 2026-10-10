import { Router } from "express";
import type { Heartbeat } from "../domain/device.js";
import type { FleetService } from "../services/fleet-service.js";
import { heartbeatSchema, listQuerySchema, parse, registerSchema } from "./schemas.js";

export function deviceRoutes(service: FleetService): Router {
  const router = Router();

  router.post("/devices", (req, res) => {
    const { id, name } = parse(registerSchema, req.body);
    res.status(201).json(service.register(id, name));
  });

  router.get("/devices", (req, res) => {
    const { status } = parse(listQuerySchema, req.query);
    res.json(service.list(status));
  });

  router.get("/devices/:id", (req, res) => {
    res.json(service.get(req.params.id));
  });

  router.post("/devices/:id/heartbeat", (req, res) => {
    // A bare heartbeat with no body is a valid liveness ping.
    const body = parse(heartbeatSchema, req.body ?? {});
    res.json(service.recordHeartbeat(req.params.id, toHeartbeat(body)));
  });

  router.get("/summary", (_req, res) => {
    res.json(service.summary());
  });

  return router;
}

function toHeartbeat(body: ReturnType<typeof heartbeatSchema.parse>): Heartbeat {
  return {
    ...(body.timestamp === undefined ? {} : { reportedAt: Date.parse(body.timestamp) }),
    metrics: {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.cpu_usage === undefined ? {} : { cpuUsage: body.cpu_usage }),
      ...(body.signal_strength === undefined ? {} : { signalStrength: body.signal_strength }),
    },
  };
}
