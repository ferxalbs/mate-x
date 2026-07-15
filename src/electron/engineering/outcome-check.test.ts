import { describe, expect, test } from 'bun:test';

import {
  deriveChangeContract,
  deriveOutcomeMap,
  type ShipProof,
} from '../../contracts/engineering-task';
import { evaluateGitGate } from './git-gate';
import { evaluateProofFreshness } from './ship-proof';

const anchors = { workspaceId: 'ws', headSha: 'head', diffHash: 'diff', policyHash: 'policy', repositorySnapshotHash: 'snapshot', specificationVersion: 1, planVersion: 1, taskGraphVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', baseSha: null };

describe('outcome checks', () => {
  test('does not prove an outcome from a passing unrelated validation', () => {
    const contract = deriveChangeContract({ objective: 'Revoked invitations cannot be reused.' });
    const map = deriveOutcomeMap({
      contract,
      diffHash: 'diff',
      validationRuns: [{ validationRunId: 'val_1', validationPlanId: 'plan', validationId: 'test', engineeringTaskId: 'task', relatedTaskIds: [], relatedReqIds: ['other'], executable: 'bun', args: [], cwd: '.', startedAt: anchors.generatedAt, completedAt: anchors.generatedAt, exitCode: 0, timedOut: false, cancelled: false, outputSummary: '', headSha: 'head', diffHash: 'diff', policyHash: 'policy', passed: true }],
    });
    expect(map.entries[0]?.state ?? '').toMatch(/^missing$/);
  });

  test('marks proof stale after diff changes', () => {
    const proof = { proofId: 'proof_1', engineeringTaskId: 'task', proofHandle: 'ph_12345678901234567890', anchors, validationRunIds: [], coverageReportId: 'report', status: 'valid', generatedAt: anchors.generatedAt, traces: [] } satisfies ShipProof;
    expect(String(evaluateProofFreshness(proof, { ...anchors, diffHash: 'new-diff' }).ok)).toMatch(/^false$/);
  });

  test('blocks GitGate when a mandatory challenge is insensitive', () => {
    const proof = { proofId: 'proof_1', engineeringTaskId: 'task', proofHandle: 'ph_12345678901234567890', validationRunIds: ['val_1'], coverageReportId: 'report', status: 'valid', generatedAt: anchors.generatedAt, traces: [], anchors, outcomeMap: { contractId: 'contract', diffHash: 'diff', generatedAt: anchors.generatedAt, scopeDrift: [], entries: [{ outcomeId: 'outcome_1', statement: 'Outcome', state: 'violated', evidence: { validationRunIds: ['val_1'], affectedFiles: [], affectedSymbols: [], challenge: 'insensitive' } }] } } satisfies ShipProof;
    const evaluation = evaluateGitGate({ repo: { getProofByHandle: () => proof } as never, proofHandle: proof.proofHandle, current: anchors });
    expect(String(evaluation.allowed)).toMatch(/^false$/);
    expect(evaluation.code ?? '').toMatch(/^ERR_PROOF_CHALLENGE_INSENSITIVE$/);
  });
});
