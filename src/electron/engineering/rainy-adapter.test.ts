import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  EngineeringTask,
  SpecificationDocument,
  TaskLease,
  TaskNode,
  TechnicalApproachDocument,
} from '../../contracts/engineering-task';
import {
  assertAgentCannotAuthorize,
  buildCanonicalScope,
  FakeAgentAdapter,
  RainyAgentAdapter,
  rainyCapabilities,
  stripModelProseFromEvidence,
  validateLeaseBinding,
} from './rainy-adapter';
import { nowIso, sha256Hex } from './ids';

function task(): EngineeringTask {
  const t = nowIso();
  return {
    engineeringTaskId: 'etask_test',
    workspaceId: 'ws_1',
    conversationId: null,
    pathKind: 'full',
    title: 'T',
    objectiveSeed: 'Implement X with tests',
    status: 'executing',
    aggregateVersion: 5,
    activeSpecificationVersion: 1,
    activePlanVersion: 1,
    activeTaskGraphVersion: 1,
    policyPackRef: null,
    readiness: 'Not proven',
    priorLegalStatus: null,
    blockedReasonCode: null,
    lastExecutionId: null,
    lastProofId: null,
    createdAt: t,
    updatedAt: t,
    cancelledAt: null,
    readyAt: null,
  };
}

function lease(over: Partial<TaskLease> = {}): TaskLease {
  return {
    leaseId: 'lease_1',
    engineeringTaskId: 'etask_test',
    taskId: 'task_1',
    agentId: 'rainy',
    workspaceId: 'ws_1',
    acquiredAt: nowIso(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'active',
    ...over,
  };
}

function graphTask(): TaskNode {
  return {
    taskId: 'task_1',
    displayId: 'T-001',
    title: 'Implement',
    description: 'Implement change',
    phase: 'slice',
    dependsOn: [],
    fileScopes: { read: ['src/'], write: ['src/a.ts'] },
    linkedReqIds: ['REQ-001'],
    linkedAcIds: [],
    parallelSafe: false,
    validationObligations: [],
    preconditions: [],
    completionConditions: [],
    status: 'ready',
    evidenceIds: [],
    version: 1,
  };
}

function spec(): SpecificationDocument {
  return {
    specificationId: 'spec_1',
    version: 1,
    objective: 'Implement X with tests',
    problemStatement: 'need X',
    actors: [],
    currentBehavior: '',
    desiredBehavior: '',
    userValue: 'value',
    inScope: ['X'],
    nonGoals: ['Y'],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    acceptanceScenarios: [],
    edgeCases: [],
    assumptions: [],
    dependencies: [],
    constraints: [],
    successCriteria: [],
    unresolvedQuestions: [],
    qualityChecklist: { passed: true, items: [] },
    clarificationDecisions: [],
    approvalIdentity: 'human',
    verifyOnly: false,
    contentHash: sha256Hex('spec'),
    createdAt: nowIso(),
    frozenAt: nowIso(),
  };
}

function approach(): TechnicalApproachDocument {
  return {
    approachId: 'ap_1',
    version: 1,
    specificationVersion: 1,
    researchNotes: [],
    decisions: [],
    affectedSurfaces: [],
    interfaces: [],
    dataModel: [],
    stateChanges: [],
    migrations: [],
    rollout: '',
    rollback: '',
    observability: '',
    validationStrategy: [],
    contentHash: sha256Hex('ap'),
  };
}

describe('Rainy agent adapter [R6]', () => {
  it('declares capabilities without approve/proof rights', () => {
    const caps = rainyCapabilities();
    assert.equal(caps.canApproveSpecification, false);
    assert.equal(caps.canApprovePlan, false);
    assert.equal(caps.canAcceptConvergence, false);
    assert.equal(caps.canIssueShipProof, false);
    assert.equal(caps.canAuthorEvidence, false);
  });

  it('rejects agent authorize commands', () => {
    for (const cmd of [
      'FreezeSpecification',
      'ApprovePlanAndTasks',
      'AcceptConvergence',
      'IssueShipProof',
    ]) {
      const r = assertAgentCannotAuthorize(cmd, 'agent');
      assert.equal(r.ok, false);
    }
    assert.equal(assertAgentCannotAuthorize('CompleteTask', 'agent').ok, true);
  });

  it('rejects stale leases', () => {
    const l = lease({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const scope = buildCanonicalScope({
      task: task(),
      lease: l,
      graphTask: graphTask(),
      repositorySnapshotHash: sha256Hex('/repo'),
      headSha: 'abc1234',
    });
    const r = validateLeaseBinding({ lease: l, scope });
    assert.equal(r.ok, false);
  });

  it('fake adapter returns structured result and strips model prose for evidence', async () => {
    const adapter = new FakeAgentAdapter({ touchedPaths: ['src/a.ts'] });
    const t = task();
    const l = lease();
    const g = graphTask();
    const scope = buildCanonicalScope({
      task: t,
      lease: l,
      graphTask: g,
      repositorySnapshotHash: sha256Hex('/repo'),
      headSha: 'abc1234',
    });
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.touchedPaths, ['src/a.ts']);
    assert.ok(result.toolActivity.length > 0);
    assert.ok(result.modelProse);
    const clean = stripModelProseFromEvidence(result);
    assert.equal('modelProse' in clean, false);
  });

  it('rainy adapter fails closed without snapshot binding', async () => {
    const adapter = new RainyAgentAdapter();
    const t = task();
    const l = lease();
    const g = graphTask();
    const scope = buildCanonicalScope({
      task: t,
      lease: l,
      graphTask: g,
      repositorySnapshotHash: '',
      headSha: '',
    });
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, false);
  });

  it('rainy adapter completes with injected runner (no network)', async () => {
    const adapter = new RainyAgentAdapter(async () => ({
      touchedPaths: ['src/b.ts'],
      toolActivity: [
        { toolName: 'rg', summary: 'search', at: nowIso() },
      ],
      commandActivity: [
        { command: 'bun test', exitCode: 0, at: nowIso() },
      ],
      events: [
        { eventType: 'completed', at: nowIso(), summary: 'ok' },
      ],
    }));
    const t = task();
    const l = lease();
    const g = graphTask();
    const scope = buildCanonicalScope({
      task: t,
      lease: l,
      graphTask: g,
      repositorySnapshotHash: sha256Hex('/repo'),
      headSha: 'abc1234',
    });
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.touchedPaths, ['src/b.ts']);
    assert.equal(result.commandActivity[0]?.command, 'bun test');
  });
});
