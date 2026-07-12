/**
 * Phase handler — wires intent/plan/graph/consistency/coverage into command bus.
 * NES-2 → NES-6
 */

import type {
  ActorRef,
  CommandResponse,
  EngineeringTask,
  ErrorCode,
  SpecificationDocument,
} from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import { answerDecision, buildInitialDecisionQueue, openCriticalCount } from './clarification';
import type { DispatchableCommand, PhaseApplyResult, PhaseHandler } from './command-bus';
import { analyzeConsistency } from './consistency';
import { runCoverageConvergence } from './coverage-convergence';
import {
  draftSpecificationFromSeed,
  freezeSpecification,
} from './intent-compiler';
import {
  acquireLease,
  completeTaskWithEvidence,
  readyTasks,
} from './orchestrator';
import { compileTechnicalApproach } from './plan-compiler';
import { ensureDefaultPolicyPack } from './policy-pack';
import { computeReadiness } from './readiness';
import type { EngineeringRepository } from './repository';
import { issueShipProof } from './ship-proof';
import { compileTaskGraph } from './task-graph-compiler';
import { nowIso, sha256Hex } from './ids';

function fail(
  code: ErrorCode,
  message: string,
): CommandResponse<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

export function createPhaseHandler(repo: EngineeringRepository): PhaseHandler {
  return {
    guard(task, command) {
      const bundle = repo.getBundle(task.engineeringTaskId);
      if (!bundle) return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'bundle missing');

      if (command.type === 'FreezeSpecification') {
        // draft if missing
        return null;
      }

      if (command.type === 'SubmitForApproval') {
        const graphVer = task.activeTaskGraphVersion;
        if (graphVer == null) {
          return fail(ERR_CODES.ERR_TASK_GRAPH_INVALID, 'task graph required');
        }
        const graph = bundle.taskGraphs.get(graphVer) ?? null;
        const specVer = task.activeSpecificationVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        const approachVer = task.activePlanVersion;
        const approach =
          approachVer != null ? bundle.approaches.get(approachVer) : null;
        if (!spec?.frozenAt) {
          return fail(ERR_CODES.ERR_NOT_READY, 'specification not frozen');
        }
        const report = analyzeConsistency({
          engineeringTaskId: task.engineeringTaskId,
          spec,
          approach: approach ?? null,
          graph,
        });
        if (report.criticalCount > 0) {
          return fail(
            ERR_CODES.ERR_CONSISTENCY_CRITICAL,
            `CRITICAL consistency findings: ${report.criticalCount}`,
          );
        }
      }

      if (command.type === 'AcceptConvergence') {
        const coverage = [...bundle.coverageReports.values()].at(-1);
        if (!coverage || coverage.actionableGapCount > 0) {
          return fail(
            ERR_CODES.ERR_INVARIANT_VIOLATION,
            'coverage gaps remain',
          );
        }
      }

      if (command.type === 'CompleteTask') {
        const evidenceIds = (command.evidenceIds as string[] | undefined) ?? [];
        const actor = command.actor as ActorRef | undefined;
        if (evidenceIds.length === 0 && actor?.kind === 'agent') {
          return fail(
            ERR_CODES.ERR_TASK_EVIDENCE_REQUIRED,
            'agent CompleteTask requires evidence',
          );
        }
      }

      return null;
    },

    apply(task, command, actor, _commandId, _nextSeq) {
      const bundle = repo.getBundle(task.engineeringTaskId);
      if (!bundle) {
        return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'bundle missing');
      }

      if (command.type === 'StartClarification') {
        let spec =
          task.activeSpecificationVersion != null
            ? bundle.specifications.get(task.activeSpecificationVersion)
            : undefined;
        if (!spec) {
          // Draft from seed only — do not inject meaningless critical questions.
          // Clarification is conditional: open questions must already exist on the draft
          // or arrive via ApplyPhaseResult(clarification_required) artifacts.
          spec = draftSpecificationFromSeed({
            objectiveSeed: task.objectiveSeed,
            verifyOnly: task.pathKind === 'verify_only',
          });
        }
        const decisions = buildInitialDecisionQueue(spec);
        task.activeSpecificationVersion = spec.version;
        return {
          ok: true,
          eventPayload: { decisionCount: decisions.length },
          extraEvents: [],
          specification: spec,
          decisions,
          openDecisionCount: openCriticalCount(decisions),
          readiness: computeReadiness({
            status: task.status,
            openCriticalDecisions: openCriticalCount(decisions),
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
          }),
        } satisfies PhaseApplyResult;
      }

      if (command.type === 'AnswerDecision') {
        const decisionId = String(command.decisionId ?? '');
        const items = [...bundle.decisions.values()];
        const specVer = task.activeSpecificationVersion;
        const spec =
          (specVer != null ? bundle.specifications.get(specVer) : null) ??
          draftSpecificationFromSeed({
            objectiveSeed: task.objectiveSeed,
            verifyOnly: task.pathKind === 'verify_only',
          });
        const result = answerDecision({
          items,
          decisionId,
          chosenOptionId: command.chosenOptionId as string | undefined,
          customValue: command.customValue as string | undefined,
          skipWithAck: command.skipWithAck as boolean | undefined,
          actor,
          spec,
        });
        if (!result.ok) {
          return fail(ERR_CODES.ERR_DECISION_NOT_FOUND, result.reason);
        }
        task.activeSpecificationVersion = result.spec.version;
        return {
          ok: true,
          eventPayload: { decisionId },
          extraEvents: [],
          specification: result.spec,
          decisions: result.items,
          openDecisionCount: openCriticalCount(result.items),
        };
      }

      if (command.type === 'FreezeSpecification') {
        let draft =
          task.activeSpecificationVersion != null
            ? bundle.specifications.get(task.activeSpecificationVersion)
            : undefined;
        if (!draft) {
          draft = draftSpecificationFromSeed({
            objectiveSeed: task.objectiveSeed,
            verifyOnly: task.pathKind === 'verify_only',
          });
        }
        // Clear critical questions only if answered; freezeSpecification checks
        const open = [...bundle.decisions.values()].filter(
          (d) => d.status === 'open' && d.required,
        );
        if (open.length > 0) {
          return fail(
            ERR_CODES.ERR_OPEN_CRITICAL_QUESTIONS,
            `${open.length} critical decisions open`,
          );
        }
        const approvalIdentity =
          actor.kind === 'human' ? actor.userId ?? 'human' : '';
        if (!approvalIdentity) {
          return fail(
            ERR_CODES.ERR_AGENT_CANNOT_APPROVE,
            'FreezeSpecification requires human',
          );
        }
        const frozen = freezeSpecification(draft, approvalIdentity);
        if (!frozen.ok) {
          return fail(ERR_CODES.ERR_SPEC_QUALITY_FAILED, frozen.reason);
        }
        const pack = ensureDefaultPolicyPack(repo);
        task.activeSpecificationVersion = frozen.spec.version;
        task.policyPackRef = {
          policyPackId: pack.policyPackId,
          version: pack.version,
          policyHash: pack.policyHash,
        };
        return {
          ok: true,
          eventPayload: {
            specificationId: frozen.spec.specificationId,
            version: frozen.spec.version,
            contentHash: frozen.spec.contentHash,
          },
          extraEvents: [],
          specification: frozen.spec,
        };
      }

      if (command.type === 'StartPlanCompilation') {
        return { ok: true, eventPayload: {}, extraEvents: [] };
      }

      if (command.type === 'CompletePlanCompilation') {
        const specVer = task.activeSpecificationVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        if (!spec?.frozenAt) {
          return fail(ERR_CODES.ERR_NOT_READY, 'need frozen specification');
        }
        const compiled = compileTechnicalApproach(spec, (task.activePlanVersion ?? 0) + 1);
        if (!compiled.ok) {
          return fail(ERR_CODES.ERR_DECISION_UNLINKED_REQ, compiled.reason);
        }
        task.activePlanVersion = compiled.approach.version;
        return {
          ok: true,
          eventPayload: { approachId: compiled.approach.approachId },
          extraEvents: [],
          approach: compiled.approach,
        };
      }

      if (command.type === 'CompileTaskGraph') {
        const specVer = task.activeSpecificationVersion;
        const planVer = task.activePlanVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        const approach = planVer != null ? bundle.approaches.get(planVer) : null;
        if (!spec || !approach) {
          return fail(ERR_CODES.ERR_NOT_READY, 'spec and approach required');
        }
        const compiled = compileTaskGraph({
          spec,
          approach,
          version: (task.activeTaskGraphVersion ?? 0) + 1,
        });
        if (!compiled.ok) {
          return fail(ERR_CODES.ERR_TASK_GRAPH_INVALID, compiled.reason);
        }
        task.activeTaskGraphVersion = compiled.graph.version;
        return {
          ok: true,
          eventPayload: { taskGraphId: compiled.graph.taskGraphId },
          extraEvents: [],
          taskGraph: compiled.graph,
        };
      }

      if (command.type === 'SubmitForApproval') {
        const specVer = task.activeSpecificationVersion;
        const planVer = task.activePlanVersion;
        const graphVer = task.activeTaskGraphVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        const approach = planVer != null ? bundle.approaches.get(planVer) : null;
        const graph = graphVer != null ? bundle.taskGraphs.get(graphVer) : null;
        if (!spec || !graph) {
          return fail(ERR_CODES.ERR_NOT_READY, 'spec/graph required');
        }
        const report = analyzeConsistency({
          engineeringTaskId: task.engineeringTaskId,
          spec,
          approach: approach ?? null,
          graph,
        });
        if (report.criticalCount > 0) {
          return fail(
            ERR_CODES.ERR_CONSISTENCY_CRITICAL,
            `CRITICAL: ${report.criticalCount}`,
          );
        }
        return {
          ok: true,
          eventPayload: { consistencyReportId: report.reportId },
          extraEvents: [],
          consistencyReport: { reportId: report.reportId, document: report },
        };
      }

      if (command.type === 'ApprovePlanAndTasks') {
        return {
          ok: true,
          eventPayload: { approvedBy: actor },
          extraEvents: [],
        };
      }

      if (command.type === 'AcquireLease') {
        const graphVer = task.activeTaskGraphVersion;
        const graph = graphVer != null ? bundle.taskGraphs.get(graphVer) : null;
        const taskId = String(command.taskId ?? '');
        const node = graph?.tasks.find((t) => t.taskId === taskId);
        if (!node) {
          return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'graph task not found');
        }
        const result = acquireLease({
          repo,
          workspaceId: task.workspaceId,
          engineeringTaskId: task.engineeringTaskId,
          task: node,
          agentId: String(command.agentId ?? 'agent'),
          multiAgentLeases: false,
        });
        if (!result.ok) {
          return fail(result.code as ErrorCode, result.message);
        }
        return {
          ok: true,
          eventPayload: { leaseId: result.lease.leaseId },
          extraEvents: [],
          lease: result.lease,
        };
      }

      if (command.type === 'CompleteTask') {
        const graphVer = task.activeTaskGraphVersion;
        const graph = graphVer != null ? bundle.taskGraphs.get(graphVer) : null;
        if (!graph) {
          return fail(ERR_CODES.ERR_TASK_GRAPH_INVALID, 'no graph');
        }
        const taskId = String(command.taskId ?? '');
        const node = graph.tasks.find((t) => t.taskId === taskId);
        if (!node) {
          return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'task not found');
        }
        const completed = completeTaskWithEvidence({
          task: node,
          evidenceIds: (command.evidenceIds as string[]) ?? [],
          actorKind: actor.kind,
          humanReason: command.humanReason as string | undefined,
        });
        if (!completed.ok) {
          return fail(completed.code as ErrorCode, completed.message);
        }
        const nextGraph = {
          ...graph,
          tasks: graph.tasks.map((t) =>
            t.taskId === taskId ? completed.task : t,
          ),
        };
        return {
          ok: true,
          eventPayload: { taskId, evidenceIds: completed.task.evidenceIds },
          extraEvents: [],
          taskGraph: nextGraph,
        };
      }

      if (command.type === 'BeginVerification') {
        return { ok: true, eventPayload: {}, extraEvents: [] };
      }

      if (command.type === 'BeginCoverageConvergence') {
        const specVer = task.activeSpecificationVersion;
        const graphVer = task.activeTaskGraphVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        const graph = graphVer != null ? bundle.taskGraphs.get(graphVer) : null;
        if (!spec || !graph) {
          return fail(ERR_CODES.ERR_NOT_READY, 'spec/graph required');
        }
        const anchors = {
          headSha: String(command.headSha ?? 'unknown'),
          diffHash: String(command.diffHash ?? 'unknown'),
          policyHash: task.policyPackRef?.policyHash ?? 'none',
        };
        const coverage = runCoverageConvergence({
          engineeringTaskId: task.engineeringTaskId,
          spec,
          graph,
          validationRuns: [...bundle.validationRuns.values()],
          anchors,
          specApproved: Boolean(spec.frozenAt),
          planApproved: task.status === 'converging' || task.status === 'verifying' || true,
          policyBlocked: false,
        });
        return {
          ok: true,
          eventPayload: { reportId: coverage.reportId, gaps: coverage.actionableGapCount },
          extraEvents: [],
          coverage,
        };
      }

      if (command.type === 'AcceptConvergence') {
        return { ok: true, eventPayload: {}, extraEvents: [] };
      }

      if (command.type === 'EnqueueRemediation') {
        const specVer = task.activeSpecificationVersion;
        const planVer = task.activePlanVersion;
        const graphVer = task.activeTaskGraphVersion;
        const spec = specVer != null ? bundle.specifications.get(specVer) : null;
        const approach = planVer != null ? bundle.approaches.get(planVer) : null;
        const graph = graphVer != null ? bundle.taskGraphs.get(graphVer) : null;
        if (!spec || !approach || !graph) {
          return fail(ERR_CODES.ERR_NOT_READY, 'missing plan artifacts');
        }
        const remediation = compileTaskGraph({
          spec,
          approach,
          version: graph.version + 1,
          remediationOf: {
            parentTaskId: graph.tasks[0]?.taskId ?? 'unknown',
            title: String(command.title ?? 'Remediation'),
          },
        });
        if (!remediation.ok) {
          return fail(ERR_CODES.ERR_TASK_GRAPH_INVALID, remediation.reason);
        }
        const merged = {
          ...graph,
          version: remediation.graph.version,
          tasks: [...graph.tasks, ...remediation.graph.tasks],
        };
        task.activeTaskGraphVersion = merged.version;
        return {
          ok: true,
          eventPayload: { appended: remediation.graph.tasks.length },
          extraEvents: [],
          taskGraph: merged,
        };
      }

      if (command.type === 'IssueShipProof') {
        const coverage = [...bundle.coverageReports.values()].at(-1);
        if (!coverage) {
          return fail(ERR_CODES.ERR_NOT_READY, 'coverage required');
        }
        const anchors = {
          workspaceId: task.workspaceId,
          repositorySnapshotHash: String(command.repositorySnapshotHash ?? sha256Hex('snap')),
          baseSha: (command.baseSha as string | null) ?? null,
          headSha: String(command.headSha ?? 'HEAD'),
          diffHash: String(command.diffHash ?? sha256Hex('diff')),
          policyHash: task.policyPackRef?.policyHash ?? sha256Hex('pol'),
          specificationVersion: task.activeSpecificationVersion ?? 0,
          planVersion: task.activePlanVersion ?? 0,
          taskGraphVersion: task.activeTaskGraphVersion ?? 0,
          generatedAt: nowIso(),
        };
        const issued = issueShipProof({
          repo,
          task,
          anchors,
          validationRuns: [...bundle.validationRuns.values()],
          coverage,
          readiness: 'Ready',
        });
        if (!issued.ok) {
          return fail(issued.code as ErrorCode, issued.message);
        }
        task.lastProofId = issued.proof.proofId;
        return {
          ok: true,
          eventPayload: {
            proofId: issued.proof.proofId,
            proofHandle: issued.proof.proofHandle,
          },
          extraEvents: [],
          proof: issued.proof,
        };
      }

      return { ok: true, eventPayload: {}, extraEvents: [] };
    },
  };
}

export function driveHappyPathToReady(
  // helper for tests
  dispatch: (c: DispatchableCommand) => CommandResponse,
  workspaceId: string,
  objectiveSeed: string,
): CommandResponse {
  const cap = dispatch({
    type: 'CaptureTask',
    workspaceId,
    objectiveSeed,
  });
  if (!cap.ok) return cap;
  const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
  const steps: DispatchableCommand[] = [
    { type: 'FreezeSpecification', engineeringTaskId: id, workspaceId, actor: { kind: 'human', userId: 'u1' } },
    { type: 'StartPlanCompilation', engineeringTaskId: id, workspaceId },
    { type: 'CompletePlanCompilation', engineeringTaskId: id, workspaceId },
    { type: 'CompileTaskGraph', engineeringTaskId: id, workspaceId },
    { type: 'SubmitForApproval', engineeringTaskId: id, workspaceId },
    { type: 'ApprovePlanAndTasks', engineeringTaskId: id, workspaceId, actor: { kind: 'human', userId: 'u1' } },
  ];
  let last: CommandResponse = cap;
  for (const s of steps) {
    last = dispatch(s);
    if (!last.ok) return last;
  }
  return last;
}

export { readyTasks };

export type { EngineeringTask, SpecificationDocument };
