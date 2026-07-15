import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GitDiff } from '../../contracts/git';
import { buildGitDiffResult, normalizeDiffPath } from './git';

const summary: GitDiff = {
  files: [
    { file: 'src/a.ts', changes: 2, insertions: 1, deletions: 1, binary: false },
    { file: 'src/b.ts', changes: 1, insertions: 1, deletions: 0, binary: false },
  ],
  insertions: 2,
  deletions: 1,
};

describe('git_diag diff result', () => {
  it('returns patch content with summary and file filtering', () => {
    const result = buildGitDiffResult(summary, 'diff --git a/src/a.ts b/src/a.ts', {
      path: 'src/a.ts',
      maxChars: 40_000,
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.insertions, 1);
    assert.equal(result.deletions, 1);
    assert.match(result.patch.patch, /diff --git/);
    assert.equal(result.patch.truncated, false);
  });

  it('bounds large patches and tells the model how to continue', () => {
    const result = buildGitDiffResult(summary, 'x'.repeat(3_000), {
      path: null,
      maxChars: 2_000,
    });

    assert.equal(result.patch.returnedChars, 2_000);
    assert.equal(result.patch.totalChars, 3_000);
    assert.equal(result.patch.truncated, true);
    assert.match(result.recommendedNextAction ?? '', /path set to one changed file/);
  });

  it('rejects absolute paths and parent traversal', () => {
    assert.equal(normalizeDiffPath('/tmp/a.ts'), null);
    assert.equal(normalizeDiffPath('../secret'), null);
    assert.equal(normalizeDiffPath('src/a.ts'), 'src/a.ts');
  });
});
