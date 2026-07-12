/**
 * Test-only fake agent adapter. Never imported from production main path.
 */
import type {
  EngineeringTask,
  SpecificationDocument,
  TaskLease,
  TaskNode,
  TechnicalApproachDocument,
} from '../../src/contracts/engineering-task';
import { nowIso } from '../../src/electron/engineering/ids';
import type {
  AgentAdapter,
  AgentCapabilityDeclaration,
  AgentFailureClass,
  CanonicalAgentScope,
  StructuredExecutionResult,
} from '../../src/electron/engineering/rainy-adapter';
import {
  rainyCapabilities,
  validateLeaseBinding,
} from '../../src/electron/engineering/rainy-adapter';
import type { RainyExecutionStatus } from '../../src/electron/engineering/rainy-production-runner';

function baseFail(
  input: { scope: CanonicalAgentScope },
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
    cancelled: status === 'cancelled',
  };
}

export class FakeAgentAdapter implements AgentAdapter {
  constructor(
    private readonly behavior: {
      touchedPaths?: string[];
      fail?: AgentFailureClass;
      delayMs?: number;
      status?: RainyExecutionStatus;
      partial?: boolean;
    } = {},
  ) {}

  declareCapabilities(): AgentCapabilityDeclaration {
    return {
      ...rainyCapabilities(),
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
      return baseFail(input, 'stale_lease', leaseCheck.message, 'failed');
    }

    if (input.signal?.aborted) {
      return baseFail(input, 'cancelled', 'cancelled', 'cancelled');
    }

    if (this.behavior.delayMs) {
      await new Promise((r) => setTimeout(r, this.behavior.delayMs));
      if (input.signal?.aborted) {
        return baseFail(input, 'cancelled', 'cancelled', 'cancelled');
      }
      if (input.timeoutMs && this.behavior.delayMs >= input.timeoutMs) {
        return baseFail(input, 'timeout', 'timeout', 'timeout');
      }
    }

    if (this.behavior.fail) {
      const status =
        this.behavior.fail === 'timeout'
          ? 'timeout'
          : this.behavior.fail === 'cancelled'
            ? 'cancelled'
            : 'failed';
      return baseFail(input, this.behavior.fail, this.behavior.fail, status);
    }

    const touched = this.behavior.touchedPaths ?? input.graphTask.fileScopes.write;
    const at = nowIso();
    const status: RainyExecutionStatus = this.behavior.partial
      ? 'partial'
      : this.behavior.status ?? 'completed';
    return {
      ok: status === 'completed' || status === 'partial',
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
      touchedPaths: touched,
      toolsInvoked: [
        { toolName: 'file_editor', summary: 'applied scoped edits', at },
      ],
      commandsRequested: [],
      commandResults: [],
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
        {
          eventType: status === 'partial' ? 'progress' : 'completed',
          at,
          summary: status === 'partial' ? 'partial execution' : 'execution completed',
        },
      ],
      cancelled: false,
      provider: null,
      model: null,
      modelProse: 'I think this is done and ready to ship.',
      repositoryMutationRecord: {
        baseSha: input.scope.baseSha,
        headShaBefore: input.scope.headSha,
        headShaAfter: input.scope.headSha,
        diffHashBefore: input.scope.diffHash,
        mutated: touched.length > 0,
      },
    };
  }
}
