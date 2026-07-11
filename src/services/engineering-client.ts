/**
 * Renderer client for Engineering control plane IPC.
 * CaptureTask and task state come from main process only.
 */

import type { EngineeringApi } from '../contracts/ipc';

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

export async function captureEngineeringTask(input: {
  workspaceId: string;
  objectiveSeed: string;
  conversationId?: string | null;
  title?: string;
}): Promise<unknown> {
  return dispatchEngineeringCommand({
    type: 'CaptureTask',
    workspaceId: input.workspaceId,
    objectiveSeed: input.objectiveSeed,
    conversationId: input.conversationId ?? null,
    title: input.title,
    pathKind: 'full',
    actor: { kind: 'human' },
  });
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
