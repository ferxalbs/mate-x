/**
 * Packaged application performance measurements (CLOSURE 5).
 * Does not record source content, prompts, API keys, credentials, raw evidence, or secrets.
 *
 * BrowserWindow ready-to-show / renderer interactive MUST come from real packaged
 * Optional probe JSON via MATE_X_PERF_PROBE_JSON (external QA only).
 * Proxy-derived BrowserWindow values are never labeled as final evidence.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { tmpdir, cpus, totalmem, freemem, hostname, release as osRelease } from 'node:os';

import { EngineeringCommandBus } from '../../src/electron/engineering/command-bus';
import { createPhaseHandler } from '../../src/electron/engineering/phase-handler';
import { LibSqlEngineeringRepository } from '../../src/electron/engineering/repository';
import { ensureDefaultPolicyPack } from '../../src/electron/engineering/policy-pack';

export interface PackagedPerfMetric {
  name: string;
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
  budgetMs: number;
  pass: boolean;
  coldOrWarm: 'cold' | 'warm';
  source: 'real-electron-probe' | 'durable-service-path' | 'proxy-not-final';
}

export interface PackagedPerfReport {
  host: {
    hostnameHash: string;
    platform: string;
    arch: string;
    osRelease: string;
    cpuModel: string;
    cpuCount: number;
    totalMemMb: number;
  };
  packagedArchitecture: string;
  fixtures: {
    small: { pathHash: string; fileCount: number; sizeBytes: number };
    large: { pathHash: string; fileCount: number; sizeBytes: number };
  };
  memory: {
    afterStartupMb: number;
    afterWorkspaceOpenMb: number;
    afterEngineeringCycleMb: number;
  };
  metrics: PackagedPerfMetric[];
  notes: string[];
  realElectronProbes: boolean;
  finalEvidence: boolean;
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

async function collectSamples(
  fn: () => Promise<void> | void,
  n: number,
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

function fixtureStats(dir: string): { fileCount: number; sizeBytes: number } {
  let fileCount = 0;
  let sizeBytes = 0;
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        fileCount += 1;
        sizeBytes += st.size;
      }
    }
  };
  walk(dir);
  return { fileCount, sizeBytes };
}

function makeFixture(root: string, fileCount: number): string {
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    const sub = join(root, `mod-${Math.floor(i / 50)}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `f-${i}.ts`), `export const n${i} = ${i};\n`, 'utf8');
  }
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'perf@mate-x.local'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'perf'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    /* git optional for pure fs stats */
  }
  return root;
}

/**
 * Measure application-path latencies using durable DB + fixture repos.
 * BrowserWindow timings only accepted from MATE_X_PERF_PROBE_JSON real samples.
 */
export async function measurePackagedApplicationPerformance(input?: {
  sampleCount?: number;
  outPath?: string;
  /** When true, refuse proxy BrowserWindow timings — require real probe JSON. */
  requireRealElectronProbes?: boolean;
  /** Override large fixture size (default 400). */
  largeFixtureFiles?: number;
  /** Override small fixture size (default 12). */
  smallFixtureFiles?: number;
}): Promise<PackagedPerfReport> {
  const n = input?.sampleCount ?? 15;
  const requireReal = input?.requireRealElectronProbes === true;
  const root = mkdtempSync(join(tmpdir(), 'mate-x-perf-app-'));
  const smallDir = makeFixture(join(root, 'small'), input?.smallFixtureFiles ?? 12);
  const largeDir = makeFixture(
    join(root, 'large'),
    input?.largeFixtureFiles ?? 400,
  );
  const dbPath = join(root, 'mate-x.db');

  const mem = (label: string) => {
    void label;
    return process.memoryUsage().heapUsed / (1024 * 1024);
  };

  const afterStartupMb = mem('startup');

  const openWorkspace = (dir: string) => {
    fixtureStats(dir);
    try {
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      /* ignore */
    }
  };

  const smallSamples = await collectSamples(() => openWorkspace(smallDir), n);
  const largeSamples = await collectSamples(() => openWorkspace(largeDir), n);

  const afterWorkspaceOpenMb = mem('workspace');

  const repo = LibSqlEngineeringRepository.open(dbPath);
  const bus = new EngineeringCommandBus(repo);
  bus.setPhaseHandler(createPhaseHandler(repo));
  ensureDefaultPolicyPack(repo);

  const cycleSamples = await collectSamples(() => {
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_perf_app',
      objectiveSeed: `perf-cycle-${Math.random().toString(16).slice(2, 8)}`,
    });
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    bus.dispatch({
      type: 'FreezeSpecification',
      engineeringTaskId: id,
      workspaceId: 'ws_perf_app',
      actor: { kind: 'human', userId: 'perf' },
    });
    repo.listTasks('ws_perf_app');
    repo.getTask(id);
  }, n);

  const reloadSamples = await collectSamples(() => {
    repo.listTasks('ws_perf_app');
  }, n);

  const taskVisibleSamples = await collectSamples(() => {
    const tasks = repo.listTasks('ws_perf_app');
    if (tasks[0]) repo.getTask(tasks[0]!.engineeringTaskId);
  }, n);

  const afterEngineeringCycleMb = mem('cycle');

  const coldStartSamples = await collectSamples(() => {
    const p = join(root, `cold-${Math.random().toString(16).slice(2)}.db`);
    const r = LibSqlEngineeringRepository.open(p);
    r.ensureSchema();
    r.close?.();
  }, Math.min(n, 10));

  const notes: string[] = [
    'Service-path measurements for durable stack + workspace fixtures.',
    'No prompts, secrets, source content, or credentials recorded.',
  ];

  const probeEnv = process.env.MATE_X_PERF_PROBE_JSON;
  let coldProcessStart = coldStartSamples;
  let readyToShow: number[] | null = null;
  let rendererInteractive: number[] | null = null;
  let persistedWorkspace = reloadSamples;
  let persistedTask = taskVisibleSamples;
  let realElectronProbes = false;
  let readySource: PackagedPerfMetric['source'] = 'proxy-not-final';
  let rendererSource: PackagedPerfMetric['source'] = 'proxy-not-final';
  let coldSource: PackagedPerfMetric['source'] = 'durable-service-path';

  if (probeEnv) {
    try {
      const probe = JSON.parse(probeEnv) as {
        coldProcessStartMs?: number[];
        readyToShowMs?: number[];
        rendererInteractiveMs?: number[];
        persistedWorkspaceVisibleMs?: number[];
        persistedEngineeringTaskVisibleMs?: number[];
        source?: string;
      };
      if (probe.coldProcessStartMs?.length) {
        coldProcessStart = probe.coldProcessStartMs;
        coldSource = 'real-electron-probe';
      }
      if (probe.readyToShowMs?.length) {
        readyToShow = probe.readyToShowMs;
        readySource = 'real-electron-probe';
        realElectronProbes = true;
      }
      if (probe.rendererInteractiveMs?.length) {
        rendererInteractive = probe.rendererInteractiveMs;
        rendererSource = 'real-electron-probe';
        realElectronProbes = true;
      }
      if (probe.persistedWorkspaceVisibleMs?.length) {
        persistedWorkspace = probe.persistedWorkspaceVisibleMs;
      }
      if (probe.persistedEngineeringTaskVisibleMs?.length) {
        persistedTask = probe.persistedEngineeringTaskVisibleMs;
      }
      if (probe.source === 'packaged-electron-probe' || realElectronProbes) {
        notes.push('Included REAL packaged Electron probe timings (not proxies).');
      } else {
        notes.push('Included probe timings from env.');
      }
    } catch {
      notes.push('MATE_X_PERF_PROBE_JSON present but invalid JSON — ignored.');
    }
  }

  if (requireReal && !realElectronProbes) {
    throw new Error(
      'Real Electron BrowserWindow probes required but MATE_X_PERF_PROBE_JSON missing readyToShowMs/rendererInteractiveMs',
    );
  }

  if (!readyToShow || !rendererInteractive) {
    // Do not fabricate final BrowserWindow evidence. Leave empty samples and mark not-final.
    notes.push(
      'BrowserWindow ready-to-show / renderer interactive NOT final without external GUI automation probe JSON.',
    );
    notes.push('Proxy values intentionally omitted (not labeled as final performance evidence).');
    readyToShow = readyToShow ?? [];
    rendererInteractive = rendererInteractive ?? [];
    readySource = 'proxy-not-final';
    rendererSource = 'proxy-not-final';
  }

  const metric = (
    name: string,
    samples: number[],
    budgetMs: number,
    coldOrWarm: 'cold' | 'warm',
    source: PackagedPerfMetric['source'],
  ): PackagedPerfMetric => {
    const p50 = samples.length ? percentile(samples, 50) : 0;
    const p95 = samples.length ? percentile(samples, 95) : 0;
    return {
      name,
      p50Ms: p50,
      p95Ms: p95,
      sampleCount: samples.length,
      budgetMs,
      pass: samples.length > 0 && p95 <= budgetMs,
      coldOrWarm,
      source,
    };
  };

  const smallStats = fixtureStats(smallDir);
  const largeStats = fixtureStats(largeDir);
  const finalEvidence = realElectronProbes && readyToShow.length > 0 && rendererInteractive.length > 0;

  const report: PackagedPerfReport = {
    host: {
      hostnameHash: createHash('sha256').update(hostname()).digest('hex').slice(0, 12),
      platform: process.platform,
      arch: process.arch,
      osRelease: osRelease(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      totalMemMb: Math.round(totalmem() / (1024 * 1024)),
    },
    packagedArchitecture: `${process.platform}-${process.arch}`,
    fixtures: {
      small: {
        pathHash: createHash('sha256').update(smallDir).digest('hex').slice(0, 12),
        fileCount: smallStats.fileCount,
        sizeBytes: smallStats.sizeBytes,
      },
      large: {
        pathHash: createHash('sha256').update(largeDir).digest('hex').slice(0, 12),
        fileCount: largeStats.fileCount,
        sizeBytes: largeStats.sizeBytes,
      },
    },
    memory: {
      afterStartupMb,
      afterWorkspaceOpenMb,
      afterEngineeringCycleMb,
    },
    metrics: [
      metric('cold_process_start', coldProcessStart, 5000, 'cold', coldSource),
      metric(
        'browser_window_ready_to_show',
        readyToShow,
        8000,
        'cold',
        readySource,
      ),
      metric(
        'renderer_interactive',
        rendererInteractive,
        10000,
        'cold',
        rendererSource,
      ),
      metric(
        'persisted_workspace_visible',
        persistedWorkspace,
        500,
        'warm',
        'durable-service-path',
      ),
      metric(
        'persisted_engineering_task_visible',
        persistedTask,
        500,
        'warm',
        'durable-service-path',
      ),
      metric('workspace_open_small', smallSamples, 2000, 'warm', 'durable-service-path'),
      metric('workspace_open_large', largeSamples, 5000, 'warm', 'durable-service-path'),
      metric('engineering_task_cycle', cycleSamples, 3000, 'warm', 'durable-service-path'),
    ],
    notes,
    realElectronProbes,
    finalEvidence,
  };

  void freemem;

  if (input?.outPath) {
    mkdirSync(join(input.outPath, '..'), { recursive: true });
    writeFileSync(input.outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  repo.close?.();
  return report;
}
