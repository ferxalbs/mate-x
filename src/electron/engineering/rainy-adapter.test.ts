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
  mayMarkTaskCompleted,
  RainyAgentAdapter,
  rainyCapabilities,
  stripModelProseFromEvidence,
  validateLeaseBinding,
} from './rainy-adapter';
import { FakeAgentAdapter } from '../../../tests/helpers/fake-agent-adapter';
import { createProductionRainyRunner } from './rainy-production-runner';
import {
  initProductionAgentAdapter,
  resetAgentAdapterForTests,
  resolveRainyApiKeyFromEnv,
} from './agent-runtime';
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

function boundScope(over: Partial<ReturnType<typeof buildCanonicalScope>> = {}) {
  const t = task();
  const l = lease();
  const g = graphTask();
  return {
    task: t,
    lease: l,
    graphTask: g,
    scope: buildCanonicalScope({
      task: t,
      lease: l,
      graphTask: g,
      repositorySnapshotHash: sha256Hex('/repo'),
      headSha: 'abc1234deadbeefabc1234deadbeefabc1234d',
      baseSha: 'abc1234deadbeefabc1234deadbeefabc1234d',
      diffHash: sha256Hex('diff'),
      ...over,
    }),
  };
}

describe('Rainy agent adapter [CLOSURE 1]', () => {
  it('1. deterministic fake full success', async () => {
    const adapter = new FakeAgentAdapter({ touchedPaths: ['src/a.ts'] });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.touchedPaths, ['src/a.ts']);
    assert.equal(result.engineeringTaskId, 'etask_test');
    assert.equal(result.leaseId, 'lease_1');
    assert.equal(result.graphTaskId, 'task_1');
    assert.ok(result.toolsInvoked.length > 0);
    assert.ok(result.modelProse);
    const clean = stripModelProseFromEvidence(result);
    assert.equal('modelProse' in clean, false);
    assert.equal(mayMarkTaskCompleted(result), true);
  });

  it('2. missing credentials → structured blocked', async () => {
    const runner = createProductionRainyRunner({
      getApiKey: () => null,
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.errorClass, 'missing_credentials');
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('3. provider failure cannot mark completed', async () => {
    const runner = createProductionRainyRunner({
      getApiKey: () => 'test-key',
      transport: async () => ({
        status: 'failed',
        touchedPaths: [],
        toolsInvoked: [],
        commandsRequested: [],
        commandResults: [],
        events: [],
        errorClass: 'provider_failure',
        errorMessage: 'upstream 503',
        cancelled: false,
      }),
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, false);
    assert.notEqual(result.status, 'completed');
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('4. timeout becomes explicit failed/timeout outcome', async () => {
    const runner = createProductionRainyRunner({
      getApiKey: () => 'test-key',
      transport: async (req) => {
        await new Promise((_, reject) => {
          req.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
        return {
          status: 'failed',
          touchedPaths: [],
          toolsInvoked: [],
          commandsRequested: [],
          commandResults: [],
          events: [],
          cancelled: false,
        };
      },
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
      timeoutMs: 20,
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.status === 'timeout' ||
        result.status === 'cancelled' ||
        result.failureClass === 'timeout' ||
        result.failureClass === 'cancelled' ||
        result.errorClass === 'timeout' ||
        result.errorClass === 'cancelled' ||
        result.errorClass === 'network',
    );
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('5. cancellation propagates', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = createProductionRainyRunner({
      getApiKey: () => 'test-key',
      transport: async () => {
        throw new Error('should not be called after abort');
      },
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
      signal: controller.signal,
    });
    assert.equal(result.ok, false);
    assert.ok(result.cancelled || result.status === 'cancelled');
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('6. stale lease before invocation', async () => {
    const adapter = new RainyAgentAdapter({
      kind: 'injected',
      runner: async () => {
        throw new Error('must not invoke runner on stale lease');
      },
    });
    const t = task();
    const l = lease({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const g = graphTask();
    const scope = buildCanonicalScope({
      task: t,
      lease: l,
      graphTask: g,
      repositorySnapshotHash: sha256Hex('/repo'),
      headSha: 'abc1234deadbeefabc1234deadbeefabc1234d',
      baseSha: 'abc1234deadbeefabc1234deadbeefabc1234d',
      diffHash: sha256Hex('diff'),
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
    assert.equal(result.failureClass, 'stale_lease');
  });

  it('7. HEAD change during execution', async () => {
    let calls = 0;
    const runner = createProductionRainyRunner({
      getApiKey: () => 'test-key',
      resolveCurrentHeadSha: async () => {
        calls += 1;
        // First call pre-check matches; second (post) differs
        return calls === 1
          ? 'abc1234deadbeefabc1234deadbeefabc1234d'
          : 'ffffffffffffffffffffffffffffffffffffffff';
      },
      transport: async () => ({
        status: 'completed',
        touchedPaths: ['src/a.ts'],
        toolsInvoked: [{ toolName: 'file_editor', summary: 'edit', at: nowIso() }],
        commandsRequested: [],
        commandResults: [],
        events: [{ eventType: 'completed', at: nowIso(), summary: 'ok' }],
        cancelled: false,
      }),
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.errorClass, 'stale_head');
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('8. structured result with no touched files cannot complete task', async () => {
    const adapter = new FakeAgentAdapter({ touchedPaths: [] });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    // override graph write so default isn't used — Fake uses behavior.touchedPaths
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.touchedPaths, []);
    // tools still recorded by fake — mayMark requires tools OR commands OR paths
    // Force empty tools via production runner
    const runner = createProductionRainyRunner({
      getApiKey: () => 'k',
      transport: async () => ({
        status: 'completed',
        touchedPaths: [],
        toolsInvoked: [],
        commandsRequested: [],
        commandResults: [],
        events: [{ eventType: 'completed', at: nowIso(), summary: 'noop' }],
        cancelled: false,
        modelProse: 'all done ship it',
      }),
    });
    const rainy = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const empty = await rainy.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(empty.ok, true);
    assert.equal(mayMarkTaskCompleted(empty), false);
  });

  it('9. partial execution', async () => {
    const adapter = new FakeAgentAdapter({
      touchedPaths: ['src/a.ts'],
      partial: true,
    });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(result.status, 'partial');
    assert.equal(mayMarkTaskCompleted(result), false);
  });

  it('10. real Rainy adapter request/response contract with mocked transport', async () => {
    let captured: unknown = null;
    const runner = createProductionRainyRunner({
      getApiKey: () => 'secret-key',
      transport: async (request, apiKey) => {
        captured = { request, apiKeyLen: apiKey.length };
        assert.equal(request.engineeringTaskId, 'etask_test');
        assert.equal(request.graphTaskId, 'task_1');
        assert.equal(request.leaseId, 'lease_1');
        assert.equal(request.workspaceId, 'ws_1');
        assert.ok(request.baseSha);
        assert.ok(request.headSha);
        assert.ok(request.diffHash);
        assert.equal(request.specificationVersion, 1);
        assert.equal(request.planVersion, 1);
        assert.equal(request.taskGraphVersion, 1);
        return {
          status: 'completed',
          touchedPaths: ['src/a.ts'],
          toolsInvoked: [{ toolName: 'apply_patch', summary: 'patched', at: nowIso() }],
          commandsRequested: ['bun test'],
          commandResults: [{ command: 'bun test', exitCode: 0, at: nowIso() }],
          events: [
            { eventType: 'started', at: nowIso(), summary: 'start' },
            { eventType: 'completed', at: nowIso(), summary: 'done' },
          ],
          provider: 'rainy',
          model: 'test-model',
          tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          costUsd: 0.01,
          cancelled: false,
          modelProse: 'I approve this for ship',
          repositoryMutationRecord: {
            baseSha: request.baseSha,
            headShaBefore: request.headSha,
            headShaAfter: request.headSha,
            diffHashBefore: request.diffHash,
            mutated: true,
          },
        };
      },
    });
    const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const result = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.ok(captured);
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'rainy');
    assert.equal(result.model, 'test-model');
    assert.equal(result.tokenUsage?.totalTokens, 30);
    assert.equal(result.commandsRequested[0], 'bun test');
    assert.equal(result.commandResults[0]?.exitCode, 0);
    assert.ok(result.repositoryMutationRecord?.mutated);
    // Model cannot approve
    for (const cmd of [
      'FreezeSpecification',
      'ApprovePlanAndTasks',
      'AcceptConvergence',
      'IssueShipProof',
    ]) {
      assert.equal(assertAgentCannotAuthorize(cmd, 'agent').ok, false);
    }
    assert.equal(mayMarkTaskCompleted(result), true);
  });

  it('11. no scaffold path in production initialization', async () => {
    resetAgentAdapterForTests();
    const adapter = initProductionAgentAdapter({
      getApiKey: () => null,
    });
    const caps = adapter.declareCapabilities();
    assert.equal(caps.canApproveSpecification, false);
    assert.equal(caps.canIssueShipProof, false);

    const bare = new RainyAgentAdapter();
    const { task: t, lease: l, graphTask: g, scope } = boundScope();
    const scaffold = await bare.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(scaffold.ok, false);
    assert.equal(scaffold.status, 'blocked');
    assert.match(scaffold.failureMessage ?? '', /scaffold|not configured/i);

    // Production adapter with missing key also blocked, not success
    const prod = await adapter.executeScoped({
      scope,
      task: t,
      specification: spec(),
      approach: approach(),
      graphTask: g,
      lease: l,
    });
    assert.equal(prod.ok, false);
    assert.equal(prod.status, 'blocked');

    assert.equal(resolveRainyApiKeyFromEnv({} as NodeJS.ProcessEnv), null);
    assert.equal(
      resolveRainyApiKeyFromEnv({ RAINY_API_KEY: 'x' } as NodeJS.ProcessEnv),
      'x',
    );
    resetAgentAdapterForTests();
  });

  it('declares capabilities without approve/proof rights', () => {
    const caps = rainyCapabilities();
    assert.equal(caps.canApproveSpecification, false);
    assert.equal(caps.canApprovePlan, false);
    assert.equal(caps.canAcceptConvergence, false);
    assert.equal(caps.canIssueShipProof, false);
    assert.equal(caps.canAuthorEvidence, false);
  });

  it('rejects stale leases via validateLeaseBinding', () => {
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
});
