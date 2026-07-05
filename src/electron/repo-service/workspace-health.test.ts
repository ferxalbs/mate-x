import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectPackageManager,
  detectScriptCommand,
} from './workspace-health';

describe('workspace health package manager detection', () => {
  it('detects bun from lockfile', () => {
    assert.equal(detectPackageManager(['bun.lock'], null), 'bun');
  });

  it('detects bun from packageManager field', () => {
    assert.equal(
      detectPackageManager([], { packageManager: 'bun@1.2.0' }),
      'bun',
    );
  });

  it('does not assume npm for package.json without package manager evidence', () => {
    assert.equal(detectPackageManager([], { scripts: { lint: 'eslint .' } }), 'unknown');
  });

  it('builds bun script commands', () => {
    const scripts = {
      build: 'vite build',
      lint: 'eslint .',
      test: 'vitest',
      typecheck: 'tsc --noEmit',
    };

    assert.equal(detectScriptCommand('bun', scripts, ['lint']), 'bun run lint');
    assert.equal(detectScriptCommand('bun', scripts, ['typecheck']), 'bun run typecheck');
    assert.equal(detectScriptCommand('bun', scripts, ['test']), 'bun run test');
    assert.equal(detectScriptCommand('bun', scripts, ['build']), 'bun run build');
  });

  it('does not invent npm commands when package manager is unknown', () => {
    assert.equal(
      detectScriptCommand('unknown', { lint: 'eslint .' }, ['lint']),
      'unknown',
    );
  });
});
