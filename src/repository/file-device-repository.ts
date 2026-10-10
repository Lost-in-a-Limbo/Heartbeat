import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { REPORTED_STATUSES, type Device } from "../domain/device.js";
import { DeviceNotFoundError, DuplicateDeviceError, ValidationError } from "../domain/errors.js";
import type { DeviceRepository } from "./device-repository.js";

const storedDeviceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  registeredAt: z.number(),
  lastHeartbeatAt: z.number().nullable(),
  lastReportedTimestamp: z.number().nullable(),
  lastMetrics: z
    .strictObject({
      status: z.enum(REPORTED_STATUSES).exactOptional(),
      cpuUsage: z.number().exactOptional(),
      signalStrength: z.number().exactOptional(),
      reportedAt: z.number().nullable(),
    })
    .nullable(),
});

const snapshotSchema = z.strictObject({
  version: z.literal(1),
  devices: z.array(storedDeviceSchema),
});

/**
 * Keeps the fleet in memory and writes a full JSON snapshot to disk on every
 * change. Each write goes to a temporary file that is then renamed over the
 * real one, so a crash mid-write leaves the previous snapshot intact rather
 * than a truncated file. The snapshot is written before memory is updated, so
 * a failed write leaves memory and disk agreeing.
 */
export class FileDeviceRepository implements DeviceRepository {
  private readonly devices: Map<string, Device>;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.devices = new Map(load(path).map((device) => [device.id, device]));
  }

  insert(device: Device): void {
    if (this.devices.has(device.id)) throw new DuplicateDeviceError(device.id);
    this.save([...this.devices.values(), device]);
    this.devices.set(device.id, device);
  }

  get(id: string): Device | undefined {
    return this.devices.get(id);
  }

  list(): Device[] {
    return [...this.devices.values()];
  }

  update(id: string, change: (current: Device) => Device): Device {
    const current = this.devices.get(id);
    if (current === undefined) throw new DeviceNotFoundError(id);
    const next = change(current);
    this.save(this.list().map((device) => (device.id === id ? next : device)));
    this.devices.set(id, next);
    return next;
  }

  private save(devices: Device[]): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, devices }));
    renameSync(temporary, this.path);
  }
}

/**
 * A missing file is a first run. An unreadable or malformed file is an error:
 * starting with an empty fleet would silently overwrite the operator's data on
 * the next write.
 */
function load(path: string): Device[] {
  if (!existsSync(path)) return [];
  const invalid = (detail: string) =>
    new ValidationError(`DATA_FILE ${path} is not a valid fleet snapshot: ${detail}`, "DATA_FILE");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const result = snapshotSchema.safeParse(raw);
  if (!result.success) throw invalid(result.error.issues[0]?.message ?? "unexpected shape");
  return result.data.devices;
}
