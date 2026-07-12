/**
 * Bundle purity checks for release packages.
 *
 * Default (developer verify): source-level purity only.
 * --require-asar: inspect packaged app.asar + built main output.
 *
 * Usage:
 *   bun run scripts/release/verify-bundle-purity.ts
 *   bun run scripts/release/verify-bundle-purity.ts --require-asar
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dir, '../..');
const requireAsar = process.argv.includes('--require-asar');

const FORBIDDEN_STRINGS = [
  'MATE_X_PACKAGED_SELF_TEST',
  'MATE_X_PERF_PROBE',
  'MATE_X_GUI_LIFECYCLE',
  'MATE_X_TEST_USER_DATA',
  'MATE_X_TEST_FIXTURE_REPO',
  'MATE_X_TEST_RESULT_PATH',
  'MATE_X_ALLOW_PACKAGED_SELF_TEST',
  'PACKAGED_SELF_TEST_RESULT',
  'PACKAGED_PERF_PROBE_RESULT',
  'runPackagedLifecycleFromMain',
  'openGuiAndProbe',
  'isPackagedSelfTestEnabled',
  'runPackagedSelfTest',
  'FakeAgentAdapter',
];

function findPackagedAsar(): string | null {
  const candidates = [
    join(root, 'out/MaTE X-darwin-x64/MaTE X.app/Contents/Resources/app.asar'),
    join(root, 'out/MaTE X-darwin-arm64/MaTE X.app/Contents/Resources/app.asar'),
    join(root, 'out/MaTE X-win32-x64/resources/app.asar'),
    join(root, 'out/mate-x-win32-x64/resources/app.asar'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const failures: string[] = [];

// 1) Source main must not reintroduce test lifecycle
const mainTs = readFileSync(join(root, 'src/electron/main.ts'), 'utf8');
for (const s of FORBIDDEN_STRINGS) {
  if (mainTs.includes(s)) {
    failures.push(`src/electron/main.ts contains forbidden string: ${s}`);
  }
}
if (
  mainTs.includes('packaged-self-test') ||
  mainTs.includes('control-plane-recovery-driver')
) {
  failures.push('main.ts imports qualification harness');
}

// 2) Engineering index must not export QA modules
const indexTs = readFileSync(join(root, 'src/electron/engineering/index.ts'), 'utf8');
if (
  indexTs.includes('packaged-self-test') ||
  indexTs.includes('packaged-performance') ||
  indexTs.includes('control-plane-recovery')
) {
  failures.push('engineering/index.ts re-exports qualification modules');
}

// 3) QA modules must live outside src/
const forbiddenSrcPaths = [
  'src/electron/engineering/packaged-self-test.ts',
  'src/electron/engineering/packaged-performance.ts',
  'src/electron/engineering/performance.harness.test.ts',
];
for (const rel of forbiddenSrcPaths) {
  if (existsSync(join(root, rel))) {
    failures.push(`qualification module still under src/: ${rel}`);
  }
}

// 4) Built / packaged artifacts — only when release qualification requires ASAR
if (requireAsar) {
  const viteMain = join(root, '.vite/build/main.js');
  if (existsSync(viteMain)) {
    const body = readFileSync(viteMain, 'utf8');
    for (const s of FORBIDDEN_STRINGS) {
      if (body.includes(s)) {
        failures.push(`.vite/build/main.js contains forbidden string: ${s}`);
      }
    }
    const buildDir = join(root, '.vite/build');
    for (const f of walkFiles(buildDir)) {
      const base = f.replace(/\\/g, '/');
      if (
        base.includes('packaged-self-test') ||
        base.includes('control-plane-recovery')
      ) {
        failures.push(`vite build output ships QA chunk: ${base}`);
      }
    }
  }

  const asar = findPackagedAsar();
  if (!asar) {
    failures.push('app.asar not found (package first; --require-asar set)');
  } else {
    const list = spawnSync('npx', ['--yes', 'asar', 'list', asar], {
      encoding: 'utf8',
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (list.status !== 0) {
      failures.push(`asar list failed: ${list.stderr || list.stdout}`);
    } else {
      const entries = list.stdout.split('\n').filter(Boolean);
      for (const entry of entries) {
        const e = entry.toLowerCase();
        if (
          e.includes('packaged-self-test') ||
          e.includes('control-plane-recovery') ||
          e.includes('packaged-performance') ||
          e.includes('fake-agent') ||
          e.endsWith('.test.ts') ||
          e.includes('/qa/') ||
          e.includes('/fixtures/')
        ) {
          failures.push(`ASAR contains forbidden entry: ${entry}`);
        }
      }

      spawnSync(
        'npx',
        ['--yes', 'asar', 'extract-file', asar, '.vite/build/main.js'],
        { encoding: 'utf8', cwd: root, maxBuffer: 20 * 1024 * 1024 },
      );
      const extractedMain = join(root, 'main.js');
      if (existsSync(extractedMain) && statSync(extractedMain).isFile()) {
        const body = readFileSync(extractedMain, 'utf8');
        for (const s of FORBIDDEN_STRINGS) {
          if (body.includes(s)) {
            failures.push(`app.asar main.js contains forbidden string: ${s}`);
          }
        }
        try {
          unlinkSync(extractedMain);
        } catch {
          /* ignore */
        }
      } else {
        const strings = spawnSync(
          'rg',
          [
            '-a',
            'MATE_X_PACKAGED_SELF_TEST|PACKAGED_SELF_TEST_RESULT|openGuiAndProbe',
            asar,
          ],
          { encoding: 'utf8' },
        );
        if (strings.stdout && strings.stdout.trim()) {
          failures.push(
            `app.asar binary string search hit test hooks:\n${strings.stdout.slice(0, 500)}`,
          );
        }
      }

      const resourcesDir = join(asar, '..');
      const unpacked = join(resourcesDir, 'app.asar.unpacked');
      const unpackedFiles = walkFiles(unpacked).map((f) =>
        f.replace(/\\/g, '/'),
      );
      const rgFiles = unpackedFiles.filter(
        (f) =>
          f.includes('@vscode/ripgrep') ||
          f.endsWith('/bin/rg') ||
          f.endsWith('/bin/rg.exe') ||
          /\/rg(\.exe)?$/.test(f),
      );
      if (rgFiles.length === 0) {
        failures.push(
          `ripgrep not found under app.asar.unpacked (${unpacked}); sample: ${unpackedFiles.slice(0, 8).join(', ') || '(missing or empty)'}`,
        );
      } else if (process.platform === 'darwin') {
        if (rgFiles.some((f) => f.includes('ripgrep-win32'))) {
          failures.push(
            'macOS package includes Windows ripgrep platform package',
          );
        }
        if (!rgFiles.some((f) => f.endsWith('/rg') || /\/rg$/.test(f))) {
          failures.push('macOS package missing spawnable rg binary in unpacked');
        }
      } else if (process.platform === 'win32') {
        if (rgFiles.some((f) => f.includes('ripgrep-darwin'))) {
          failures.push(
            'Windows package includes macOS ripgrep platform package',
          );
        }
        if (!rgFiles.some((f) => f.endsWith('.exe') || f.endsWith('/rg.exe'))) {
          failures.push(
            'Windows package missing spawnable rg.exe binary in unpacked',
          );
        }
      }

      console.log(
        `bundle-purity: inspected ASAR ${asar} (${entries.length} entries)`,
      );
    }
  }
} else {
  console.log(
    'bundle-purity: source-level checks only (use --require-asar after package)',
  );
}

if (failures.length) {
  console.error('BUNDLE PURITY FAILED:');
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log('bundle-purity: PASS');
process.exit(0);
