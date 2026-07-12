/**
 * Renderer client for Engineering control plane IPC.
 * CaptureTask and task state come from main process only.
 */

import type { EngineeringApi } from '../contracts/ipc';
import type { EngineeringPrimaryAction } from '../features/engineering/engineering-task-panel';

function getEngineeringApi(): EngineeringApi {
  const mate = (
    globalThis as unknown as {
      mate?: { engineering?: EngineeringApi };
    }
  ).mate;
  if (!mate?.engineering) {
    throw new Error('Engineering IPC API is not available');
  }
  return mate.engineering;
}

export async function dispatchEngineeringCommand(
  command: unknown,
): Promise<unknown> {
  return getEngineeringApi().dispatch(command);
}

export interface CaptureEngineeringTaskResult {
  ok: boolean;
  engineeringTaskId?: string;
  status?: string;
  readiness?: string;
  aggregateVersion?: number;
  error?: { code?: string; message?: string };
}

export async function captureEngineeringTask(input: {
  workspaceId: string;
  objectiveSeed: string;
  conversationId?: string | null;
  title?: string;
}): Promise<CaptureEngineeringTaskResult> {
  const response = (await dispatchEngineeringCommand({
    type: 'CaptureTask',
    workspaceId: input.workspaceId,
    objectiveSeed: input.objectiveSeed,
    conversationId: input.conversationId ?? null,
    title: input.title,
    pathKind: 'full',
    actor: { kind: 'human' },
  })) as {
    ok?: boolean;
    data?: {
      engineeringTaskId?: string;
      status?: string;
      readiness?: string;
      aggregateVersion?: number;
    };
    error?: { code?: string; message?: string };
  };

  if (!response?.ok || !response.data?.engineeringTaskId) {
    return {
      ok: false,
      error: response?.error ?? { message: 'CaptureTask failed' },
    };
  }

  return {
    ok: true,
    engineeringTaskId: response.data.engineeringTaskId,
    status: response.data.status,
    readiness: response.data.readiness,
    aggregateVersion: response.data.aggregateVersion,
  };
}

export async function listEngineeringTasks(
  workspaceId: string,
): Promise<unknown[]> {
  return getEngineeringApi().listTasks(workspaceId);
}

export async function getEngineeringTask(
  engineeringTaskId: string,
): Promise<unknown> {
  return getEngineeringApi().getTask(engineeringTaskId);
}

/**
 * Dispatch exactly one primary command for the panel CTA.
 * Multi-step plan build (specified → awaiting_approval) is orchestrated here
 * as sequential legal commands on the same EngineeringTask — never a second CaptureTask.
 */
export async function dispatchPrimaryEngineeringAction(input: {
  workspaceId: string;
  engineeringTaskId: string;
  action: EngineeringPrimaryAction;
  aggregateVersion?: number;
  decisionId?: string;
  chosenOptionId?: string;
  customValue?: string;
}): Promise<unknown> {
  const base = {
    engineeringTaskId: input.engineeringTaskId,
    workspaceId: input.workspaceId,
    actor: { kind: 'human' as const, userId: 'founder' },
    expectedAggregateVersion: input.aggregateVersion,
  };

  switch (input.action.id) {
    case 'review_specification':
      return dispatchEngineeringCommand({
        ...base,
        type: 'FreezeSpecification',
      });
    case 'answer_clarification':
      return dispatchEngineeringCommand({
        ...base,
        type: 'AnswerDecision',
        decisionId: input.decisionId,
        chosenOptionId: input.chosenOptionId,
        customValue: input.customValue,
        skipWithAck: !input.chosenOptionId && !input.customValue,
      });
    case 'approve_plan':
      if (input.action.commandType === 'ApprovePlanAndTasks') {
        return dispatchEngineeringCommand({
          ...base,
          type: 'ApprovePlanAndTasks',
        });
      }
      // specified/planning/planned → build plan artifacts then SubmitForApproval
      return advanceToAwaitingApproval(input.workspaceId, input.engineeringTaskId);
    case 'start_execution':
      // Execution already authorized; kick verification spine / leave to execution run.
      return dispatchEngineeringCommand({
        ...base,
        type: 'BeginVerification',
      });
    case 'run_validation':
      return dispatchEngineeringCommand({
        ...base,
        type: 'ExecuteValidation',
      });
    case 'view_ship_proof':
      return dispatchEngineeringCommand({
        ...base,
        type: 'IssueShipProof',
      });
    case 'resolve_blocker':
    case 'retry_failed':
      return dispatchEngineeringCommand({
        ...base,
        type: 'ResumeTask',
      });
    default:
      throw new Error(`Unhandled CTA: ${String((input.action as { id: string }).id)}`);
  }
}

async function advanceToAwaitingApproval(
  workspaceId: string,
  engineeringTaskId: string,
): Promise<unknown> {
  const steps = [
    'StartPlanCompilation',
    'CompletePlanCompilation',
    'CompileTaskGraph',
    'SubmitForApproval',
  ] as const;

  let last: unknown;
  for (const type of steps) {
    last = await dispatchEngineeringCommand({
      type,
      engineeringTaskId,
      workspaceId,
      actor: { kind: 'human', userId: 'founder' },
    });
    const result = last as { ok?: boolean };
    if (result && result.ok === false) {
      return last;
    }
  }
  return last;
}
