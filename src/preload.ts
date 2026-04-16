import { contextBridge, ipcRenderer } from 'electron';

import type { RepoInspectorApi } from './contracts/ipc';

const repoApi: RepoInspectorApi = {
  getWorkspaceSummary: () => ipcRenderer.invoke('repo:get-workspace-summary'),
  listFiles: (limit) => ipcRenderer.invoke('repo:list-files', limit),
  searchInFiles: (query, limit) => ipcRenderer.invoke('repo:search', query, limit),
  runAudit: (prompt) => ipcRenderer.invoke('repo:run-audit', prompt),
};

contextBridge.exposeInMainWorld('mate', {
  repo: repoApi,
});
