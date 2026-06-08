import { contextBridge, ipcRenderer } from 'electron';

import type { AgentAction } from '../../contracts';
import { IPC } from './contracts';

contextBridge.exposeInMainWorld('mateX', {
  orchestrator: {
    run: (action: AgentAction) => ipcRenderer.invoke(IPC.ORCHESTRATOR_RUN, action),
    getRoutingRecommendations: () => ipcRenderer.invoke(IPC.ORCHESTRATOR_ROUTING),
  },
  evidencePack: {
    list: (workspaceId: string) => ipcRenderer.invoke(IPC.EVIDENCE_PACK_LIST, workspaceId),
    publish: (pack: unknown) => ipcRenderer.invoke(IPC.EVIDENCE_PACK_PUBLISH, pack),
    // Phase C local standalone (scans .mate-x/evidence on target workspace)
    localList: (workspaceId?: string) => ipcRenderer.invoke(IPC.EVIDENCE_LIST, workspaceId),
    get: (workspaceId: string, taskId: string) => ipcRenderer.invoke(IPC.EVIDENCE_GET, workspaceId, taskId),
    verifyAttestation: (workspaceId: string, taskId: string) => ipcRenderer.invoke(IPC.EVIDENCE_VERIFY, workspaceId, taskId),
    exportZip: (workspaceId: string, taskId: string) => ipcRenderer.invoke(IPC.EVIDENCE_EXPORT_ZIP, workspaceId, taskId),
  },
  failureMemory: {
    sync: () => ipcRenderer.invoke(IPC.FAILURE_MEMORY_SYNC),
    getSyncStatus: () => ipcRenderer.invoke(IPC.FAILURE_MEMORY_STATUS),
    exportWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC.FAILURE_MEMORY_EXPORT, workspaceId),
    importWorkspace: (zipPath: string) => ipcRenderer.invoke(IPC.FAILURE_MEMORY_IMPORT, zipPath),
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.CONFIG_GET),
  },
  storage: {
    list: (prefix: string) => ipcRenderer.invoke(IPC.STORAGE_LIST, prefix),
  },
});
