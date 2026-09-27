// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every expiry, retention window and timestamp reads time through a `Clock`,
// so tests (and the test-mode `/__test/clock` endpoint) can move it.

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock that only moves when told to. */
export class ManualClock implements Clock {
  constructor(private current = Date.now()) {}
  now(): number {
    return this.current;
  }
  set(ms: number): void {
    this.current = ms;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/** A clock that follows the system clock plus an adjustable offset — what the
 *  in-process test server uses so timers still run while tests can jump. */
export class OffsetClock implements Clock {
  offsetMs = 0;
  now(): number {
    return Date.now() + this.offsetMs;
  }
}
