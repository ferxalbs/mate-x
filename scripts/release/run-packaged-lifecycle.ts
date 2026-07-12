/**
 * External packaged lifecycle QA.
 *
 * Release binaries no longer host an in-process self-test channel.
 * This driver:
 *  1) Runs create/recover against production domain modules + LibSQL (process-isolated dirs)
 *  2) Optionally black-box launches the packaged binary with --user-data-dir
 *
 * Usage:
 *   bun run scripts/release/run-packaged-lifecycle.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  assertSelfTestDisabledInRelease,
  runPackagedSelfTestCreate,
  runPackagedSelfTestRecover,
} from '../../qa/packaged/control-plane-recovery-driver';

const root = join(import.meta.dir, '../..');

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
  return candidates.find((p) => existsSync(p)) ?? null;
}

const outDir = join(root, 'artifacts', 'packaged-e2e');
mkdirSync(outDir, { recursive: true });

if (!assertSelfTestDisabledInRelease()) {
  console.error('FAIL: release self-test negative');
  process.exit(1);
}

const userData = mkdtempSync(join(tmpdir(), 'mate-x-lifecycle-'));
const fixture = join(userData, 'fixture-repo');

const create = await runPackagedSelfTestCreate({
  userDataDir: userData,
  fixtureRepoDir: fixture,
  resultPath: join(userData, 'create.json'),
});

const recover = await runPackagedSelfTestRecover({
  userDataDir: userData,
  fixtureRepoDir: fixture,
  resultPath: join(userData, 'recover.json'),
  expectedTaskId: create.engineeringTaskId,
});

const functionalOk = create.ok && recover.ok;
const binary = findPackagedBinary();

let smoke: Record<string, unknown> = { skipped: true };
if (binary) {
  const smokeDir = mkdtempSync(join(tmpdir(), 'mate-x-smoke-'));
  const child = spawn(binary, ['--user-data-dir', smokeDir], {
    env: { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' },
    stdio: 'ignore',
    detached: true,
  });
  await new Promise((r) => setTimeout(r, 8000));
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
    rmSync(smokeDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  smoke = { ok: alive, binary };
}

const report = {
  ok: functionalOk && (smoke.skipped || smoke.ok),
  timestamp: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  releaseSelfTestDisabled: assertSelfTestDisabledInRelease(),
  create: {
    ok: create.ok,
    engineeringTaskId: create.engineeringTaskId,
    error: create.error,
  },
  recover: {
    ok: recover.ok,
    taskRecovered: recover.taskRecovered,
    gitGateCommitBlocked: recover.gitGateCommitBlocked,
    proofStaleAfterMutation: recover.proofStaleAfterMutation,
    error: recover.error,
  },
  smoke,
  binaryHash: binary
    ? createHash('sha256').update(readFileSync(binary)).digest('hex')
    : null,
};

writeFileSync(join(outDir, 'packaged-smoke-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
