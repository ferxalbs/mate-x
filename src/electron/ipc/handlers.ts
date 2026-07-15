import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

import { getConfigSnapshot, getStack } from '../main-stack';
import { IPC } from '../preload/contracts';
import type { AgentActionRequest, EvidencePackStoragePublishInput, MaTeXConfig } from '../../contracts';
import {
  assertTrustedRendererSender,
  parseEvidencePackDirectory,
  parseFailureMemoryImportPath,
  parsePublicKeyPem,
  parseStoragePrefix,
  parseWorkspaceId,
} from './guards';

const agentIdSchema = z.enum(['codex', 'cursor', 'antigravity']);

const agentActionSchema = z.object({
  agentId: agentIdSchema,
  actionType: z.string().trim().min(1).max(120),
  payload: z.unknown(),
  allowHighImpact: z.boolean().optional(),
});

const evidencePackPublishSchema = z.object({
  workspaceId: z.string().transform(parseWorkspaceId),
  evidencePackDirectory: z.string().transform(parseEvidencePackDirectory),
  publicKeyPem: z.string().transform(parsePublicKeyPem),
  prefix: z.string().max(256).transform(parseStoragePrefix).optional(),
  uploadedAt: z.coerce.date().optional(),
}) satisfies z.ZodType<EvidencePackStoragePublishInput, any, any>;

const workspaceIdSchema = z.string().transform(parseWorkspaceId);
const zipPathSchema = z.string().transform(parseFailureMemoryImportPath);
const prefixSchema = z.string().max(256).transform(parseStoragePrefix);

function sanitizeConfig(config: MaTeXConfig): MaTeXConfig {
  return {
    ...config,
    storage: {
      ...config.storage,
      credentials: { redacted: true },
      credentialsEnv: config.storage.credentialsEnv ? { redacted: "true" } : undefined,
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

function guardIpc<T>(
  channel: string,
  operation: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
) {
  return (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      assertTrustedRendererSender(event);
    } catch (error) {
      return handleIpc(channel, () => {
        throw error;
      });
    }

    return handleIpc(channel, () => operation(event, ...args));
  };
}

export function registerMaTeXStackIpcHandlers() {
  ipcMain.handle(IPC.ORCHESTRATOR_RUN, guardIpc(IPC.ORCHESTRATOR_RUN, (_event, payload) =>
    getStack().orchestrator.execute(agentActionSchema.parse(payload) as AgentActionRequest),
  ));

  ipcMain.handle(IPC.ORCHESTRATOR_ROUTING, guardIpc(IPC.ORCHESTRATOR_ROUTING, () =>
    getStack().orchestrator.getRoutingRecommendations(),
  ));

  ipcMain.handle(IPC.EVIDENCE_PACK_LIST, guardIpc(IPC.EVIDENCE_PACK_LIST, (_event, workspaceId) =>
    getStack().evidencePackStorage.list(workspaceIdSchema.parse(workspaceId)),
  ));

  ipcMain.handle(IPC.EVIDENCE_PACK_PUBLISH, guardIpc(IPC.EVIDENCE_PACK_PUBLISH, (_event, payload) =>
    getStack().evidencePackStorage.publish(evidencePackPublishSchema.parse(payload) as EvidencePackStoragePublishInput),
  ));

  ipcMain.handle(IPC.FAILURE_MEMORY_SYNC, guardIpc(IPC.FAILURE_MEMORY_SYNC, () =>
    getStack().failureMemorySync.sync(),
  ));

  ipcMain.handle(IPC.FAILURE_MEMORY_EXPORT, guardIpc(IPC.FAILURE_MEMORY_EXPORT, async (_event, workspaceId) => {
    const parsedWorkspaceId = workspaceIdSchema.parse(workspaceId);
    const zipPath = join(tmpdir(), `mate-x-failure-memory-${parsedWorkspaceId}-${Date.now()}.zip`);
    await getStack().failureMemorySync.exportWorkspaceToFile(zipPath, parsedWorkspaceId);
    return { zipPath };
  }));

  ipcMain.handle(IPC.FAILURE_MEMORY_IMPORT, guardIpc(IPC.FAILURE_MEMORY_IMPORT, async (_event, zipPath) => {
    await getStack().failureMemorySync.importWorkspace(zipPathSchema.parse(zipPath));
  }));

  ipcMain.handle(IPC.CONFIG_GET, guardIpc(IPC.CONFIG_GET, () =>
    sanitizeConfig(getConfigSnapshot()),
  ));

  ipcMain.handle(IPC.STORAGE_LIST, guardIpc(IPC.STORAGE_LIST, (_event, prefix) =>
    getStack().adapter.listFiles({ prefix: prefixSchema.parse(prefix) }),
  ));
}
