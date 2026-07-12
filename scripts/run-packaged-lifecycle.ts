/**
 * Packaged binary lifecycle driver (macOS + Windows).
 *
 * Launches the real packaged executable twice with isolated userData + git fixture:
 *   1) create  — Electron starts, main init, optional GUI/preload, CaptureTask, clean exit
 *   2) recover — relaunch same userData, recover EngineeringTask, mutate fixture, GitGate deny
 *
 * Generates smoke JSON from observed assertions only (never a static success declaration).
 *
 * Usage:
 *   bun run scripts/run-packaged-lifecycle.ts
 *   MATE_X_GUI_LIFECYCLE=1 bun run scripts/run-packaged-lifecycle.ts
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
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { assertSelfTestDisabledInRelease } from '../src/electron/engineering/packaged-self-test';

const root = join(import.meta.dir, '..');

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
            join(root, 'out/MaTE X-win32-x64/MaTE X.exe'),
          ]
        : [];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Fallback: scan out/ for mate-x.exe
  if (process.platform === 'win32' && existsSync(join(root, 'out'))) {
    const stack = [join(root, 'out')];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        const full = join(dir, name);
        try {
          const st = statSync(full);
          if (st.isDirectory()) stack.push(full);
          else if (name.toLowerCase() === 'mate-x.exe') return full;
        } catch {
          /* skip */
        }
      }
    }
  }
  return null;
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function launchPhase(input: {
  binary: string;
  phase: 'create' | 'recover';
  userDataDir: string;
  fixtureRepoDir: string;
  resultPath: string;
  gui: boolean;
  expectedTaskId?: string;
  timeoutMs?: number;
}): {
  status: number | null;
  signal: string | null;
  pid: number | null;
  stdout: string;
  stderr: string;
  result: Record<string, unknown> | null;
  bootStamp: Record<string, unknown> | null;
  durationMs: number;
} {
  const bootStampPath = join(input.userDataDir, `boot-stamp-${input.phase}.json`);
  mkdirSync(input.userDataDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MATE_X_PACKAGED_SELF_TEST: '1',
    MATE_X_RELEASE_BUILD: '0',
    MATE_X_ALLOW_PACKAGED_SELF_TEST: '1',
    MATE_X_TEST_PHASE: input.phase,
    MATE_X_TEST_USER_DATA: input.userDataDir,
    MATE_X_TEST_FIXTURE_REPO: input.fixtureRepoDir,
    MATE_X_TEST_RESULT_PATH: input.resultPath,
    MATE_X_TEST_BOOT_STAMP: bootStampPath,
    MATE_X_PROCESS_BOOT_MS: String(Date.now()),
    ELECTRON_ENABLE_LOGGING: '1',
    // Keep Chromium attached to this process tree on macOS/Windows CI
    ELECTRON_NO_ATTACH_CONSOLE: '0',
  };
  if (input.gui) {
    env.MATE_X_GUI_LIFECYCLE = '1';
  } else {
    env.MATE_X_GUI_LIFECYCLE = '0';
  }
  if (input.expectedTaskId) {
    env.MATE_X_TEST_EXPECTED_TASK_ID = input.expectedTaskId;
  }

  const timeoutMs = input.timeoutMs ?? 120_000;
  const t0 = Date.now();

  // Prefer spawn + poll result file: on macOS .app, helper process models can
  // make spawnSync return before the real main work finishes writing results.
  const child = spawn(input.binary, ['--enable-logging'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk);
  });

  const pid = child.pid ?? null;
  let status: number | null = null;
  let signal: string | null = null;
  let settled = false;

  const waitDone = new Promise<void>((resolve) => {
    child.on('close', (code, sig) => {
      status = code;
      signal = sig;
      settled = true;
      resolve();
    });
    child.on('error', (err) => {
      stderr += `\nspawn error: ${err.message}`;
      status = status ?? 1;
      settled = true;
      resolve();
    });
  });

  // Poll for result JSON (authoritative completion signal)
  const deadline = t0 + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(input.resultPath)) {
      // Small grace for fsync of final fields
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      break;
    }
    if (settled && Date.now() - t0 > 3_000) {
      // Process exited without result — stop waiting
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }

  if (!settled) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Hard kill after grace
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }

  // Wait briefly for close event
  const closeDeadline = Date.now() + 5_000;
  while (!settled && Date.now() < closeDeadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  void waitDone;

  const durationMs = Date.now() - t0;
  const result = readJsonIfExists(input.resultPath);
  const bootStamp = readJsonIfExists(bootStampPath);

  return {
    status: result?.ok === true ? 0 : status,
    signal,
    pid,
    stdout,
    stderr,
    result,
    bootStamp,
    durationMs,
  };
}

function allAssertionsTrue(
  assertions: Record<string, unknown> | undefined,
): boolean {
  if (!assertions || typeof assertions !== 'object') return false;
  const values = Object.values(assertions);
  if (values.length === 0) return false;
  return values.every((v) => v === true);
}

const binary = findPackagedBinary();
// Default ON: prove BrowserWindow + preload + renderer (hidden window is enough for CI).
// Opt out only with MATE_X_GUI_LIFECYCLE=0.
const gui =
  process.env.MATE_X_GUI_LIFECYCLE === '0' ||
  process.env.MATE_X_GUI_LIFECYCLE === 'false'
    ? false
    : true;

const outDir =
  process.platform === 'win32'
    ? join(root, 'artifacts', 'windows')
    : join(root, 'artifacts', 'packaged-e2e');
mkdirSync(outDir, { recursive: true });

const smoke: Record<string, unknown> = {
  platform: process.platform,
  arch: process.arch,
  timestamp: new Date().toISOString(),
  binaryPath: binary,
  binaryHash: binary && existsSync(binary) ? sha256(binary) : null,
  guiRequested: gui,
  releaseSelfTestDisabled: assertSelfTestDisabledInRelease(),
  observed: {},
  assertions: {},
  ok: false,
};

if (!assertSelfTestDisabledInRelease()) {
  smoke.error = 'release self-test negative check failed';
  writeFileSync(
    join(outDir, 'packaged-smoke-result.json'),
    JSON.stringify(smoke, null, 2),
    'utf8',
  );
  console.error(JSON.stringify(smoke, null, 2));
  process.exit(1);
}

if (!binary) {
  smoke.error = 'packaged binary not found under out/';
  writeFileSync(
    join(outDir, 'packaged-smoke-result.json'),
    JSON.stringify(smoke, null, 2),
    'utf8',
  );
  console.error(JSON.stringify(smoke, null, 2));
  process.exit(1);
}

const sessionRoot = mkdtempSync(join(tmpdir(), 'mate-x-lifecycle-'));
const userDataDir = join(sessionRoot, 'userData');
const fixtureRepoDir = join(sessionRoot, 'fixture-repo');
mkdirSync(userDataDir, { recursive: true });
mkdirSync(fixtureRepoDir, { recursive: true });

const createResultPath = join(userDataDir, 'create-result.json');
const recoverResultPath = join(userDataDir, 'recover-result.json');

console.error(`[lifecycle] binary=${binary}`);
console.error(`[lifecycle] userData=${userDataDir}`);
console.error(`[lifecycle] fixture=${fixtureRepoDir}`);
console.error(`[lifecycle] gui=${gui}`);

const createLaunch = launchPhase({
  binary,
  phase: 'create',
  userDataDir,
  fixtureRepoDir,
  resultPath: createResultPath,
  gui,
});

const createResult = createLaunch.result;
const createOk =
  createLaunch.status === 0 &&
  createResult?.ok === true &&
  typeof createResult.engineeringTaskId === 'string';

(smoke.observed as Record<string, unknown>).create = {
  status: createLaunch.status,
  signal: createLaunch.signal,
  pid: createLaunch.pid,
  durationMs: createLaunch.durationMs,
  result: createResult,
  stdoutTail: createLaunch.stdout.slice(-800),
  stderrTail: createLaunch.stderr.slice(-800),
};

if (!createOk) {
  smoke.error = 'create phase failed';
  smoke.ok = false;
  writeFileSync(
    join(outDir, 'packaged-smoke-result.json'),
    JSON.stringify(smoke, null, 2),
    'utf8',
  );
  console.error(JSON.stringify(smoke, null, 2));
  process.exit(createLaunch.status ?? 1);
}

const taskId = String(createResult!.engineeringTaskId);

// Process fully exited — real relaunch boundary
const recoverLaunch = launchPhase({
  binary,
  phase: 'recover',
  userDataDir,
  fixtureRepoDir,
  resultPath: recoverResultPath,
  gui,
  expectedTaskId: taskId,
});

const recoverResult = recoverLaunch.result;
const recoverOk =
  recoverLaunch.status === 0 &&
  recoverResult?.ok === true &&
  recoverResult.taskRecovered === true &&
  recoverResult.engineeringTaskId === taskId;

(smoke.observed as Record<string, unknown>).recover = {
  status: recoverLaunch.status,
  signal: recoverLaunch.signal,
  pid: recoverLaunch.pid,
  durationMs: recoverLaunch.durationMs,
  result: recoverResult,
  stdoutTail: recoverLaunch.stdout.slice(-800),
  stderrTail: recoverLaunch.stderr.slice(-800),
};

// Build assertions strictly from observed process results
const assertions: Record<string, boolean> = {
  binaryExists: existsSync(binary),
  releaseSelfTestDisabled: assertSelfTestDisabledInRelease(),
  electronCreateStarted: createResult?.electronProcessStarted === true,
  electronRecoverStarted: recoverResult?.electronProcessStarted === true,
  mainProcessCreateInit: createResult?.mainProcessInitialized === true,
  mainProcessRecoverInit: recoverResult?.mainProcessInitialized === true,
  libsqlCreateInit: createResult?.libsqlInitialized === true,
  libsqlRecoverInit: recoverResult?.libsqlInitialized === true,
  engineeringTaskCreated: typeof createResult?.engineeringTaskId === 'string',
  createExitClean: createLaunch.status === 0,
  recoverExitClean: recoverLaunch.status === 0,
  taskRecovered: recoverResult?.taskRecovered === true,
  sameTaskId: recoverResult?.engineeringTaskId === taskId,
  realWorkspaceId:
    typeof createResult?.workspaceId === 'string' &&
    !String(createResult.workspaceId).includes('active') &&
    String(createResult.workspaceId).startsWith('ws_'),
  realBranch:
    typeof createResult?.branch === 'string' &&
    String(createResult.branch).length > 0 &&
    String(createResult.branch) !== 'unknown',
  realHeadSha:
    typeof (recoverResult?.headSha ?? createResult?.headSha) === 'string' &&
    String(recoverResult?.headSha ?? createResult?.headSha).length >= 7 &&
    String(recoverResult?.headSha ?? createResult?.headSha) !== 'unknown',
  realPolicyHash:
    typeof (recoverResult?.policyHash ?? createResult?.policyHash) === 'string' &&
    String(recoverResult?.policyHash ?? createResult?.policyHash).length >= 16 &&
    String(recoverResult?.policyHash ?? createResult?.policyHash) !== 'unknown',
  gitGateMissingProofBlocks: recoverResult?.gitGateAllowed === false,
  externalMutationInvalidates: recoverResult?.proofStaleAfterMutation === true,
  gitGateCommitBlocked: recoverResult?.gitGateCommitBlocked === true,
  gitGatePushBlocked: recoverResult?.gitGatePushBlocked === true,
  processRelaunchDistinctPids:
    createLaunch.pid != null &&
    recoverLaunch.pid != null &&
    createLaunch.pid !== recoverLaunch.pid,
};

if (gui) {
  assertions.browserWindowOpenedCreate =
    createResult?.browserWindowOpened === true;
  assertions.browserWindowOpenedRecover =
    recoverResult?.browserWindowOpened === true;
  assertions.preloadInitializedCreate =
    createResult?.preloadInitialized === true;
  assertions.preloadInitializedRecover =
    recoverResult?.preloadInitialized === true;
  assertions.rendererInteractiveCreate =
    createResult?.rendererInteractive === true;
  assertions.rendererInteractiveRecover =
    recoverResult?.rendererInteractive === true;
}

smoke.assertions = assertions;
smoke.engineeringTaskId = taskId;
smoke.workspaceId = createResult?.workspaceId;
smoke.branch = recoverResult?.branch ?? createResult?.branch;
smoke.headSha = recoverResult?.headSha ?? createResult?.headSha;
smoke.policyHash = recoverResult?.policyHash ?? createResult?.policyHash;
smoke.createPid = createLaunch.pid;
smoke.recoverPid = recoverLaunch.pid;
smoke.createExitCode = createLaunch.status;
smoke.recoverExitCode = recoverLaunch.status;
smoke.ok = createOk && recoverOk && allAssertionsTrue(assertions);

const smokePath = join(outDir, 'packaged-smoke-result.json');
writeFileSync(smokePath, JSON.stringify(smoke, null, 2), 'utf8');
console.log(JSON.stringify(smoke, null, 2));

if (!smoke.ok) {
  process.exit(1);
}
process.exit(0);
