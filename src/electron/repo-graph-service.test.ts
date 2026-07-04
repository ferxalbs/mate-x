import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { RepoGraphNode } from '../contracts/repo-graph';
import { getEmbeddingContent } from './repo-graph-embedding-privacy';

function fileNode(key: string): RepoGraphNode {
  return {
    id: `node-${key}`,
    workspaceId: 'workspace-test',
    kind: 'file',
    key,
    label: key,
    updatedAt: new Date(0).toISOString(),
  };
}

describe('RepoGraph embedding privacy', () => {
  it('uses metadata-only embedding input for env files', () => {
    const node = fileNode('.env.local');
    const content = getEmbeddingContent(node.key, 'RAINY_API_KEY=raw-secret\nPUBLIC_FLAG=true');
    const input = `path: ${node.key}\ncontent:\n${content}`;

    assert.match(input, /path: \.env\.local/);
    assert.match(input, /omitted: sensitive configuration content/);
    assert.doesNotMatch(input, /raw-secret/);
    assert.doesNotMatch(input, /PUBLIC_FLAG=true/);
  });

  it('redacts secret-bearing lines before embedding regular config content', () => {
    const content = getEmbeddingContent(
      'src/config/client.ts',
      'export const endpoint = "https://api.example.test";\nexport const token = "raw-token";',
    );

    assert.match(content, /endpoint/);
    assert.match(content, /\[REDACTED\]/);
    assert.doesNotMatch(content, /raw-token/);
  });
});
