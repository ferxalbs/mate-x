import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeReadiness, type ReadinessInput } from './readiness';

function base(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    status: 'captured',
    openCriticalDecisions: 0,
    openPolicyStops: 0,
    consistencyCriticalCount: 0,
    requiredValidationMissing: false,
    requiredValidationFailed: false,
    validationRuns: [],
    coverage: null,
    proof: null,
    proofAnchorsMatch: true,
    privacyBlocked: false,
    policyMustBlocked: false,
    leaseHardConflict: false,
    highFindings: 0,
    mutationWithoutEvidence: false,
    ...over,
  };
}

describe('computeReadiness [NES-1.4]', () => {
  it('never returns Ready without ready status and closed coverage', () => {
    assert.equal(computeReadiness(base({ status: 'executing' })), 'Needs check');
    assert.equal(
      computeReadiness(
        base({
          status: 'ready',
          coverage: {
            reportId: 'r1',
            engineeringTaskId: 'etask_1',
            generatedAt: 't',
            gaps: [
              {
                findingId: 'f1',
                kind: 'unproven_req',
                severity: 'CRITICAL',
                message: 'gap',
                linkedIds: ['REQ-001'],
              },
            ],
            actionableGapCount: 1,
            inputsHash: 'h',
          },
        }),
      ),
      'Not proven',
    );
  });

  it('returns Ready only when status ready and gates closed', () => {
    assert.equal(
      computeReadiness(
        base({
          status: 'ready',
          coverage: {
            reportId: 'r1',
            engineeringTaskId: 'etask_1',
            generatedAt: 't',
            gaps: [],
            actionableGapCount: 0,
            inputsHash: 'h',
          },
        }),
      ),
      'Ready',
    );
  });

  it('Blocked for policy, privacy, open PolicyStop, lease conflict', () => {
    assert.equal(computeReadiness(base({ privacyBlocked: true })), 'Blocked');
    assert.equal(computeReadiness(base({ policyMustBlocked: true })), 'Blocked');
    assert.equal(computeReadiness(base({ openPolicyStops: 1 })), 'Blocked');
    assert.equal(computeReadiness(base({ leaseHardConflict: true })), 'Blocked');
    assert.equal(computeReadiness(base({ status: 'blocked' })), 'Blocked');
  });

  it('Not proven for missing/failed validation or stale proof', () => {
    assert.equal(
      computeReadiness(base({ requiredValidationMissing: true })),
      'Not proven',
    );
    assert.equal(
      computeReadiness(base({ requiredValidationFailed: true })),
      'Not proven',
    );
    assert.equal(
      computeReadiness(base({ mutationWithoutEvidence: true })),
      'Not proven',
    );
    assert.equal(
      computeReadiness(
        base({
          proof: {
            proofId: 'proof_1',
            engineeringTaskId: 'etask_1',
            proofHandle: 'ph_x',
            anchors: {
              workspaceId: 'w',
              repositorySnapshotHash: 'a',
              baseSha: null,
              headSha: 'h1',
              diffHash: 'd1',
              policyHash: 'p1',
              specificationVersion: 1,
              planVersion: 1,
              taskGraphVersion: 1,
              generatedAt: 't',
            },
            validationRunIds: [],
            coverageReportId: 'c',
            status: 'valid',
            generatedAt: 't',
            traces: [],
          },
          proofAnchorsMatch: false,
        }),
      ),
      'Not proven',
    );
  });

  it('Risk found for high findings while work continues', () => {
    assert.equal(
      computeReadiness(base({ status: 'planned', highFindings: 2 })),
      'Risk found',
    );
  });

  it('Needs check while gates incomplete', () => {
    assert.equal(computeReadiness(base({ status: 'clarifying' })), 'Needs check');
    assert.equal(computeReadiness(base({ status: 'awaiting_approval' })), 'Needs check');
    assert.equal(computeReadiness(base({ status: 'verifying' })), 'Needs check');
  });
});
