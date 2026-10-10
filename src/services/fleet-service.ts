import {
  applyHeartbeat,
  deriveStatus,
  newDevice,
  toDeviceSummaryView,
  toDeviceView,
  type Device,
  type DeviceStatus,
  type DeviceSummaryView,
  type DeviceView,
  type Heartbeat,
} from "../domain/device.js";
import { DeviceNotFoundError } from "../domain/errors.js";
import type { Clock } from "../lib/clock.js";
import type { DeviceRepository } from "../repository/device-repository.js";

export interface FleetConfig {
  heartbeatTimeoutMs: number;
  clockSkewWarnMs: number;
}

export interface SkewLogger {
  warn(details: object, message: string): void;
}

export interface FleetSummary {
  total: number;
  online: number;
  offline: number;
}

export class FleetService {
  constructor(
    private readonly clock: Clock,
    private readonly repo: DeviceRepository,
    private readonly config: FleetConfig,
    private readonly logger: SkewLogger,
  ) {}

  register(id: string, name: string): DeviceView {
    const device = newDevice(id, name, this.clock.now());
    this.repo.insert(device);
    return this.view(device);
  }

  recordHeartbeat(id: string, heartbeat: Heartbeat): DeviceView {
    const receivedAt = this.clock.now();
    const device = this.repo.update(id, (current) => applyHeartbeat(current, heartbeat, receivedAt));
    this.warnOnSkew(id, heartbeat.reportedAt, receivedAt);
    return this.view(device);
  }

  get(id: string): DeviceView {
    const device = this.repo.get(id);
    if (device === undefined) throw new DeviceNotFoundError(id);
    return this.view(device);
  }

  list(status?: DeviceStatus): DeviceSummaryView[] {
    const now = this.clock.now();
    const views = this.repo
      .list()
      .map((device) => toDeviceSummaryView(device, now, this.config.heartbeatTimeoutMs));
    return status === undefined ? views : views.filter((view) => view.status === status);
  }

  summary(): FleetSummary {
    const now = this.clock.now();
    const devices = this.repo.list();
    const online = devices.filter(
      (device) => deriveStatus(device.lastHeartbeatAt, now, this.config.heartbeatTimeoutMs) === "ONLINE",
    ).length;
    return { total: devices.length, online, offline: devices.length - online };
  }

  private view(device: Device): DeviceView {
    return toDeviceView(device, this.clock.now(), this.config.heartbeatTimeoutMs);
  }

  private warnOnSkew(id: string, reportedAt: number | undefined, receivedAt: number): void {
    if (reportedAt === undefined) return;
    const skewMs = reportedAt - receivedAt;
    if (Math.abs(skewMs) > this.config.clockSkewWarnMs) {
      this.logger.warn({ deviceId: id, skewMs }, "device clock skew exceeds threshold");
    }
  }
}
