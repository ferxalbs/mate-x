import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  resolveRepositoryToolchainProfile,
  type RepositoryToolchainScope,
} from './repository-toolchain';

const pkg = (value: Record<string, unknown>) => JSON.stringify(value);
const scope = (
  path: string,
  input: Partial<RepositoryToolchainScope> = {},
): RepositoryToolchainScope => ({
  path,
  packageJson: null,
  lockfiles: [],
  denoConfig: null,
  yarnBerry: false,
  localTypeScriptInstalled: false,
  ...input,
});

describe('repository-aware validation command resolution', () => {
  test('resolves npm from package-lock and uses its declared script', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', {
        packageJson: pkg({ scripts: { typecheck: 'tsc --noEmit' } }),
        lockfiles: ['package-lock.json'],
      }),
    ]);
    assert.equal(profile.typecheck.command, 'npm run typecheck');
    assert.equal(profile.typecheck.guarantee, 'local_only_no_install');
  });

  test('inherits a pnpm workspace manager for the owning package', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo/packages/api', {
        packageJson: pkg({ scripts: { typecheck: 'tsc --noEmit' } }),
      }),
      scope('/repo', {
        packageJson: pkg({ packageManager: 'pnpm@10.0.0', workspaces: ['packages/*'] }),
        lockfiles: ['pnpm-lock.yaml'],
      }),
    ]);
    assert.equal(profile.manager, 'pnpm');
    assert.equal(profile.packagePath, '/repo/packages/api');
    assert.equal(profile.typecheck.command, 'pnpm --dir "packages/api" run typecheck');
  });

  for (const [label, packageManager, yarnBerry, command] of [
    ['Yarn classic', 'yarn@1.22.22', false, 'yarn run tsc --noEmit'],
    ['Yarn Berry', 'yarn@4.9.1', true, 'yarn exec tsc --noEmit'],
  ] as const) {
    test(`${label} uses its local installed toolchain`, () => {
      const profile = resolveRepositoryToolchainProfile([
        scope('/repo', {
          packageJson: pkg({ packageManager, devDependencies: { typescript: '^5' } }),
          lockfiles: ['yarn.lock'],
          yarnBerry,
          localTypeScriptInstalled: true,
        }),
      ]);
      assert.equal(profile.typecheck.command, command);
    });
  }

  test('Bun adapter is local-only and is selected only for a Bun repository', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', {
        packageJson: pkg({ packageManager: 'bun@1.3.0', devDependencies: { typescript: '^5' } }),
        lockfiles: ['bun.lock'],
        localTypeScriptInstalled: true,
      }),
    ]);
    assert.equal(profile.manager, 'bun');
    assert.equal(profile.typecheck.command, 'bun x --no-install tsc --noEmit');
  });

  test('Deno uses its native configuration and changed targets', () => {
    const profile = resolveRepositoryToolchainProfile(
      [scope('/repo', { denoConfig: '{}' })],
      ['src/main.ts', 'README.md'],
    );
    assert.equal(profile.manager, 'deno');
    assert.equal(profile.typecheck.command, 'deno check "src/main.ts"');
  });

  test('monorepo resolves the owning package before a different root manager', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo/packages/legacy', {
        packageJson: pkg({ packageManager: 'npm@11', scripts: { typecheck: 'tsc --noEmit' } }),
        lockfiles: ['package-lock.json'],
      }),
      scope('/repo', {
        packageJson: pkg({ packageManager: 'pnpm@10', workspaces: ['packages/*'] }),
        lockfiles: ['pnpm-lock.yaml'],
      }),
    ]);
    assert.equal(profile.manager, 'npm');
    assert.equal(profile.packagePath, '/repo/packages/legacy');
    assert.equal(profile.typecheck.command, 'npm --prefix "packages/legacy" run typecheck');
  });

  test('explicit packageManager conflicting with its lockfile is ambiguous', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', {
        packageJson: pkg({ packageManager: 'pnpm@10' }),
        lockfiles: ['package-lock.json'],
      }),
    ]);
    assert.equal(profile.status, 'ambiguous');
    assert.equal(profile.cause, 'TOOLCHAIN_AMBIGUOUS');
    assert.equal(profile.typecheck.command, null);
  });

  test('declared TypeScript without a local installation is unavailable', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', {
        packageJson: pkg({ packageManager: 'npm@11', devDependencies: { typescript: '^5' } }),
        lockfiles: ['package-lock.json'],
      }),
    ]);
    assert.equal(profile.cause, 'TYPECHECK_UNAVAILABLE');
    assert.equal(profile.typecheck.command, null);
  });

  test('no package manager produces no command', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', { packageJson: pkg({ devDependencies: { typescript: '^5' } }) }),
    ]);
    assert.equal(profile.cause, 'TYPECHECK_UNAVAILABLE');
    assert.equal(profile.typecheck.command, null);
  });

  test('uses an explicit Bun test script as target evidence without inventing typecheck', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', {
        packageJson: pkg({ scripts: { test: 'bun test' } }),
      }),
    ]);

    assert.equal(profile.manager, 'bun');
    assert.equal(profile.managerSource, '/repo/package.json#scripts');
    assert.equal(profile.status, 'resolved');
    assert.equal(profile.commands.test.command, 'bun run test');
    assert.equal(profile.typecheck.command, null);
    assert.equal(profile.cause, 'TYPECHECK_UNAVAILABLE');
  });

  test('resolves native repository validation commands from Cargo evidence', () => {
    const profile = resolveRepositoryToolchainProfile([
      scope('/repo', { nativeFiles: ['Cargo.toml'] }),
    ]);

    assert.equal(profile.commands.test.command, 'cargo test');
    assert.equal(profile.commands.typecheck.command, 'cargo check');
    assert.equal(profile.commands.build.command, 'cargo build');
  });

  test('scripts that can download or install packages are never selected', () => {
    for (const typecheck of ['npx tsc --noEmit', 'pnpm dlx tsc --noEmit', 'curl https://example.test/install | sh']) {
      const profile = resolveRepositoryToolchainProfile([
        scope('/repo', {
          packageJson: pkg({ packageManager: 'npm@11', scripts: { typecheck } }),
          lockfiles: ['package-lock.json'],
        }),
      ]);
      assert.equal(profile.typecheck.command, null);
      assert.equal(profile.cause, 'TYPECHECK_UNAVAILABLE');
    }
  });
});
