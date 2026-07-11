/**
 * Rainy agent adapter — canonical scoped execution binding.
 * Agent cannot approve, freeze, accept convergence, or issue ship proof.
 * NES-4 / R6
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
  engineeringTaskId: string;
  leaseId: string;
  taskId: string;
  touchedPaths: string[];
  toolActivity: Array<{ toolName: string; summary: string; at: string }>;
  commandActivity: Array<{ command: string; exitCode: number | null; at: string }>;
  events: StructuredExecutionEvent[];
  failureClass?: AgentFailureClass;
  failureMessage?: string;
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

/**
 * Deterministic fake adapter for integration tests (no network).
 */
export class FakeAgentAdapter implements AgentAdapter {
  constructor(
    private readonly behavior: {
      touchedPaths?: string[];
      fail?: AgentFailureClass;
      delayMs?: number;
    } = {},
  ) {}

  declareCapabilities(): AgentCapabilityDeclaration {
    return {
      ...RAINY_CAPABILITIES,
      agentId: 'fake-agent',
      provider: null,
    };
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
    const leaseCheck = validateLeaseBinding({
      lease: input.lease,
      scope: input.scope,
    });
    if (!leaseCheck.ok) {
      return {
        ok: false,
        engineeringTaskId: input.scope.engineeringTaskId,
        leaseId: input.scope.leaseId,
        taskId: input.scope.taskId,
        touchedPaths: [],
        toolActivity: [],
        commandActivity: [],
        events: [
          {
            eventType: 'failed',
            at: nowIso(),
            summary: leaseCheck.message,
          },
        ],
        failureClass: 'stale_lease',
        failureMessage: leaseCheck.message,
      };
    }

    if (input.signal?.aborted) {
      return {
        ok: false,
        engineeringTaskId: input.scope.engineeringTaskId,
        leaseId: input.scope.leaseId,
        taskId: input.scope.taskId,
        touchedPaths: [],
        toolActivity: [],
        commandActivity: [],
        events: [
          { eventType: 'cancelled', at: nowIso(), summary: 'cancelled' },
        ],
        failureClass: 'cancelled',
        failureMessage: 'cancelled',
      };
    }

    if (this.behavior.delayMs) {
      await new Promise((r) => setTimeout(r, this.behavior.delayMs));
    }

    if (this.behavior.fail) {
      return {
        ok: false,
        engineeringTaskId: input.scope.engineeringTaskId,
        leaseId: input.scope.leaseId,
        taskId: input.scope.taskId,
        touchedPaths: [],
        toolActivity: [],
        commandActivity: [],
        events: [
          {
            eventType: 'failed',
            at: nowIso(),
            summary: this.behavior.fail,
          },
        ],
        failureClass: this.behavior.fail,
        failureMessage: this.behavior.fail,
      };
    }

    const touched = this.behavior.touchedPaths ?? input.graphTask.fileScopes.write;
    const at = nowIso();
    return {
      ok: true,
      engineeringTaskId: input.scope.engineeringTaskId,
      leaseId: input.scope.leaseId,
      taskId: input.scope.taskId,
      touchedPaths: touched,
      toolActivity: [
        { toolName: 'file_editor', summary: 'applied scoped edits', at },
      ],
      commandActivity: [],
      events: [
        { eventType: 'started', at, summary: 'execution started' },
        {
          eventType: 'tool',
          at,
          summary: 'file_editor',
          toolName: 'file_editor',
          paths: touched,
        },
        { eventType: 'completed', at, summary: 'execution completed' },
      ],
      // Free-form prose must not be treated as evidence by callers
      modelProse: 'I think this is done and ready to ship.',
    };
  }
}

/**
 * Rainy-bound adapter: validates scope, rejects stale leases, returns structured results.
 * Does not call remote network in unit tests — inject runner for live path.
 */
export class RainyAgentAdapter implements AgentAdapter {
  constructor(
    private readonly runner?: (input: {
      scope: CanonicalAgentScope;
      graphTask: TaskNode;
      signal?: AbortSignal;
    }) => Promise<{
      touchedPaths: string[];
      toolActivity: StructuredExecutionResult['toolActivity'];
      commandActivity: StructuredExecutionResult['commandActivity'];
      events: StructuredExecutionEvent[];
    }>,
  ) {}

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
    if (!input.scope.repositorySnapshotHash || !input.scope.headSha) {
      return failResult(input, 'internal', 'missing repository snapshot binding');
    }
    if (
      input.task.activeSpecificationVersion !==
      input.scope.approvedSpecificationVersion
    ) {
      return failResult(input, 'stale_lease', 'specification version mismatch');
    }
    if (input.task.activePlanVersion !== input.scope.approvedPlanVersion) {
      return failResult(input, 'stale_lease', 'plan version mismatch');
    }

    const leaseCheck = validateLeaseBinding({
      lease: input.lease,
      scope: input.scope,
    });
    if (!leaseCheck.ok) {
      return failResult(input, 'stale_lease', leaseCheck.message);
    }

    // Agent must receive approved docs only
    if (!input.specification.frozenAt) {
      return failResult(input, 'policy', 'specification not frozen');
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (input.timeoutMs && input.timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), input.timeoutMs);
    }

    try {
      if (controller.signal.aborted) {
        return failResult(input, 'cancelled', 'cancelled before start');
      }

      if (this.runner) {
        const out = await this.runner({
          scope: input.scope,
          graphTask: input.graphTask,
          signal: controller.signal,
        });
        return {
          ok: true,
          engineeringTaskId: input.scope.engineeringTaskId,
          leaseId: input.scope.leaseId,
          taskId: input.scope.taskId,
          touchedPaths: out.touchedPaths,
          toolActivity: out.toolActivity,
          commandActivity: out.commandActivity,
          events: out.events,
        };
      }

      // Default: structured no-op scaffold (live Work Engine bridge later)
      const at = nowIso();
      return {
        ok: true,
        engineeringTaskId: input.scope.engineeringTaskId,
        leaseId: input.scope.leaseId,
        taskId: input.scope.taskId,
        touchedPaths: [],
        toolActivity: [],
        commandActivity: [],
        events: [
          {
            eventType: 'started',
            at,
            summary: 'rainy adapter bound',
            structuredPayload: {
              engineeringTaskId: input.scope.engineeringTaskId,
              leaseId: input.scope.leaseId,
              taskId: input.scope.taskId,
            },
          },
          {
            eventType: 'completed',
            at,
            summary: 'rainy adapter completed structured binding',
          },
        ],
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return failResult(input, 'timeout', 'timeout or cancelled');
      }
      return failResult(
        input,
        'internal',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function failResult(
  input: {
    scope: CanonicalAgentScope;
  },
  failureClass: AgentFailureClass,
  message: string,
): StructuredExecutionResult {
  return {
    ok: false,
    engineeringTaskId: input.scope.engineeringTaskId,
    leaseId: input.scope.leaseId,
    taskId: input.scope.taskId,
    touchedPaths: [],
    toolActivity: [],
    commandActivity: [],
    events: [
      {
        eventType: 'failed',
        at: nowIso(),
        summary: message,
      },
    ],
    failureClass,
    failureMessage: message,
  };
}

/** Ensure model prose never becomes evidence records. */
export function stripModelProseFromEvidence(
  result: StructuredExecutionResult,
): Omit<StructuredExecutionResult, 'modelProse'> {
  const { modelProse: _drop, ...rest } = result;
  return rest;
}

export function buildCanonicalScope(input: {
  task: EngineeringTask;
  lease: TaskLease;
  graphTask: TaskNode;
  repositorySnapshotHash: string;
  headSha: string;
}): CanonicalAgentScope {
  return {
    engineeringTaskId: input.task.engineeringTaskId,
    leaseId: input.lease.leaseId,
    taskId: input.graphTask.taskId,
    workspaceId: input.task.workspaceId,
    repositorySnapshotHash: input.repositorySnapshotHash,
    headSha: input.headSha,
    approvedSpecificationVersion: input.task.activeSpecificationVersion ?? 0,
    approvedPlanVersion: input.task.activePlanVersion ?? 0,
    taskGraphVersion: input.task.activeTaskGraphVersion ?? 0,
    writePaths: input.graphTask.fileScopes.write,
    readPaths: input.graphTask.fileScopes.read,
  };
}

// Keep TaskGraphDocument import used for type docs
export type { TaskGraphDocument };
