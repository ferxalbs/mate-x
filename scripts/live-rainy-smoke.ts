/**
 * Opt-in live Rainy smoke for release QA.
 * NOT part of the normal test suite — requires network + RAINY_API_KEY.
 *
 * Usage:
 *   RAINY_API_KEY=... bun run scripts/live-rainy-smoke.ts
 */

import {
  createProductionRainyRunner,
  defaultRainyTransport,
} from '../src/electron/engineering/rainy-production-runner';
import { RainyAgentAdapter, buildCanonicalScope } from '../src/electron/engineering/rainy-adapter';
import { nowIso, sha256Hex } from '../src/electron/engineering/ids';
import type {
  EngineeringTask,
  SpecificationDocument,
  TaskLease,
  TaskNode,
  TechnicalApproachDocument,
} from '../src/contracts/engineering-task';

if (process.env.MATE_X_LIVE_RAINY !== '1') {
  console.error('Set MATE_X_LIVE_RAINY=1 and RAINY_API_KEY to run live smoke.');
  process.exit(2);
}

const apiKey = process.env.RAINY_API_KEY?.trim();
if (!apiKey) {
  console.error('RAINY_API_KEY missing');
  process.exit(2);
}

const t: EngineeringTask = {
  engineeringTaskId: 'etask_live_smoke',
  workspaceId: 'ws_live',
  conversationId: null,
  pathKind: 'full',
  title: 'Live smoke',
  objectiveSeed: 'Live Rainy smoke — no mutations required',
  status: 'executing',
  aggregateVersion: 1,
  activeSpecificationVersion: 1,
  activePlanVersion: 1,
  activeTaskGraphVersion: 1,
  policyPackRef: null,
  readiness: 'Not proven',
  priorLegalStatus: null,
  blockedReasonCode: null,
  lastExecutionId: null,
  lastProofId: null,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  cancelledAt: null,
  readyAt: null,
};

const lease: TaskLease = {
  leaseId: 'lease_live',
  engineeringTaskId: t.engineeringTaskId,
  taskId: 'task_live',
  agentId: 'rainy',
  workspaceId: t.workspaceId,
  acquiredAt: nowIso(),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  status: 'active',
};

const graphTask: TaskNode = {
  taskId: 'task_live',
  displayId: 'T-LIVE',
  title: 'Smoke',
  description: 'Live smoke',
  phase: 'slice',
  dependsOn: [],
  fileScopes: { read: [], write: [] },
  linkedReqIds: [],
  linkedAcIds: [],
  parallelSafe: false,
  validationObligations: [],
  preconditions: [],
  completionConditions: [],
  status: 'ready',
  evidenceIds: [],
  version: 1,
};

const specification: SpecificationDocument = {
  specificationId: 'spec_live',
  version: 1,
  objective: 'Live Rainy smoke',
  problemStatement: 'qa',
  actors: [],
  currentBehavior: '',
  desiredBehavior: '',
  userValue: 'qa',
  inScope: [],
  nonGoals: [],
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
  contentHash: sha256Hex('live'),
  createdAt: nowIso(),
  frozenAt: nowIso(),
};

const approach: TechnicalApproachDocument = {
  approachId: 'ap_live',
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
  contentHash: sha256Hex('ap_live'),
};

const runner = createProductionRainyRunner({
  getApiKey: () => apiKey,
  transport: defaultRainyTransport,
});

const adapter = new RainyAgentAdapter({ kind: 'production', rainyRunner: runner });
const scope = buildCanonicalScope({
  task: t,
  lease,
  graphTask,
  repositorySnapshotHash: sha256Hex('live-repo'),
  headSha: '0'.repeat(40),
  baseSha: '0'.repeat(40),
  diffHash: sha256Hex('live-diff'),
});

const result = await adapter.executeScoped({
  scope,
  task: t,
  specification,
  approach,
  graphTask,
  lease,
  timeoutMs: 30_000,
});

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      status: result.status,
      errorClass: result.errorClass,
      provider: result.provider,
      model: result.model,
      touchedPaths: result.touchedPaths.length,
      cancelled: result.cancelled,
      // Never print secrets or model prose
    },
    null,
    2,
  ),
);

// Live smoke accepts blocked/failed from provider as long as structure is present
process.exit(result.status ? 0 : 1);
