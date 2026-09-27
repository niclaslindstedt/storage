// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Token-bucket rate limiting per key (an IP for unauthenticated routes, a
// device for authenticated ones). Buckets refill continuously; idle buckets
// are dropped so the map cannot grow without bound.

import type { Clock } from "../util/clock.ts";

type Bucket = { tokens: number; at: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly clock: Clock,
    private readonly perMinute: number,
    private readonly burst = Math.max(1, Math.ceil(perMinute / 2)),
  ) {}

  /** Take one token; returns 0 when allowed, else ms until one is available. */
  take(key: string): number {
    const now = this.clock.now();
    this.sweep(now);
    const rate = this.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * rate);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / rate);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) {
      if (now - b.at > 10 * 60_000) this.buckets.delete(k);
    }
  }
}
