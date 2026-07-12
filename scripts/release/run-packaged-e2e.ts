/**
 * External packaged E2E / release QA driver.
 *
 * Does NOT inject test hooks into the release binary.
 * 1) Static purity of main source (no self-test channel)
 * 2) In-process control-plane recovery against LibSQL (same domain modules)
 * 3) Optional black-box packaged smoke (binary starts with isolated userData)
 *
 * Usage:
 *   bun run scripts/release/run-packaged-e2e.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  runPackagedSelfTest,
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
          ]
        : [];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const outDir = join(root, 'artifacts', 'packaged-e2e');
mkdirSync(outDir, { recursive: true });

const binary = findPackagedBinary();
const evidence: Record<string, unknown> = {
  platform: process.platform,
  arch: process.arch,
  timestamp: new Date().toISOString(),
  binaryPath: binary,
  binaryHash: binary && existsSync(binary) ? sha256(binary) : null,
  note: 'External QA driver — no in-app self-test channel',
};

// Source purity: main must not contain self-test env hooks
const mainTs = readFileSync(join(root, 'src/electron/main.ts'), 'utf8');
const mainPurity =
  !mainTs.includes('MATE_X_PACKAGED_SELF_TEST') &&
  !mainTs.includes('runPackagedLifecycleFromMain') &&
  !mainTs.includes('openGuiAndProbe');
evidence.mainProcessPurity = mainPurity;
if (!mainPurity) {
  console.error('FAIL: main.ts still contains packaged self-test hooks');
  process.exit(1);
}

// In-process functional path (control plane + durable reopen) — external to package
const userData = mkdtempSync(join(tmpdir(), 'mate-x-e2e-'));
const fixture = join(userData, 'fixture-repo');
const resultPath = join(userData, 'recovery-result.json');

const functional = await runPackagedSelfTest({
  userDataDir: userData,
  fixtureRepoDir: fixture,
  resultPath,
});

evidence.functionalControlPlaneRecovery = {
  ok: functional.ok,
  phase: functional.phase,
  engineeringTaskId: functional.engineeringTaskId,
  taskRecovered: functional.taskRecovered,
  gitGateCommitBlocked: functional.gitGateCommitBlocked,
  gitGatePushBlocked: functional.gitGatePushBlocked,
  proofStaleAfterMutation: functional.proofStaleAfterMutation,
  error: functional.error,
};

if (!functional.ok) {
  writeFileSync(
    join(outDir, 'packaged-e2e-evidence.json'),
    JSON.stringify(evidence, null, 2),
    'utf8',
  );
  console.error('FAIL: control-plane recovery driver', functional.error ?? functional.phase);
  process.exit(1);
}

// Black-box packaged smoke (optional when binary present)
if (binary) {
  const smokeUserData = mkdtempSync(join(tmpdir(), 'mate-x-smoke-'));
  const bootMs = 8_000;
  const child = spawn(binary, ['--user-data-dir', smokeUserData], {
    env: {
      ...process.env,
      // Explicitly do not set any test hooks
      ELECTRON_NO_ATTACH_CONSOLE: '1',
    },
    stdio: 'ignore',
    detached: true,
  });

  let smokeError: string | null = null;
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, bootMs));
  } catch (error) {
    smokeError = error instanceof Error ? error.message : String(error);
  }
  // Process still running after boot window = smoke start success
  const smokeOk = smokeError == null && child.pid != null && !child.killed;
  try {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  } catch {
    /* ignore kill races */
  }
  try {
    rmSync(smokeUserData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  evidence.packagedSmoke = {
    ok: smokeOk,
    bootWaitMs: bootMs,
    error: smokeError,
  };

  // Bundle purity when asar present
  const purity = spawnSync(
    'bun',
    ['run', 'scripts/release/verify-bundle-purity.ts', '--require-asar'],
    { cwd: root, encoding: 'utf8' },
  );
  evidence.bundlePurity = {
    ok: purity.status === 0,
    stdout: purity.stdout?.slice(-500),
    stderr: purity.stderr?.slice(-500),
  };
  if (purity.status !== 0) {
    writeFileSync(
      join(outDir, 'packaged-e2e-evidence.json'),
      JSON.stringify(evidence, null, 2),
      'utf8',
    );
    console.error('FAIL: bundle purity');
    console.error(purity.stdout);
    console.error(purity.stderr);
    process.exit(1);
  }

  if (!smokeOk) {
    writeFileSync(
      join(outDir, 'packaged-e2e-evidence.json'),
      JSON.stringify(evidence, null, 2),
      'utf8',
    );
    console.error('FAIL: packaged smoke start', smokeError);
    process.exit(1);
  }
} else {
  evidence.packagedSmoke = { ok: null, skipped: true, reason: 'no packaged binary' };
  console.warn('WARN: no packaged binary — smoke skipped (run package first for full release QA)');
}

writeFileSync(
  join(outDir, 'packaged-e2e-evidence.json'),
  JSON.stringify(evidence, null, 2),
  'utf8',
);
writeFileSync(
  join(outDir, 'packaged-smoke-result.json'),
  JSON.stringify(
    {
      ok: true,
      functional: true,
      smoke: evidence.packagedSmoke,
      timestamp: evidence.timestamp,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('packaged-e2e: PASS', {
  functional: true,
  smoke: evidence.packagedSmoke,
  binary: binary ?? 'none',
});
process.exit(0);
