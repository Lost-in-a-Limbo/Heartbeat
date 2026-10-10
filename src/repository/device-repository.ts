import type { Device } from "../domain/device.js";

export interface DeviceRepository {
  /** Throws DuplicateDeviceError if the id is taken. */
  insert(device: Device): void;
  get(id: string): Device | undefined;
  list(): Device[];
  /**
   * Read-modify-write as a single operation, so that a storage backend can
   * make it atomic. Throws DeviceNotFoundError if the id is unknown.
   */
  update(id: string, change: (current: Device) => Device): Device;
}
