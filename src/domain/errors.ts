export abstract class DomainError extends Error {
  abstract readonly code: string;
}

export class DeviceNotFoundError extends DomainError {
  readonly code = "DEVICE_NOT_FOUND";

  constructor(readonly deviceId: string) {
    super(`No device registered with id '${deviceId}'`);
    this.name = "DeviceNotFoundError";
  }
}

export class DuplicateDeviceError extends DomainError {
  readonly code = "DEVICE_ALREADY_EXISTS";

  constructor(readonly deviceId: string) {
    super(`A device with id '${deviceId}' is already registered`);
    this.name = "DuplicateDeviceError";
  }
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}
