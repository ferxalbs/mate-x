/**
 * Main-process EngineeringTask command bus.
 * load → guard transition → apply → event → persist (atomic).
 * NES-1.3
 */

import type {
  ActorRef,
  CaptureTaskInput,
  CommandResponse,
  DomainEvent,
  EngineeringCommandType,
  EngineeringTask,
  EngineeringTaskSummary,
  ErrorCode,
  RejectApprovalInput,
} from '../../contracts/engineering-task';
import {
  ERR_CODES,
  getTransition,
  isTerminalStatus,
} from '../../contracts/engineering-task';
import {
  newCommandId,
  newEngineeringTaskId,
  newEventId,
  nowIso,
  sha256Hex,
} from './ids';
import { computeReadiness } from './readiness';
import {
  EngineeringRepository,
  getEngineeringRepository,
} from './repository';

export type DispatchableCommand =
  | ({ type: 'CaptureTask' } & CaptureTaskInput & {
      actor?: ActorRef;
      commandId?: string;
    })
  | {
      type: EngineeringCommandType;
      engineeringTaskId: string;
      workspaceId: string;
      actor?: ActorRef;
      commandId?: string;
      expectedAggregateVersion?: number;
      reason?: string;
      reasonCode?: ErrorCode | string;
      rejectTarget?: 'planned' | 'clarifying';
      note?: string;
      // Extended payloads filled by later phases
      [key: string]: unknown;
    };

function fail(
  code: ErrorCode,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): CommandResponse<never> {
  return {
    ok: false,
    error: { code, message, retryable, details },
  };
}

function toSummary(task: EngineeringTask, openDecisionCount = 0): EngineeringTaskSummary {
  return {
    engineeringTaskId: task.engineeringTaskId,
    workspaceId: task.workspaceId,
    pathKind: task.pathKind,
    title: task.title,
    status: task.status,
    readiness: task.readiness,
    aggregateVersion: task.aggregateVersion,
    objectivePreview: task.objectiveSeed.slice(0, 200),
    openDecisionCount,
    activeAgentIds: [],
    updatedAt: task.updatedAt,
    conversationId: task.conversationId,
  };
}

function defaultReadiness(status: EngineeringTask['status']) {
  return computeReadiness({
    status,
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
  });
}

function appendEvent(
  task: EngineeringTask,
  type: string,
  payload: unknown,
  actor: ActorRef,
  commandId: string,
  seq: number,
): DomainEvent {
  const occurredAt = nowIso();
  const integrityHash = sha256Hex(
    JSON.stringify({ type, payload, seq, commandId, occurredAt }),
  );
  return {
    eventId: newEventId(),
    engineeringTaskId: task.engineeringTaskId,
    seq,
    type,
    payload,
    actor,
    causedByCommandId: commandId,
    occurredAt,
    integrityHash,
  };
}

export class EngineeringCommandBus {
  constructor(private readonly repo: EngineeringRepository = getEngineeringRepository()) {}

  dispatch(command: DispatchableCommand): CommandResponse {
    if (command.type === 'CaptureTask') {
      return this.captureTask(command as Extract<DispatchableCommand, { type: 'CaptureTask' }>);
    }
    switch (command.type) {
      case 'StartClarification':
      case 'FreezeSpecification':
      case 'StartPlanCompilation':
      case 'CompletePlanCompilation':
      case 'CompileTaskGraph':
      case 'SubmitForApproval':
      case 'ApprovePlanAndTasks':
      case 'RejectApproval':
      case 'BeginVerification':
      case 'BeginCoverageConvergence':
      case 'AcceptConvergence':
      case 'EnqueueRemediation':
      case 'BlockTask':
      case 'FailTask':
      case 'CancelTask':
      case 'ResumeTask':
      case 'AnswerDecision':
      case 'AcquireLease':
      case 'CompleteTask':
      case 'IssueShipProof':
        return this.transitionCommand(
          command as Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
        );
      default:
        return fail(
          ERR_CODES.ERR_NOT_READY,
          `Command ${String((command as { type: string }).type)} not implemented yet or requires extended handler`,
          false,
        );
    }
  }

  private captureTask(
    input: Extract<DispatchableCommand, { type: 'CaptureTask' }>,
  ): CommandResponse<EngineeringTaskSummary> {
    const objectiveSeed = input.objectiveSeed?.trim() ?? '';
    if (!input.workspaceId?.trim()) {
      return fail(ERR_CODES.ERR_WORKSPACE_REQUIRED, 'workspaceId is required');
    }
    if (!objectiveSeed) {
      return fail(ERR_CODES.ERR_OBJECTIVE_EMPTY, 'objectiveSeed must be non-empty');
    }

    const transition = getTransition(null, 'CaptureTask');
    if (!transition.ok) {
      return fail(transition.code, transition.message);
    }

    const actor: ActorRef = input.actor ?? { kind: 'human' };
    const commandId = input.commandId ?? newCommandId();
    const now = nowIso();
    const engineeringTaskId = newEngineeringTaskId();
    const title =
      input.title?.trim() ||
      objectiveSeed.split('\n')[0]!.slice(0, 80) ||
      'Untitled engineering task';

    const task: EngineeringTask = {
      engineeringTaskId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId ?? null,
      pathKind: input.pathKind ?? 'full',
      title,
      objectiveSeed,
      status: transition.to,
      aggregateVersion: 1,
      activeSpecificationVersion: null,
      activePlanVersion: null,
      activeTaskGraphVersion: null,
      policyPackRef: null,
      readiness: defaultReadiness(transition.to),
      priorLegalStatus: null,
      blockedReasonCode: null,
      lastExecutionId: null,
      lastProofId: null,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      readyAt: null,
    };

    // Prompt is raw intent only — status is captured, never specified.
    const event = appendEvent(
      task,
      'TaskCaptured',
      {
        objectiveSeed,
        pathKind: task.pathKind,
        title: task.title,
        conversationId: task.conversationId,
      },
      actor,
      commandId,
      1,
    );

    this.repo.applyTransaction({
      task,
      events: [event],
      commandId,
      expectedAggregateVersion: undefined,
    });

    return {
      ok: true,
      data: toSummary(task),
      events: [event],
      aggregateVersion: task.aggregateVersion,
      readiness: task.readiness,
    };
  }

  private transitionCommand(
    command: Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
  ): CommandResponse<EngineeringTaskSummary> {
    const task = this.repo.getTask(command.engineeringTaskId);
    if (!task) {
      return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'EngineeringTask not found');
    }
    if (task.workspaceId !== command.workspaceId) {
      return fail(ERR_CODES.ERR_TASK_NOT_FOUND, 'EngineeringTask workspace mismatch');
    }

    if (
      command.expectedAggregateVersion !== undefined &&
      command.expectedAggregateVersion !== task.aggregateVersion
    ) {
      return fail(
        ERR_CODES.ERR_VERSION_CONFLICT,
        `expectedAggregateVersion ${command.expectedAggregateVersion} != ${task.aggregateVersion}`,
        true,
      );
    }

    const actor: ActorRef = command.actor ?? { kind: 'human' };

    // Agent cannot approve / accept readiness-critical human commands
    if (
      actor.kind === 'agent' &&
      (command.type === 'ApprovePlanAndTasks' ||
        command.type === 'AcceptConvergence' ||
        command.type === 'FreezeSpecification')
    ) {
      return fail(
        ERR_CODES.ERR_AGENT_CANNOT_APPROVE,
        `Agent cannot execute ${command.type}`,
      );
    }

    const options =
      command.type === 'RejectApproval'
        ? { rejectTarget: (command as RejectApprovalInput).rejectTarget ?? 'planned' as const }
        : command.type === 'ResumeTask'
          ? { resumeTo: task.priorLegalStatus ?? undefined }
          : undefined;

    const transition = getTransition(task.status, command.type, options);
    if (!transition.ok) {
      return fail(transition.code, transition.message);
    }

    // Extended guards for commands that require later-phase state
    const guard = this.guardExtended(task, command);
    if (guard) return guard;

    const commandId = command.commandId ?? newCommandId();
    const events = this.repo.getEvents(task.engineeringTaskId);
    const nextSeq = (events[events.length - 1]?.seq ?? 0) + 1;
    const now = nowIso();

    const priorLegalStatus =
      command.type === 'BlockTask' || command.type === 'FailTask'
        ? task.status
        : task.priorLegalStatus;

    let nextStatus = transition.to;
    if (command.type === 'ResumeTask') {
      nextStatus = task.priorLegalStatus && !isTerminalStatus(task.priorLegalStatus)
        ? task.priorLegalStatus
        : transition.to === 'blocked'
          ? 'captured'
          : transition.to;
    }

    const next: EngineeringTask = {
      ...task,
      status: nextStatus,
      aggregateVersion: task.aggregateVersion + 1,
      priorLegalStatus:
        command.type === 'ResumeTask' ? null : priorLegalStatus,
      blockedReasonCode:
        command.type === 'BlockTask'
          ? ((command.reasonCode as ErrorCode) ?? ERR_CODES.ERR_INVARIANT_VIOLATION)
          : command.type === 'ResumeTask'
            ? null
            : task.blockedReasonCode,
      readiness: defaultReadiness(nextStatus),
      updatedAt: now,
      cancelledAt: command.type === 'CancelTask' ? now : task.cancelledAt,
      readyAt: command.type === 'AcceptConvergence' ? now : task.readyAt,
    };

    // Phase hooks mutate nested docs (spec freeze, plan, etc.) via command handlers registry
    const phaseResult = this.applyPhaseSideEffects(next, command, actor, commandId, nextSeq);
    if ('ok' in phaseResult && phaseResult.ok === false) {
      return phaseResult;
    }
    const applied = phaseResult as PhaseApplyResult;

    const event = appendEvent(
      next,
      `${command.type}Applied`,
      {
        from: task.status,
        to: next.status,
        reason: command.reason,
        reasonCode: command.reasonCode,
        ...applied.eventPayload,
      },
      actor,
      commandId,
      nextSeq,
    );

    // Recompute readiness after phase updates
    next.readiness = applied.readiness ?? defaultReadiness(next.status);

    this.repo.applyTransaction({
      task: next,
      events: [event, ...applied.extraEvents],
      commandId,
      expectedAggregateVersion: task.aggregateVersion,
      specification: applied.specification,
      approach: applied.approach,
      taskGraph: applied.taskGraph,
      decisions: applied.decisions,
      lease: applied.lease,
      validationRun: applied.validationRun,
      coverage: applied.coverage,
      proof: applied.proof,
      consistencyReport: applied.consistencyReport,
      execution: applied.execution,
    });

    const openDecisions = applied.openDecisionCount ?? 0;
    return {
      ok: true,
      data: toSummary(next, openDecisions),
      events: [event, ...applied.extraEvents],
      aggregateVersion: next.aggregateVersion,
      readiness: next.readiness,
    };
  }

  /**
   * Basic guards that do not require full phase modules.
   * Phase modules register deeper checks via setPhaseHandler.
   */
  private guardExtended(
    task: EngineeringTask,
    command: Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
  ): CommandResponse<never> | null {
    if (this.phaseHandler) {
      return this.phaseHandler.guard?.(task, command) ?? null;
    }
    // Until phase handlers wire Freeze/Approve, only pure status transitions.
    if (
      command.type === 'FreezeSpecification' ||
      command.type === 'CompletePlanCompilation' ||
      command.type === 'SubmitForApproval' ||
      command.type === 'ApprovePlanAndTasks' ||
      command.type === 'AcceptConvergence' ||
      command.type === 'BeginVerification' ||
      command.type === 'BeginCoverageConvergence' ||
      command.type === 'EnqueueRemediation' ||
      command.type === 'CompileTaskGraph' ||
      command.type === 'StartPlanCompilation'
    ) {
      // Allow transition for skeleton; phase handler will replace this.
      return null;
    }
    return null;
  }

  private phaseHandler: PhaseHandler | null = null;

  setPhaseHandler(handler: PhaseHandler | null): void {
    this.phaseHandler = handler;
  }

  private applyPhaseSideEffects(
    task: EngineeringTask,
    command: Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
    actor: ActorRef,
    commandId: string,
    nextSeq: number,
  ): PhaseApplyResult | CommandResponse<never> {
    if (this.phaseHandler?.apply) {
      return this.phaseHandler.apply(task, command, actor, commandId, nextSeq);
    }
    return { ok: true, eventPayload: {}, extraEvents: [] };
  }

  getTask(engineeringTaskId: string): EngineeringTask | null {
    return this.repo.getTask(engineeringTaskId);
  }

  listTasks(workspaceId: string): EngineeringTaskSummary[] {
    return this.repo.listTasks(workspaceId).map((t) => toSummary(t));
  }

  getRepository(): EngineeringRepository {
    return this.repo;
  }
}

export interface PhaseApplyResult {
  ok: true;
  eventPayload: Record<string, unknown>;
  extraEvents: DomainEvent[];
  specification?: import('../../contracts/engineering-task').SpecificationDocument;
  approach?: import('../../contracts/engineering-task').TechnicalApproachDocument;
  taskGraph?: import('../../contracts/engineering-task').TaskGraphDocument;
  decisions?: import('../../contracts/engineering-task').DecisionQueueItem[];
  lease?: import('../../contracts/engineering-task').TaskLease;
  validationRun?: import('../../contracts/engineering-task').ValidationRun;
  coverage?: import('../../contracts/engineering-task').CoverageConvergenceReport;
  proof?: import('../../contracts/engineering-task').ShipProof;
  consistencyReport?: { reportId: string; document: unknown };
  execution?: {
    executionId: string;
    workPlanId: string | null;
    status: string;
    document: unknown;
  };
  readiness?: import('../../contracts/engineering-task').ReadinessLabel;
  openDecisionCount?: number;
}

export interface PhaseHandler {
  guard?(
    task: EngineeringTask,
    command: Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
  ): CommandResponse<never> | null;
  apply?(
    task: EngineeringTask,
    command: Exclude<DispatchableCommand, { type: 'CaptureTask' }>,
    actor: ActorRef,
    commandId: string,
    nextSeq: number,
  ): PhaseApplyResult | CommandResponse<never>;
}

let defaultBus: EngineeringCommandBus | null = null;

export function getEngineeringCommandBus(): EngineeringCommandBus {
  if (!defaultBus) {
    defaultBus = new EngineeringCommandBus();
  }
  return defaultBus;
}

export function resetEngineeringCommandBusForTests(
  repo?: EngineeringRepository,
): EngineeringCommandBus {
  defaultBus = new EngineeringCommandBus(repo ?? getEngineeringRepository());
  return defaultBus;
}
