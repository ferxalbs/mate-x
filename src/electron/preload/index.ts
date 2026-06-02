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
