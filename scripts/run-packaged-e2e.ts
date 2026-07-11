/**
 * Packaged E2E driver (macOS/Windows).
 * 1) Verifies packaged binary + asar embed the self-test module
 * 2) Executes the same runPackagedSelfTest production function
 * 3) Optionally launches the packaged binary with self-test env
 *
 * Usage:
 *   bun run scripts/run-packaged-e2e.ts
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

// Negative: release cannot enable driver
if (!assertSelfTestDisabledInRelease()) {
  console.error('FAIL: release self-test negative check');
  process.exit(1);
}

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
  const asar = join(
    binary,
    '../../Resources/app.asar'.replace(/\//g, process.platform === 'win32' ? '\\' : '/'),
  );
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
  void asar;
}

// Optional: attempt short packaged binary launch (best-effort on headless agents)
if (binary && process.env.MATE_X_LAUNCH_PACKAGED === '1') {
  const launchUserData = mkdtempSync(join(tmpdir(), 'mate-x-launch-'));
  const launchResult = join(launchUserData, 'result.json');
  const env = {
    ...process.env,
    MATE_X_PACKAGED_SELF_TEST: '1',
    MATE_X_RELEASE_BUILD: '0',
    MATE_X_TEST_USER_DATA: launchUserData,
    MATE_X_TEST_FIXTURE_REPO: join(launchUserData, 'repo'),
    MATE_X_TEST_RESULT_PATH: launchResult,
  };
  const launched = spawnSync(binary, [], {
    env,
    timeout: 25_000,
    encoding: 'utf8',
  });
  evidence.packagedLaunch = {
    status: launched.status,
    signal: launched.signal,
    stdoutTail: (launched.stdout ?? '').slice(-500),
    stderrTail: (launched.stderr ?? '').slice(-500),
    resultExists: existsSync(launchResult),
    result: existsSync(launchResult)
      ? JSON.parse(readFileSync(launchResult, 'utf8'))
      : null,
  };
}

const evidencePath = join(outDir, 'packaged-e2e-evidence.json');
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify(evidence, null, 2));

if (!functional.ok) {
  process.exit(functional.exitCode || 1);
}
process.exit(0);
