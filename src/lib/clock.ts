import { performance } from "node:perf_hooks";

/** Milliseconds since the Unix epoch. */
export interface Clock {
  now(): number;
}

/**
 * Reads the wall clock once, at construction, and measures everything after
 * that with the monotonic clock. An NTP correction that steps the wall clock
 * backwards would otherwise make a fresh heartbeat look older than one
 * received before it, and could flip a live device to OFFLINE.
 */
export class SystemClock implements Clock {
  private readonly wallAnchor: number;
  private readonly monotonicAnchor: number;

  constructor(
    readWall: () => number = Date.now,
    private readonly readMonotonic: () => number = () => performance.now(),
  ) {
    this.wallAnchor = readWall();
    this.monotonicAnchor = readMonotonic();
  }

  now(): number {
    return this.wallAnchor + Math.floor(this.readMonotonic() - this.monotonicAnchor);
  }
}

export class FakeClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}
