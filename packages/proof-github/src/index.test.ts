import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import { GitHubFetchError, parseGitHubPullRequestUrl } from './index';

describe('proof-github', () => {
  test('parses GitHub PR URL', () => {
    assert.deepEqual(parseGitHubPullRequestUrl('https://github.com/ferxalbs/mate-x/pull/42'), {
      owner: 'ferxalbs',
      repo: 'mate-x',
      prNumber: 42,
    });
  });

  test('rejects malformed input', () => {
    assert.throws(() => parseGitHubPullRequestUrl('https://example.com/nope'), GitHubFetchError);
    assert.throws(() => parseGitHubPullRequestUrl('https://github.com/org/repo/issues/1'), /Use a URL like/);
  });
});
