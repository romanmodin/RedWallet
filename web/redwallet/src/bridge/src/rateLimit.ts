/**
 * Fixed-window rate limiter.
 *
 * Keyed by client identity (the socket address, or a caller-supplied key in
 * tests). In-memory only: the bridge is a single-process service and does not
 * persist rate-limit state.
 */

export interface RateLimiterOptions {
  readonly max: number;
  readonly windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, Window>();

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
  }

  /** True when the request is allowed; false when the limit is exceeded. */
  allow(key: string, now: number = Date.now()): boolean {
    const existing = this.windows.get(key);
    if (existing === undefined || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.max) return false;
    existing.count += 1;
    return true;
  }

  /** Drop expired windows so the map does not grow without bound. */
  prune(now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}
