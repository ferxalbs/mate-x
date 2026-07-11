import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ERR_CODES } from '../../contracts/engineering-task';
import { EngineeringCommandBus } from './command-bus';
import { runCoverageConvergence } from './coverage-convergence';
import { evaluateGitGate } from './git-gate';
import { draftSpecificationFromSeed, freezeSpecification } from './intent-compiler';
import { acquireLease, completeTaskWithEvidence } from './orchestrator';
import { createPhaseHandler } from './phase-handler';
import { ensureDefaultPolicyPack, importPolicyProposalFromMarkdown } from './policy-pack';
import { EngineeringRepository } from './repository';
import { issueShipProof } from './ship-proof';
import { analyzeConsistency } from './consistency';
import { compileTechnicalApproach } from './plan-compiler';
import { compileTaskGraph } from './task-graph-compiler';
import { validateValidationCommand } from './validation-engine';
import { nowIso, sha256Hex } from './ids';

function setup() {
  const repo = new EngineeringRepository();
  repo.ensureSchema();
  const bus = new EngineeringCommandBus(repo);
  bus.setPhaseHandler(createPhaseHandler(repo));
  return { repo, bus };
}

describe('Control plane vertical slice [NES-2..6]', () => {
  it('prompt alone is never specified; freeze requires checklist', () => {
    const { bus } = setup();
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws',
      objectiveSeed: 'Add API rate limiting with tests',
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    assert.equal((cap.data as any).status, 'captured');

    const frozen = bus.dispatch({
      type: 'FreezeSpecification',
      engineeringTaskId: (cap.data as any).engineeringTaskId,
      workspaceId: 'ws',
      actor: { kind: 'human', userId: 'u1' },
    });
    assert.equal(frozen.ok, true);
    if (!frozen.ok) return;
    assert.equal((frozen.data as any).status, 'specified');
  });

  it('freeze fails quality when objective too short', () => {
    const draft = draftSpecificationFromSeed({ objectiveSeed: 'x' });
    const result = freezeSpecification(draft, 'human');
    assert.equal(result.ok, false);
  });

  it('policy import from markdown requires Decision (does not auto-apply)', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    const prior = ensureDefaultPolicyPack(repo);
    const { proposal, requiresDecision } = importPolicyProposalFromMarkdown(
      '- MUST: never deploy without review\n',
      prior,
    );
    assert.equal(requiresDecision, true);
    assert.notEqual(proposal.policyHash, prior.policyHash);
    // prior remains stored until Decision applies
    assert.equal(
      repo.getPolicyPack(prior.policyPackId, prior.version)?.policyHash,
      prior.policyHash,
    );
  });

  it('full path: plan + graph + consistency + approval', () => {
    const { bus, repo } = setup();
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws',
      objectiveSeed: 'Implement feature X with tests and docs',
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as any).engineeringTaskId;

    for (const step of [
      () =>
        bus.dispatch({
          type: 'FreezeSpecification',
          engineeringTaskId: id,
          workspaceId: 'ws',
          actor: { kind: 'human', userId: 'u1' },
        }),
      () =>
        bus.dispatch({
          type: 'StartPlanCompilation',
          engineeringTaskId: id,
          workspaceId: 'ws',
        }),
      () =>
        bus.dispatch({
          type: 'CompletePlanCompilation',
          engineeringTaskId: id,
          workspaceId: 'ws',
        }),
      () =>
        bus.dispatch({
          type: 'CompileTaskGraph',
          engineeringTaskId: id,
          workspaceId: 'ws',
        }),
      () =>
        bus.dispatch({
          type: 'SubmitForApproval',
          engineeringTaskId: id,
          workspaceId: 'ws',
        }),
      () =>
        bus.dispatch({
          type: 'ApprovePlanAndTasks',
          engineeringTaskId: id,
          workspaceId: 'ws',
          actor: { kind: 'human', userId: 'u1' },
        }),
    ]) {
      const r = step();
      assert.equal(r.ok, true, r.ok ? '' : r.error.message);
    }

    const task = repo.getTask(id)!;
    assert.equal(task.status, 'executing');
    assert.ok(task.activeTaskGraphVersion);
  });

  it('serial lease: second lease fails', () => {
    const { bus, repo } = setup();
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws',
      objectiveSeed: 'Implement feature Y with validation',
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as any).engineeringTaskId;
    for (const type of [
      'FreezeSpecification',
      'StartPlanCompilation',
      'CompletePlanCompilation',
      'CompileTaskGraph',
      'SubmitForApproval',
      'ApprovePlanAndTasks',
    ] as const) {
      const r = bus.dispatch({
        type,
        engineeringTaskId: id,
        workspaceId: 'ws',
        actor: { kind: 'human', userId: 'u1' },
      });
      assert.equal(r.ok, true, type);
    }
    const graph = repo.getTaskGraph(id, repo.getTask(id)!.activeTaskGraphVersion!)!;
    const t0 = graph.tasks[0]!;
    const a = acquireLease({
      repo,
      workspaceId: 'ws',
      engineeringTaskId: id,
      task: t0,
      agentId: 'a1',
      multiAgentLeases: false,
    });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    repo.applyTransaction({
      task: repo.getTask(id)!,
      events: [],
      lease: a.lease,
    });
    const b = acquireLease({
      repo,
      workspaceId: 'ws',
      engineeringTaskId: id,
      task: t0,
      agentId: 'a2',
      multiAgentLeases: false,
    });
    assert.equal(b.ok, false);
    if (b.ok) return;
    assert.equal(b.code, ERR_CODES.ERR_LEASE_CONFLICT);
  });

  it('CompleteTask without evidence fails for agent', () => {
    const node = {
      taskId: 't1',
      displayId: 'TSK-001',
      title: 'x',
      description: '',
      phase: 'slice' as const,
      dependsOn: [],
      fileScopes: { write: ['src'], read: [] },
      linkedReqIds: ['REQ-001'],
      linkedAcIds: [],
      parallelSafe: false,
      validationObligations: [],
      preconditions: [],
      completionConditions: [],
      status: 'running' as const,
      evidenceIds: [],
      version: 1,
    };
    const r = completeTaskWithEvidence({
      task: node,
      evidenceIds: [],
      actorKind: 'agent',
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, ERR_CODES.ERR_TASK_EVIDENCE_REQUIRED);
  });

  it('validation shell:true rejected; cwd escape rejected', () => {
    const shell = validateValidationCommand(
      {
        executable: 'bun',
        args: ['test'],
        cwd: '/tmp/ws',
        timeoutMs: 1000,
        shell: true as false,
        linkedReqIds: [],
        linkedTaskIds: [],
        linkedAcIds: [],
      },
      '/tmp/ws',
    );
    // shell true coerced — validate checks property
    assert.equal(
      validateValidationCommand(
        {
          executable: 'bun',
          args: ['test'],
          cwd: '/tmp/ws',
          timeoutMs: 1000,
          shell: false,
          linkedReqIds: [],
          linkedTaskIds: [],
          linkedAcIds: [],
          // force shell via cast
          ...({ shell: true } as object),
        } as never,
        '/tmp/ws',
      ).ok,
      false,
    );
    void shell;
    const escape = validateValidationCommand(
      {
        executable: 'bun',
        args: ['test'],
        cwd: '/etc',
        timeoutMs: 1000,
        shell: false,
        linkedReqIds: [],
        linkedTaskIds: [],
        linkedAcIds: [],
      },
      '/tmp/ws',
    );
    assert.equal(escape.ok, false);
  });

  it('coverage blocks Ready when REQ unproven', () => {
    const draft = draftSpecificationFromSeed({
      objectiveSeed: 'Ship feature Z with tests',
    });
    const frozen = freezeSpecification(draft, 'u1');
    assert.equal(frozen.ok, true);
    if (!frozen.ok) return;
    const plan = compileTechnicalApproach(frozen.spec);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const graph = compileTaskGraph({ spec: frozen.spec, approach: plan.approach });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;
    const report = runCoverageConvergence({
      engineeringTaskId: 'etask_x',
      spec: frozen.spec,
      graph: graph.graph,
      validationRuns: [],
      anchors: { headSha: 'h', diffHash: 'd', policyHash: 'p' },
      specApproved: true,
      planApproved: true,
      policyBlocked: false,
    });
    assert.ok(report.actionableGapCount > 0);
  });

  it('GitGate denies missing/stale proof', () => {
    const { repo, bus } = setup();
    const deny = evaluateGitGate({
      repo,
      proofHandle: null,
      current: {
        workspaceId: 'ws',
        headSha: 'h1',
        diffHash: 'd1',
        policyHash: 'p1',
      },
    });
    assert.equal(deny.allowed, false);
    assert.equal(deny.code, ERR_CODES.ERR_PROOF_REQUIRED);

    // Build ready path + proof
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws',
      objectiveSeed: 'Implement proven feature with tests fully',
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as any).engineeringTaskId;
    // shortcut: set task to ready with empty coverage via issueShipProof guards
    const task = repo.getTask(id)!;
    const coverage = {
      reportId: 'cvg_empty',
      engineeringTaskId: id,
      generatedAt: nowIso(),
      gaps: [],
      actionableGapCount: 0,
      inputsHash: 'x',
    };
    repo.applyTransaction({
      task: { ...task, status: 'ready', readiness: 'Ready' },
      events: [],
      coverage,
    });
    const anchors = {
      workspaceId: 'ws',
      repositorySnapshotHash: sha256Hex('s'),
      baseSha: null,
      headSha: 'h1',
      diffHash: 'd1',
      policyHash: 'p1',
      specificationVersion: 1,
      planVersion: 1,
      taskGraphVersion: 1,
      generatedAt: nowIso(),
    };
    const issued = issueShipProof({
      repo,
      task: { ...task, status: 'ready', readiness: 'Ready' },
      anchors,
      validationRuns: [],
      coverage,
      readiness: 'Ready',
    });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const ok = evaluateGitGate({
      repo,
      proofHandle: issued.proof.proofHandle,
      current: {
        workspaceId: 'ws',
        headSha: 'h1',
        diffHash: 'd1',
        policyHash: 'p1',
      },
    });
    assert.equal(ok.allowed, true);

    const staleHead = evaluateGitGate({
      repo,
      proofHandle: issued.proof.proofHandle,
      current: {
        workspaceId: 'ws',
        headSha: 'h2',
        diffHash: 'd1',
        policyHash: 'p1',
      },
    });
    assert.equal(staleHead.allowed, false);
    assert.equal(staleHead.code, ERR_CODES.ERR_PROOF_STALE_HEAD);

    const staleDiff = evaluateGitGate({
      repo,
      proofHandle: issued.proof.proofHandle,
      current: {
        workspaceId: 'ws',
        headSha: 'h1',
        diffHash: 'd2',
        policyHash: 'p1',
      },
    });
    assert.equal(staleDiff.allowed, false);
    assert.equal(staleDiff.code, ERR_CODES.ERR_PROOF_STALE_DIFF);

    const stalePol = evaluateGitGate({
      repo,
      proofHandle: issued.proof.proofHandle,
      current: {
        workspaceId: 'ws',
        headSha: 'h1',
        diffHash: 'd1',
        policyHash: 'p2',
      },
    });
    assert.equal(stalePol.allowed, false);
    assert.equal(stalePol.code, ERR_CODES.ERR_PROOF_STALE_POLICY);
  });

  it('consistency is deterministic for same inputs', () => {
    const draft = draftSpecificationFromSeed({
      objectiveSeed: 'Deterministic consistency fixture objective',
    });
    const frozen = freezeSpecification(draft, 'u1');
    assert.equal(frozen.ok, true);
    if (!frozen.ok) return;
    const plan = compileTechnicalApproach(frozen.spec);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const graph = compileTaskGraph({ spec: frozen.spec, approach: plan.approach });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;
    const a = analyzeConsistency({
      engineeringTaskId: 'etask_1',
      spec: frozen.spec,
      approach: plan.approach,
      graph: graph.graph,
    });
    const b = analyzeConsistency({
      engineeringTaskId: 'etask_1',
      spec: frozen.spec,
      approach: plan.approach,
      graph: graph.graph,
    });
    assert.equal(a.inputsHash, b.inputsHash);
    assert.equal(a.criticalCount, b.criticalCount);
    assert.deepEqual(
      a.findings.map((f) => f.findingId),
      b.findings.map((f) => f.findingId),
    );
  });
});
