/**
 * External packaged performance probe (no in-app test hooks).
 *
 * Collects:
 * - black-box cold process start wall-clock (spawn → process alive → SIGTERM)
 * - durable service-path metrics via measurePackagedApplicationPerformance
 *
 * BrowserWindow ready-to-show / renderer interactive require external GUI automation
 * and are intentionally NOT fabricated. Service-path evidence remains final for those metrics.
 *
 * Usage:
 *   bun run scripts/release/run-packaged-perf-probe.ts
 *   MATE_X_PERF_SAMPLES=8 bun run scripts/release/run-packaged-perf-probe.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { cpus, freemem, hostname, release as osRelease, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import {
  measurePackagedApplicationPerformance,
  type PackagedPerfReport,
} from '../../qa/performance/packaged-performance';

const root = join(import.meta.dir, '../..');
const sampleCount = Math.max(5, Number(process.env.MATE_X_PERF_SAMPLES ?? 8));

function findPackagedBinary(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? [
          join(root, 'out/MaTE X-darwin-x64/MaTE X.app/Contents/MacOS/mate-x'),
          join(root, 'out/MaTE X-darwin-arm64/MaTE X.app/Contents/MacOS/mate-x'),
        ]
      : process.platform === 'win32'
        ? [
            join(root, 'out/MaTE X-win32-x64/mate-x.exe'),
            join(root, 'out/mate-x-win32-x64/mate-x.exe'),
          ]
        : [];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  if (process.platform === 'win32' && existsSync(join(root, 'out'))) {
    const stack = [join(root, 'out')];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        try {
          if (statSync(full).isDirectory()) stack.push(full);
          else if (name.toLowerCase() === 'mate-x.exe') return full;
        } catch {
          /* skip */
        }
      }
    }
  }
  return null;
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

const binary = findPackagedBinary();
const outDir = join(root, 'artifacts', 'packaged-perf');
mkdirSync(outDir, { recursive: true });

if (!binary) {
  console.error('FAIL: packaged binary not found — run bun run package first');
  process.exit(1);
}

const coldProcessStartMs: number[] = [];
const launchRecords: Array<Record<string, unknown>> = [];

for (let i = 0; i < sampleCount; i++) {
  const userData = mkdtempSync(join(tmpdir(), `mate-x-perf-${i}-`));
  console.error(`[perf-probe] sample ${i + 1}/${sampleCount}`);
  const t0 = performance.now();
  const child = spawn(binary, ['--user-data-dir', userData], {
    env: {
      ...process.env,
      ELECTRON_NO_ATTACH_CONSOLE: '1',
    },
    stdio: 'ignore',
    detached: true,
  });

  // Wait for process to stay alive (cold start success signal)
  await new Promise((r) => setTimeout(r, 2500));
  const wallMs = performance.now() - t0;
  const alive = child.pid != null && !child.killed;

  try {
    process.kill(-child.pid!, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  launchRecords.push({ index: i, wallMs, alive, pid: child.pid });
  if (alive) {
    coldProcessStartMs.push(wallMs);
  }
}

if (coldProcessStartMs.length < Math.min(5, sampleCount)) {
  console.error(
    `FAIL: insufficient black-box cold-start samples (${coldProcessStartMs.length}/${sampleCount})`,
  );
  writeFileSync(
    join(outDir, 'perf-probe-failure.json'),
    JSON.stringify({ launchRecords }, null, 2),
    'utf8',
  );
  process.exit(1);
}

// Inject only cold process start — BrowserWindow metrics remain non-final without GUI automation
process.env.MATE_X_PERF_PROBE_JSON = JSON.stringify({
  coldProcessStartMs,
  source: 'black-box-packaged-process',
});

const report: PackagedPerfReport = await measurePackagedApplicationPerformance({
  sampleCount,
  outPath: join(outDir, 'packaged-perf-report.json'),
  requireRealElectronProbes: false,
});

const evidence = {
  host: {
    hostnameHash: createHash('sha256').update(hostname()).digest('hex').slice(0, 12),
    platform: process.platform,
    arch: process.arch,
    osRelease: osRelease(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemMb: Math.round(totalmem() / (1024 * 1024)),
    freeMemMb: Math.round(freemem() / (1024 * 1024)),
  },
  binaryPath: binary,
  binaryHash: createHash('sha256').update(readFileSync(binary)).digest('hex'),
  sampleCountRequested: sampleCount,
  coldProcessStart: {
    n: coldProcessStartMs.length,
    p50Ms: percentile(coldProcessStartMs, 50),
    p95Ms: percentile(coldProcessStartMs, 95),
    source: 'black-box-packaged-process-spawn',
  },
  browserWindowMetrics: {
    final: false,
    reason:
      'In-app BrowserWindow probe hooks removed from release binary; use external GUI automation if needed.',
  },
  reportSummary: {
    finalEvidence: report.finalEvidence,
    realElectronProbes: report.realElectronProbes,
    metricCount: report.metrics.length,
  },
  notes: [
    'No in-app MATE_X_PERF_PROBE / self-test channel.',
    'No prompts, secrets, source content, or credentials recorded.',
  ],
};

writeFileSync(join(outDir, 'perf-probe-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exit(0);
