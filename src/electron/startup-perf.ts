/**
 * Lightweight startup timing for local development.
 * Enable with MATE_X_PERF_STARTUP=1. No-op when unset.
 */

const ENABLED = process.env.MATE_X_PERF_STARTUP === '1';
const marks = new Map<string, number>();
let origin = 0;

export function startupPerfBegin(label = 'app-ready') {
  if (!ENABLED) return;
  origin = performance.now();
  marks.set(label, origin);
  console.log(`[perf:startup] begin ${label}`);
}

export function startupPerfMark(label: string) {
  if (!ENABLED || origin === 0) return;
  const now = performance.now();
  marks.set(label, now);
  console.log(`[perf:startup] ${label}: ${(now - origin).toFixed(1)}ms`);
}

export function startupPerfSnapshot(): Record<string, number> {
  if (!ENABLED || origin === 0) return {};
  const out: Record<string, number> = {};
  for (const [label, at] of marks) {
    out[label] = Math.round((at - origin) * 10) / 10;
  }
  return out;
}
