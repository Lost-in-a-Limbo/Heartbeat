export type DeviceStatus = "ONLINE" | "OFFLINE";

export const REPORTED_STATUSES = ["OK", "WARN", "ERROR"] as const;
export type ReportedStatus = (typeof REPORTED_STATUSES)[number];

export interface Metrics {
  status?: ReportedStatus;
  cpuUsage?: number;
  signalStrength?: number;
}

export interface StoredMetrics extends Metrics {
  /**
   * Device-reported time of the reading, used only to keep a delayed heartbeat
   * from overwriting newer readings. Kept apart from lastReportedTimestamp so
   * that a metric-less ping with a newer timestamp cannot block a delayed
   * heartbeat whose readings are still newer than the stored ones.
   */
  reportedAt: number | null;
}

export interface Device {
  id: string;
  name: string;
  registeredAt: number;
  /** Server receive time. The only input to liveness. */
  lastHeartbeatAt: number | null;
  /** Newest time the device has claimed. Diagnostic only, never used for liveness. */
  lastReportedTimestamp: number | null;
  lastMetrics: StoredMetrics | null;
}

export interface Heartbeat {
  reportedAt?: number;
  metrics: Metrics;
}

export function newDevice(id: string, name: string, registeredAt: number): Device {
  return {
    id,
    name,
    registeredAt,
    lastHeartbeatAt: null,
    lastReportedTimestamp: null,
    lastMetrics: null,
  };
}

export function deriveStatus(
  lastHeartbeatAt: number | null,
  now: number,
  timeoutMs: number,
): DeviceStatus {
  if (lastHeartbeatAt === null) return "OFFLINE";
  return now - lastHeartbeatAt <= timeoutMs ? "ONLINE" : "OFFLINE";
}

export function applyHeartbeat(device: Device, heartbeat: Heartbeat, receivedAt: number): Device {
  return {
    ...device,
    lastHeartbeatAt: laterOf(device.lastHeartbeatAt, receivedAt),
    lastReportedTimestamp: laterOf(device.lastReportedTimestamp, heartbeat.reportedAt ?? null),
    lastMetrics: nextMetrics(device.lastMetrics, heartbeat),
  };
}

function nextMetrics(stored: StoredMetrics | null, heartbeat: Heartbeat): StoredMetrics | null {
  if (!hasAnyMetric(heartbeat.metrics)) return stored;

  const incomingAt = heartbeat.reportedAt;
  const storedAt = stored?.reportedAt ?? null;

  // A heartbeat without a device timestamp was received just now, so it is the
  // newest reading we have. It inherits the stored ordering key so that a
  // delayed heartbeat older than the previous reading is still rejected.
  if (incomingAt === undefined) return { ...heartbeat.metrics, reportedAt: storedAt };

  if (storedAt !== null && incomingAt < storedAt) return stored;
  return { ...heartbeat.metrics, reportedAt: incomingAt };
}

function hasAnyMetric(metrics: Metrics): boolean {
  return (
    metrics.status !== undefined ||
    metrics.cpuUsage !== undefined ||
    metrics.signalStrength !== undefined
  );
}

function laterOf(existing: number | null, incoming: number | null): number | null {
  if (existing === null) return incoming;
  if (incoming === null) return existing;
  return Math.max(existing, incoming);
}

export interface DeviceSummaryView {
  id: string;
  name: string;
  status: DeviceStatus;
  last_heartbeat: string | null;
}

export interface DeviceView extends DeviceSummaryView {
  registered_at: string;
  last_reported_timestamp: string | null;
  metrics: {
    status: ReportedStatus | null;
    cpu_usage: number | null;
    signal_strength: number | null;
  } | null;
}

export function toDeviceSummaryView(device: Device, now: number, timeoutMs: number): DeviceSummaryView {
  return {
    id: device.id,
    name: device.name,
    status: deriveStatus(device.lastHeartbeatAt, now, timeoutMs),
    last_heartbeat: toIso(device.lastHeartbeatAt),
  };
}

export function toDeviceView(device: Device, now: number, timeoutMs: number): DeviceView {
  const metrics = device.lastMetrics;
  return {
    ...toDeviceSummaryView(device, now, timeoutMs),
    registered_at: new Date(device.registeredAt).toISOString(),
    last_reported_timestamp: toIso(device.lastReportedTimestamp),
    metrics: metrics && {
      status: metrics.status ?? null,
      cpu_usage: metrics.cpuUsage ?? null,
      signal_strength: metrics.signalStrength ?? null,
    },
  };
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
