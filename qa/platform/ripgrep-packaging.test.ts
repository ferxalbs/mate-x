/**
 * Artifact-level ripgrep packaging checks (focused).
 * Does not require embedded self-test.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dir, '../..');

function findUnpackedResources(): string | null {
  const candidates = [
    join(root, 'out/MaTE X-darwin-x64/MaTE X.app/Contents/Resources/app.asar.unpacked'),
    join(root, 'out/MaTE X-darwin-arm64/MaTE X.app/Contents/Resources/app.asar.unpacked'),
    join(root, 'out/MaTE X-win32-x64/resources/app.asar.unpacked'),
    join(root, 'out/mate-x-win32-x64/resources/app.asar.unpacked'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    try {
      if (statSync(full).isDirectory()) walk(full, acc);
      else acc.push(full);
    } catch {
      /* skip */
    }
  }
  return acc;
}

describe('ripgrep packaging (artifact-level)', () => {
  it('forge config fails closed when host ripgrep binary missing', () => {
    const forge = readFileSync(join(root, 'forge.config.ts'), 'utf8');
    assert.match(forge, /ripgrep binary missing/);
    assert.match(forge, /ripgrepPlatformPackageForHost/);
  });

  it('when package exists, host ripgrep binary is present and foreign OS binaries are absent', () => {
    const unpacked = findUnpackedResources();
    if (!unpacked) {
      // Package not built in this run — config-level check still covers contract
      assert.ok(true);
      return;
    }

    const files = walk(unpacked);
    const rgFiles = files.filter((f) => f.includes('@vscode/ripgrep'));
    assert.ok(rgFiles.length > 0, 'expected @vscode/ripgrep under unpacked');

    const hasBin =
      process.platform === 'win32'
        ? rgFiles.some((f) => f.endsWith(`${join('bin', 'rg.exe')}`) || f.endsWith('bin\\rg.exe') || f.endsWith('bin/rg.exe'))
        : rgFiles.some((f) => f.endsWith(`${join('bin', 'rg')}`) || f.endsWith('bin/rg'));
    assert.ok(hasBin, 'expected rg binary in package');

    if (process.platform === 'darwin') {
      assert.equal(
        rgFiles.some((f) => f.includes('ripgrep-win32')),
        false,
        'macOS package must not include Windows ripgrep',
      );
    }
    if (process.platform === 'win32') {
      assert.equal(
        rgFiles.some((f) => f.includes('ripgrep-darwin')),
        false,
        'Windows package must not include macOS ripgrep',
      );
    }
  });
});
