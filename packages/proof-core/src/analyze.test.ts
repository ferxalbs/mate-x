import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import { detectRiskyPaths, generateProofCapsule, redactSecretPreview } from './analyze';

describe('proof-core', () => {
  test('redacts secret previews', () => {
    assert.equal(redactSecretPreview('FAKE_sk_live_abcdefghijklmnopqrstuvwxyz'), 'FAKE...[redacted]...wxyz');
  });

  test('detects risky workflow and dependency paths', () => {
    const result = detectRiskyPaths([
      { path: '.github/workflows/ci.yml' },
      { path: 'package.json' },
      { path: 'src/auth/session.ts' },
    ]);

    assert.equal(result.detectedWorkflowChanges.length, 1);
    assert.equal(result.detectedDependencyChanges.length, 1);
    assert.equal(result.detectedSensitiveFiles.length, 1);
  });

  test('blocks critical secret and payment changes', () => {
    const capsule = generateProofCapsule({
      sourceType: 'manual',
      changedFiles: [
        { path: 'src/billing/checkout.ts', patch: '+ const key = "FAKE_sk_live_abcdefghijklmnopqrstuvwxyz";' },
      ],
      ciOutput: 'bun test passed',
    });

    assert.equal(capsule.riskLevel, 'critical');
    assert.equal(capsule.finalVerdict, 'blocked');
    assert.equal(JSON.stringify(capsule).includes('FAKE_sk_live_abcdefghijklmnopqrstuvwxyz'), false);
  });

  test('marks missing command evidence incomplete', () => {
    const capsule = generateProofCapsule({
      sourceType: 'manual',
      changedFiles: [{ path: 'src/button.tsx' }],
      transcript: 'Agent says tests passed.',
    });

    assert.equal(capsule.finalVerdict, 'incomplete');
    assert.equal(capsule.missingEvidence.includes('No pasted command/test evidence.'), true);
    assert.equal(capsule.missingEvidence.includes('Agent claims tests passed, but no command evidence was pasted.'), true);
  });

  test('passes safe PR fixture with explicit test evidence', () => {
    const capsule = generateProofCapsule({
      sourceType: 'github-pr',
      repo: { owner: 'acme', name: 'ui' },
      prNumber: 12,
      changedFiles: [{ path: 'src/components/button.tsx', additions: 12, deletions: 4 }],
      ciOutput: 'bun test passed',
    });

    assert.equal(capsule.finalVerdict, 'passed');
    assert.equal(capsule.riskLevel, 'low');
  });

  test('serializes proof capsule', () => {
    const capsule = generateProofCapsule({
      sourceType: 'manual',
      changedFiles: [{ path: 'README.md' }],
      ciOutput: 'bun test passed',
    });

    assert.equal(JSON.parse(JSON.stringify(capsule)).id, capsule.id);
  });
});
