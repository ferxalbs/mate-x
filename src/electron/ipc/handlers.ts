import { ipcMain } from 'electron';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

import { getConfigSnapshot, getStack } from '../main-stack';
import { IPC } from '../preload/contracts';
import type { AgentActionRequest, EvidencePackStoragePublishInput, MaTeXConfig } from '../../contracts';

const agentIdSchema = z.enum(['codex', 'cursor', 'antigravity']);

const agentActionSchema = z.object({
  agentId: agentIdSchema,
  actionType: z.string().min(1),
  payload: z.unknown(),
  allowHighImpact: z.boolean().optional(),
}) satisfies z.ZodType<AgentActionRequest>;

const evidencePackPublishSchema = z.object({
  workspaceId: z.string().min(1),
  evidencePackDirectory: z.string().min(1),
  publicKeyPem: z.string().min(1),
  prefix: z.string().optional(),
  uploadedAt: z.coerce.date().optional(),
}) satisfies z.ZodType<EvidencePackStoragePublishInput>;

const workspaceIdSchema = z.string().min(1);
const zipPathSchema = z.string().min(1);
const prefixSchema = z.string();

function sanitizeConfig(config: MaTeXConfig): MaTeXConfig {
  return {
    ...config,
    storage: {
      ...config.storage,
      credentials: { redacted: true },
    },
  };
}

async function recordIpcFailure(channel: string, error: unknown) {
  try {
    const stack = getStack();
    const failureRecorder = stack.orchestrator as unknown as {
      recordExternalFailure?(input: { channel: string; error: unknown }): Promise<void>;
    };
    await failureRecorder.recordExternalFailure?.({
      channel,
      error,
    });
  } catch {
    // IPC error reporting must not leak implementation details or cascade.
  }
}

function sanitizeError(error: unknown) {
  if (error instanceof z.ZodError) {
    return 'Invalid IPC payload.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'MaTE X IPC operation failed.';
}

async function handleIpc<T>(channel: string, operation: () => Promise<T> | T) {
  try {
    return { ok: true, data: await operation() } as const;
  } catch (error) {
    await recordIpcFailure(channel, error);
    return { ok: false, error: sanitizeError(error) } as const;
  }
}

export function registerMaTeXStackIpcHandlers() {
  ipcMain.handle(IPC.ORCHESTRATOR_RUN, (_event, payload) =>
    handleIpc(IPC.ORCHESTRATOR_RUN, () => getStack().orchestrator.execute(agentActionSchema.parse(payload))),
  );

  ipcMain.handle(IPC.ORCHESTRATOR_ROUTING, () =>
    handleIpc(IPC.ORCHESTRATOR_ROUTING, () => getStack().orchestrator.getRoutingRecommendations()),
  );

  ipcMain.handle(IPC.EVIDENCE_PACK_LIST, (_event, workspaceId) =>
    handleIpc(IPC.EVIDENCE_PACK_LIST, () => getStack().evidencePackStorage.list(workspaceIdSchema.parse(workspaceId))),
  );

  ipcMain.handle(IPC.EVIDENCE_PACK_PUBLISH, (_event, payload) =>
    handleIpc(IPC.EVIDENCE_PACK_PUBLISH, () => getStack().evidencePackStorage.publish(evidencePackPublishSchema.parse(payload))),
  );

  ipcMain.handle(IPC.FAILURE_MEMORY_SYNC, () =>
    handleIpc(IPC.FAILURE_MEMORY_SYNC, () => getStack().failureMemorySync.sync()),
  );

  ipcMain.handle(IPC.FAILURE_MEMORY_EXPORT, (_event, workspaceId) =>
    handleIpc(IPC.FAILURE_MEMORY_EXPORT, async () => {
      const parsedWorkspaceId = workspaceIdSchema.parse(workspaceId);
      const zipPath = join(tmpdir(), `mate-x-failure-memory-${parsedWorkspaceId}-${Date.now()}.zip`);
      await getStack().failureMemorySync.exportWorkspaceToFile(zipPath, parsedWorkspaceId);
      return { zipPath };
    }),
  );

  ipcMain.handle(IPC.FAILURE_MEMORY_IMPORT, (_event, zipPath) =>
    handleIpc(IPC.FAILURE_MEMORY_IMPORT, async () => {
      await getStack().failureMemorySync.importWorkspace(zipPathSchema.parse(zipPath));
    }),
  );

  ipcMain.handle(IPC.CONFIG_GET, () =>
    handleIpc(IPC.CONFIG_GET, () => sanitizeConfig(getConfigSnapshot())),
  );

  ipcMain.handle(IPC.STORAGE_LIST, (_event, prefix) =>
    handleIpc(IPC.STORAGE_LIST, () => getStack().adapter.listFiles({ prefix: prefixSchema.parse(prefix) })),
  );
}
