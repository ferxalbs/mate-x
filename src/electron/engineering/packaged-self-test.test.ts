import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  assertSelfTestDisabledInRelease,
  isPackagedSelfTestEnabled,
  runPackagedSelfTest,
} from './packaged-self-test';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('Packaged self-test driver [CLOSURE 3]', () => {
  it('negative: impossible to enable in release package', () => {
    assert.equal(assertSelfTestDisabledInRelease(), true);
    assert.equal(
      isPackagedSelfTestEnabled({
        MATE_X_PACKAGED_SELF_TEST: '1',
        MATE_X_RELEASE_BUILD: '1',
      } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isPackagedSelfTestEnabled({
        MATE_X_PACKAGED_SELF_TEST: '1',
        MATE_X_RELEASE_BUILD: '0',
      } as NodeJS.ProcessEnv),
      true,
    );
    assert.equal(
      isPackagedSelfTestEnabled({
        MATE_X_PACKAGED_SELF_TEST: '1',
        MATE_X_ALLOW_PACKAGED_SELF_TEST: '1',
      } as NodeJS.ProcessEnv),
      true,
    );
    assert.equal(
      isPackagedSelfTestEnabled({} as NodeJS.ProcessEnv),
      false,
    );
  });

  it('packaged restart recovery + GitGate stale-proof on isolated fixture', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mate-x-packaged-'));
    dirs.push(root);
    const userDataDir = path.join(root, 'userData');
    const fixtureRepoDir = path.join(root, 'fixture-repo');
    const resultPath = path.join(root, 'self-test-result.json');

    const result = await runPackagedSelfTest({
      userDataDir,
      fixtureRepoDir,
      resultPath,
    });

    assert.equal(result.ok, true, result.error ?? result.phase);
    assert.ok(result.engineeringTaskId);
    assert.ok((result.eventCount ?? 0) > 0);
    assert.ok(result.workspaceId);
    assert.ok(result.branch);
    assert.ok(result.headSha);
    assert.ok(result.policyHash);
    assert.equal(result.gitGateAllowed, false);
    assert.equal(result.gitGateAfterMutationAllowed, false);
    assert.equal(result.proofStaleAfterMutation, true);
    assert.equal(result.exitCode, 0);

    const onDisk = JSON.parse(readFileSync(resultPath, 'utf8')) as typeof result;
    assert.equal(onDisk.ok, true);
    assert.ok(onDisk.artifactHashes?.result);
  });
});
