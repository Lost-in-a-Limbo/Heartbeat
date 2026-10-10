import type { Device } from "../domain/device.js";
import { DeviceNotFoundError, DuplicateDeviceError } from "../domain/errors.js";
import type { DeviceRepository } from "./device-repository.js";

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly devices = new Map<string, Device>();

  insert(device: Device): void {
    if (this.devices.has(device.id)) throw new DuplicateDeviceError(device.id);
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
    this.devices.set(id, next);
    return next;
  }
}
