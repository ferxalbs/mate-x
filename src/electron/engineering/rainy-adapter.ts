/**
 * Rainy agent adapter — canonical scoped execution binding.
 * Agent cannot approve, freeze, accept convergence, or issue ship proof.
 * Production path requires real Rainy runner — no silent scaffold success.
 * NES-4 / CLOSURE 1
 */

import type {
  EngineeringTask,
  SpecificationDocument,
  TaskGraphDocument,
  TaskLease,
  TaskNode,
  TechnicalApproachDocument,
} from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import { nowIso } from './ids';
import type {
  ProductionRainyRunner,
  RainyErrorClass,
  RainyExecutionStatus,
  RainyScopedResponse,
} from './rainy-production-runner';
import { rainyResponseToAdapterFields } from './rainy-production-runner';

export type AgentFailureClass =
  | 'timeout'
  | 'cancelled'
  | 'tool_error'
  | 'policy'
  | 'capability'
  | 'stale_lease'
  | 'internal'
  | 'unknown';

export interface AgentCapabilityDeclaration {
  agentId: string;
  provider: string | null;
  canMutateRepository: boolean;
  canRunValidation: boolean;
  canApproveSpecification: false;
  canApprovePlan: false;
  canAcceptConvergence: false;
  canIssueShipProof: false;
  canAuthorEvidence: false;
  maxConcurrentLeases: number;
}

export interface CanonicalAgentScope {
  engineeringTaskId: string;
  leaseId: string;
  taskId: string;
  workspaceId: string;
  repositorySnapshotHash: string;
  headSha: string;
  baseSha: string;
  diffHash: string;
  approvedSpecificationVersion: number;
  approvedPlanVersion: number;
  taskGraphVersion: number;
  writePaths: string[];
  readPaths: string[];
}

export interface StructuredExecutionEvent {
  eventType:
    | 'started'
    | 'tool'
    | 'command'
    | 'progress'
    | 'completed'
    | 'failed'
    | 'cancelled';
  at: string;
  summary: string;
  toolName?: string;
  command?: string;
  paths?: string[];
  /** Never free-form model prose as evidence — structured only */
  structuredPayload?: Record<string, unknown>;
}

export interface StructuredExecutionResult {
  ok: boolean;
  status: RainyExecutionStatus | 'failed' | 'completed' | 'cancelled' | 'blocked';
  engineeringTaskId: string;
  graphTaskId: string;
  leaseId: string;
  taskId: string;
  workspaceId: string;
  baseSha: string;
  headSha: string;
  diffHash: string;
  specificationVersion: number;
  planVersion: number;
  taskGraphVersion: number;
  touchedPaths: string[];
  toolsInvoked: Array<{ toolName: string; summary: string; at: string }>;
  commandsRequested: string[];
  commandResults: Array<{ command: string; exitCode: number | null; at: string }>;
  toolActivity: Array<{ toolName: string; summary: string; at: string }>;
  commandActivity: Array<{ command: string; exitCode: number | null; at: string }>;
  events: StructuredExecutionEvent[];
  failureClass?: AgentFailureClass;
  failureMessage?: string;
  errorClass?: RainyErrorClass;
  provider?: string | null;
  model?: string | null;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number | null;
  cancelled: boolean;
  repositoryMutationRecord?: RainyScopedResponse['repositoryMutationRecord'];
  /** Explicitly not evidence */
  modelProse?: string;
}

export interface AgentAdapter {
  declareCapabilities(): AgentCapabilityDeclaration;
  executeScoped(input: {
    scope: CanonicalAgentScope;
    task: EngineeringTask;
    specification: SpecificationDocument;
    approach: TechnicalApproachDocument;
    graphTask: TaskNode;
    lease: TaskLease;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<StructuredExecutionResult>;
}

const RAINY_CAPABILITIES: AgentCapabilityDeclaration = {
  agentId: 'rainy',
  provider: 'rainy',
  canMutateRepository: true,
  canRunValidation: true,
  canApproveSpecification: false,
  canApprovePlan: false,
  canAcceptConvergence: false,
  canIssueShipProof: false,
  canAuthorEvidence: false,
  maxConcurrentLeases: 1,
};

export function rainyCapabilities(): AgentCapabilityDeclaration {
  return { ...RAINY_CAPABILITIES };
}

/**
 * Reject agent attempts at human-only commands.
 */
export function assertAgentCannotAuthorize(
  commandType: string,
  actorKind: string,
): { ok: true } | { ok: false; code: string; message: string } {
  const forbidden = new Set([
    'FreezeSpecification',
    'ApprovePlanAndTasks',
    'AcceptConvergence',
    'IssueShipProof',
    'SubmitForApproval',
  ]);
  if (actorKind === 'agent' && forbidden.has(commandType)) {
    return {
      ok: false,
      code: ERR_CODES.ERR_AGENT_CANNOT_APPROVE,
      message: `Agent cannot execute ${commandType}`,
    };
  }
  return { ok: true };
}

export function validateLeaseBinding(input: {
  lease: TaskLease;
  scope: CanonicalAgentScope;
  now?: number;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.lease.leaseId !== input.scope.leaseId) {
    return {
      ok: false,
      code: ERR_CODES.ERR_LEASE_CONFLICT,
      message: 'lease id mismatch',
    };
  }
  if (input.lease.status !== 'active') {
    return {
      ok: false,
      code: ERR_CODES.ERR_LEASE_CONFLICT,
      message: 'lease not active',
    };
  }
  const now = input.now ?? Date.now();
  if (new Date(input.lease.expiresAt).getTime() <= now) {
    return {
      ok: false,
      code: ERR_CODES.ERR_LEASE_CONFLICT,
      message: 'lease expired (stale)',
    };
  }
  if (input.lease.engineeringTaskId !== input.scope.engineeringTaskId) {
    return {
      ok: false,
      code: ERR_CODES.ERR_LEASE_CONFLICT,
      message: 'lease task mismatch',
    };
  }
  return { ok: true };
}

export type RainyAgentAdapterConfig =
  | {
      kind: 'production';
      rainyRunner: ProductionRainyRunner;
    }
  | {
      kind: 'injected';
      /** Test-only injected low-level runner — not the production scaffold */
      runner: (input: {
        scope: CanonicalAgentScope;
        graphTask: TaskNode;
        signal?: AbortSignal;
      }) => Promise<{
        touchedPaths: string[];
        toolActivity: StructuredExecutionResult['toolActivity'];
        commandActivity: StructuredExecutionResult['commandActivity'];
        events: StructuredExecutionEvent[];
        status?: RainyExecutionStatus;
        errorClass?: RainyErrorClass;
        errorMessage?: string;
        provider?: string;
        model?: string;
        tokenUsage?: StructuredExecutionResult['tokenUsage'];
        costUsd?: number | null;
        cancelled?: boolean;
        commandsRequested?: string[];
        toolsInvoked?: StructuredExecutionResult['toolsInvoked'];
        commandResults?: StructuredExecutionResult['commandResults'];
      }>;
    };

/**
 * Rainy-bound adapter: validates scope, rejects stale leases, returns structured results.
 * Production requires rainyRunner. No default scaffold success path.
 */
export class RainyAgentAdapter implements AgentAdapter {
  private readonly config: RainyAgentAdapterConfig | null;

  constructor(config?: RainyAgentAdapterConfig | ProductionRainyRunner | ((input: {
    scope: CanonicalAgentScope;
    graphTask: TaskNode;
    signal?: AbortSignal;
  }) => Promise<{
    touchedPaths: string[];
    toolActivity: StructuredExecutionResult['toolActivity'];
    commandActivity: StructuredExecutionResult['commandActivity'];
    events: StructuredExecutionEvent[];
  }>)) {
    if (!config) {
      this.config = null;
    } else if (typeof config === 'function') {
      this.config = { kind: 'injected', runner: config };
    } else if ('execute' in config && typeof config.execute === 'function') {
      this.config = { kind: 'production', rainyRunner: config as ProductionRainyRunner };
    } else {
      this.config = config as RainyAgentAdapterConfig;
    }
  }

  declareCapabilities(): AgentCapabilityDeclaration {
    return rainyCapabilities();
  }

  async executeScoped(input: {
    scope: CanonicalAgentScope;
    task: EngineeringTask;
    specification: SpecificationDocument;
    approach: TechnicalApproachDocument;
    graphTask: TaskNode;
    lease: TaskLease;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<StructuredExecutionResult> {
    // Bind every execution to task + lease + repository snapshot
    if (
      !input.scope.repositorySnapshotHash ||
      !input.scope.headSha ||
      !input.scope.baseSha ||
      !input.scope.diffHash
    ) {
      return baseFail(input, 'internal', 'missing repository snapshot binding', 'failed');
    }
    if (
      input.task.activeSpecificationVersion !==
      input.scope.approvedSpecificationVersion
    ) {
      return baseFail(input, 'stale_lease', 'specification version mismatch', 'failed');
    }
    if (input.task.activePlanVersion !== input.scope.approvedPlanVersion) {
      return baseFail(input, 'stale_lease', 'plan version mismatch', 'failed');
    }
    if (
      input.task.activeTaskGraphVersion !== undefined &&
      input.task.activeTaskGraphVersion !== null &&
      input.task.activeTaskGraphVersion !== input.scope.taskGraphVersion
    ) {
      return baseFail(input, 'stale_lease', 'task graph version mismatch', 'failed');
    }

    const leaseCheck = validateLeaseBinding({
      lease: input.lease,
      scope: input.scope,
    });
    if (!leaseCheck.ok) {
      return baseFail(input, 'stale_lease', leaseCheck.message, 'failed');
    }

    // Agent must receive approved docs only
    if (!input.specification.frozenAt) {
      return baseFail(input, 'policy', 'specification not frozen', 'blocked');
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    } else {
      input.signal?.addEventListener('abort', onAbort);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (input.timeoutMs && input.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, input.timeoutMs);
    }

    try {
      if (controller.signal.aborted || input.signal?.aborted) {
        return baseFail(
          input,
          timedOut ? 'timeout' : 'cancelled',
          timedOut ? 'timeout before start' : 'cancelled before start',
          timedOut ? 'timeout' : 'cancelled',
        );
      }

      if (!this.config) {
        // CRITICAL: no scaffold success — fail closed without production runner
        return baseFail(
          input,
          'capability',
          'production Rainy runner not configured — refusing scaffold success path',
          'blocked',
        );
      }

      if (this.config.kind === 'production') {
        const response = await this.config.rainyRunner.execute({
          scope: input.scope,
          graphTask: input.graphTask,
          objective: input.specification.objective || input.task.objectiveSeed,
          baseSha: input.scope.baseSha,
          diffHash: input.scope.diffHash,
          signal: controller.signal,
          timeoutMs: input.timeoutMs,
        });
        return mapProductionResponse(input, response);
      }

      const out = await this.config.runner({
        scope: input.scope,
        graphTask: input.graphTask,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return baseFail(
          input,
          timedOut ? 'timeout' : 'cancelled',
          timedOut ? 'timeout' : 'cancelled',
          timedOut ? 'timeout' : 'cancelled',
        );
      }
      const status = out.status ?? (out.errorClass ? 'failed' : 'completed');
      const ok =
        (status === 'completed' || status === 'partial') &&
        !out.cancelled &&
        !out.errorClass;
      return {
        ok,
        status,
        engineeringTaskId: input.scope.engineeringTaskId,
        graphTaskId: input.scope.taskId,
        leaseId: input.scope.leaseId,
        taskId: input.scope.taskId,
        workspaceId: input.scope.workspaceId,
        baseSha: input.scope.baseSha,
        headSha: input.scope.headSha,
        diffHash: input.scope.diffHash,
        specificationVersion: input.scope.approvedSpecificationVersion,
        planVersion: input.scope.approvedPlanVersion,
        taskGraphVersion: input.scope.taskGraphVersion,
        touchedPaths: out.touchedPaths,
        toolsInvoked: out.toolsInvoked ?? out.toolActivity,
        commandsRequested: out.commandsRequested ?? out.commandActivity.map((c) => c.command),
        commandResults: out.commandResults ?? out.commandActivity,
        toolActivity: out.toolActivity,
        commandActivity: out.commandActivity,
        events: out.events,
        failureClass: ok ? undefined : mapInjectedFailure(out.errorClass),
        failureMessage: out.errorMessage,
        errorClass: out.errorClass,
        provider: out.provider ?? 'rainy',
        model: out.model ?? null,
        tokenUsage: out.tokenUsage,
        costUsd: out.costUsd ?? null,
        cancelled: Boolean(out.cancelled),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return baseFail(
          input,
          timedOut ? 'timeout' : 'cancelled',
          timedOut ? 'timeout or cancelled' : 'cancelled',
          timedOut ? 'timeout' : 'cancelled',
        );
      }
      return baseFail(
        input,
        'internal',
        error instanceof Error ? error.message : String(error),
        'failed',
      );
    } finally {
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function mapProductionResponse(
  input: {
    scope: CanonicalAgentScope;
  },
  response: RainyScopedResponse,
): StructuredExecutionResult {
  const fields = rainyResponseToAdapterFields(response);
  const authoritativeOk =
    (fields.status === 'completed' || fields.status === 'partial') &&
    !fields.cancelled;

  return {
    ok: authoritativeOk,
    status: fields.status,
    engineeringTaskId: input.scope.engineeringTaskId,
    graphTaskId: input.scope.taskId,
    leaseId: input.scope.leaseId,
    taskId: input.scope.taskId,
    workspaceId: input.scope.workspaceId,
    baseSha: input.scope.baseSha,
    headSha: input.scope.headSha,
    diffHash: input.scope.diffHash,
    specificationVersion: input.scope.approvedSpecificationVersion,
    planVersion: input.scope.approvedPlanVersion,
    taskGraphVersion: input.scope.taskGraphVersion,
    touchedPaths: fields.touchedPaths,
    toolsInvoked: fields.toolsInvoked,
    commandsRequested: fields.commandsRequested,
    commandResults: fields.commandResults,
    toolActivity: fields.toolActivity,
    commandActivity: fields.commandActivity,
    events: fields.events,
    failureClass: fields.failureClass,
    failureMessage: fields.failureMessage,
    errorClass: fields.errorClass,
    provider: fields.provider ?? 'rainy',
    model: fields.model ?? null,
    tokenUsage: fields.tokenUsage,
    costUsd: fields.costUsd ?? null,
    cancelled: fields.cancelled,
    repositoryMutationRecord: fields.repositoryMutationRecord,
    modelProse: fields.modelProse,
  };
}

function mapInjectedFailure(
  errorClass?: RainyErrorClass,
): AgentFailureClass {
  switch (errorClass) {
    case 'timeout':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    case 'missing_credentials':
    case 'policy':
      return 'policy';
    case 'stale_lease':
    case 'stale_head':
      return 'stale_lease';
    case 'provider_failure':
    case 'network':
      return 'tool_error';
    case 'internal':
      return 'internal';
    default:
      return 'unknown';
  }
}

function baseFail(
  input: {
    scope: CanonicalAgentScope;
  },
  failureClass: AgentFailureClass,
  message: string,
  status: StructuredExecutionResult['status'],
): StructuredExecutionResult {
  return {
    ok: false,
    status,
    engineeringTaskId: input.scope.engineeringTaskId,
    graphTaskId: input.scope.taskId,
    leaseId: input.scope.leaseId,
    taskId: input.scope.taskId,
    workspaceId: input.scope.workspaceId,
    baseSha: input.scope.baseSha,
    headSha: input.scope.headSha,
    diffHash: input.scope.diffHash,
    specificationVersion: input.scope.approvedSpecificationVersion,
    planVersion: input.scope.approvedPlanVersion,
    taskGraphVersion: input.scope.taskGraphVersion,
    touchedPaths: [],
    toolsInvoked: [],
    commandsRequested: [],
    commandResults: [],
    toolActivity: [],
    commandActivity: [],
    events: [
      {
        eventType: status === 'cancelled' || status === 'timeout' ? 'cancelled' : 'failed',
        at: nowIso(),
        summary: message,
        structuredPayload: {
          engineeringTaskId: input.scope.engineeringTaskId,
          leaseId: input.scope.leaseId,
          graphTaskId: input.scope.taskId,
          failureClass,
        },
      },
    ],
    failureClass,
    failureMessage: message,
    errorClass:
      failureClass === 'timeout'
        ? 'timeout'
        : failureClass === 'cancelled'
          ? 'cancelled'
          : failureClass === 'policy'
            ? 'policy'
            : failureClass === 'stale_lease'
              ? 'stale_lease'
              : failureClass === 'capability'
                ? 'missing_credentials'
                : 'internal',
    cancelled: status === 'cancelled' || status === 'timeout',
    provider: 'rainy',
    model: null,
  };
}

/** Ensure model prose never becomes evidence records. */
export function stripModelProseFromEvidence(
  result: StructuredExecutionResult,
): Omit<StructuredExecutionResult, 'modelProse'> {
  const { modelProse: _drop, ...rest } = result;
  return rest;
}

/**
 * True when a result may complete a graph task.
 * Partial / blocked / failed / cancelled / empty-evidence policy:
 * - cancelled/timeout/failed/blocked → never complete
 * - completed with zero touched paths → allowed only if commands ran or tools recorded
 * Model prose never authorizes completion.
 */
export function mayMarkTaskCompleted(result: StructuredExecutionResult): boolean {
  if (!result.ok) return false;
  if (result.cancelled) return false;
  if (result.status !== 'completed' && result.status !== 'partial') return false;
  if (result.status === 'partial') return false;
  if (result.failureClass || result.errorClass) return false;
  // Free-form prose is never sufficient
  if (
    result.touchedPaths.length === 0 &&
    result.commandResults.length === 0 &&
    result.toolsInvoked.length === 0
  ) {
    return false;
  }
  return true;
}

export function buildCanonicalScope(input: {
  task: EngineeringTask;
  lease: TaskLease;
  graphTask: TaskNode;
  repositorySnapshotHash: string;
  headSha: string;
  baseSha?: string;
  diffHash?: string;
}): CanonicalAgentScope {
  return {
    engineeringTaskId: input.task.engineeringTaskId,
    leaseId: input.lease.leaseId,
    taskId: input.graphTask.taskId,
    workspaceId: input.task.workspaceId,
    repositorySnapshotHash: input.repositorySnapshotHash,
    headSha: input.headSha,
    baseSha: input.baseSha ?? input.headSha,
    diffHash: input.diffHash ?? input.repositorySnapshotHash,
    approvedSpecificationVersion: input.task.activeSpecificationVersion ?? 0,
    approvedPlanVersion: input.task.activePlanVersion ?? 0,
    taskGraphVersion: input.task.activeTaskGraphVersion ?? 0,
    writePaths: input.graphTask.fileScopes.write,
    readPaths: input.graphTask.fileScopes.read,
  };
}

// Keep TaskGraphDocument import used for type docs
export type { TaskGraphDocument };
