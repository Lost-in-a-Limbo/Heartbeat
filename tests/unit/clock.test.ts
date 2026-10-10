import { describe, expect, it } from "vitest";
import { FakeClock, SystemClock } from "../../src/lib/clock.js";

describe("SystemClock", () => {
  it("starts at the wall time it was constructed with", () => {
    const clock = new SystemClock(() => 1_000_000, () => 50);
    expect(clock.now()).toBe(1_000_000);
  });

  it("advances by elapsed monotonic time", () => {
    let mono = 50;
    const clock = new SystemClock(() => 1_000_000, () => mono);
    mono = 2_550;
    expect(clock.now()).toBe(1_002_500);
  });

  it("is unaffected by the wall clock stepping backwards after startup", () => {
    let wall = 1_000_000;
    let mono = 0;
    const clock = new SystemClock(() => wall, () => mono);

    wall -= 60_000;
    mono = 1_000;

    expect(clock.now()).toBe(1_001_000);
  });

  it("never returns a smaller value than its previous reading", () => {
    const clock = new SystemClock();
    let previous = clock.now();
    for (let i = 0; i < 10_000; i++) {
      const current = clock.now();
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("returns whole milliseconds", () => {
    const clock = new SystemClock(() => 1_000, () => 0.25);
    expect(Number.isInteger(clock.now())).toBe(true);
  });
});

describe("FakeClock", () => {
  it("only moves when told to", () => {
    const clock = new FakeClock(500);
    expect(clock.now()).toBe(500);
    clock.advance(30_000);
    expect(clock.now()).toBe(30_500);
    clock.set(10);
    expect(clock.now()).toBe(10);
  });
});
