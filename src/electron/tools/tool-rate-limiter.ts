const callTimestampsByTool = new Map<string, number[]>();

export class ToolRateLimiter {
  constructor(
    private readonly toolName: string,
    private readonly maxCalls: number,
    private readonly windowMs: number,
  ) {}

  check(): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const timestamps = this.getFreshTimestamps(now);

    if (timestamps.length < this.maxCalls) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const oldestTimestamp = timestamps[0] ?? now;
    return {
      allowed: false,
      retryAfterMs: Math.max(oldestTimestamp + this.windowMs - now, 0),
    };
  }

  record() {
    const now = Date.now();
    const timestamps = this.getFreshTimestamps(now);
    timestamps.push(now);
    callTimestampsByTool.set(this.toolName, timestamps);
  }

  /** Drop empty windows so the global map cannot grow without bound. */
  private getFreshTimestamps(now: number) {
    const windowStart = now - this.windowMs;
    const timestamps = callTimestampsByTool.get(this.toolName) ?? [];
    const freshTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);
    if (freshTimestamps.length === 0) {
      callTimestampsByTool.delete(this.toolName);
    } else {
      callTimestampsByTool.set(this.toolName, freshTimestamps);
    }
    return freshTimestamps;
  }
}

/** Test/diagnostics helper — clear all rate-limit windows. */
export function clearAllToolRateLimits() {
  callTimestampsByTool.clear();
}
