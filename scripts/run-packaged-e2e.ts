/**
 * Packaged E2E driver (macOS/Windows).
 * 1) Verifies release self-test negative
 * 2) When packaged binary exists, runs real process lifecycle (create + relaunch recover)
 * 3) Always runs in-process functional self-test as additional control-plane proof
 *
 * Usage:
 *   bun run scripts/run-packaged-e2e.ts
 *   MATE_X_GUI_LIFECYCLE=1 bun run scripts/run-packaged-e2e.ts
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertSelfTestDisabledInRelease,
  runPackagedSelfTest,
} from '../src/electron/engineering/packaged-self-test';

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
  releaseSelfTestDisabled: assertSelfTestDisabledInRelease(),
};

if (!assertSelfTestDisabledInRelease()) {
  console.error('FAIL: release self-test negative check');
  process.exit(1);
}

// In-process functional path (control plane + durable reopen)
const userData = mkdtempSync(join(tmpdir(), 'mate-x-e2e-'));
const fixture = join(userData, 'fixture-repo');
const resultPath = join(userData, 'self-test-result.json');

const functional = await runPackagedSelfTest({
  userDataDir: userData,
  fixtureRepoDir: fixture,
  resultPath,
});

evidence.functionalSelfTest = functional;
evidence.functionalExitCode = functional.exitCode;

// Prove asar contains self-test marker when packaged
if (binary && process.platform === 'darwin') {
  const asarPath = join(binary, '..', '..', 'Resources', 'app.asar');
  if (existsSync(asarPath)) {
    const buf = readFileSync(asarPath);
    evidence.asarPath = asarPath;
    evidence.asarHash = createHash('sha256').update(buf).digest('hex');
    evidence.asarContainsSelfTest =
      buf.includes(Buffer.from('PACKAGED_SELF_TEST')) ||
      buf.includes(Buffer.from('runPackagedSelfTest')) ||
      buf.includes(Buffer.from('packaged-self-test'));
  }
}

// Real packaged binary lifecycle (required when binary is present)
if (binary) {
  const lifecycle = spawnSync(
    process.execPath.includes('bun') ? process.execPath : 'bun',
    [join(root, 'scripts/run-packaged-lifecycle.ts')],
    {
      cwd: root,
      env: {
        ...process.env,
        MATE_X_GUI_LIFECYCLE:
          process.env.MATE_X_GUI_LIFECYCLE ??
          (process.platform === 'darwin' ? '1' : '0'),
      },
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  evidence.lifecycleStatus = lifecycle.status;
  evidence.lifecycleStdoutTail = (lifecycle.stdout ?? '').slice(-2000);
  evidence.lifecycleStderrTail = (lifecycle.stderr ?? '').slice(-2000);

  const smokePath =
    process.platform === 'win32'
      ? join(root, 'artifacts/windows/packaged-smoke-result.json')
      : join(root, 'artifacts/packaged-e2e/packaged-smoke-result.json');
  if (existsSync(smokePath)) {
    evidence.lifecycleSmoke = JSON.parse(readFileSync(smokePath, 'utf8'));
  }

  if (lifecycle.status !== 0) {
    const evidencePath = join(outDir, 'packaged-e2e-evidence.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.error(JSON.stringify(evidence, null, 2));
    process.exit(lifecycle.status ?? 1);
  }
} else {
  evidence.lifecycleSkipped = 'no packaged binary under out/';
}

const evidencePath = join(outDir, 'packaged-e2e-evidence.json');
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify(evidence, null, 2));

if (!functional.ok) {
  process.exit(functional.exitCode || 1);
}
process.exit(0);
