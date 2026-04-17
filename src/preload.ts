import { contextBridge, ipcRenderer } from 'electron';

import type { GitApi, RepoInspectorApi, SettingsApi } from './contracts/ipc';

const repoApi: RepoInspectorApi = {
  bootstrap: () => ipcRenderer.invoke('repo:bootstrap'),
  getWorkspaces: () => ipcRenderer.invoke('repo:get-workspaces'),
  getWorkspaceSummary: () => ipcRenderer.invoke('repo:get-workspace-summary'),
  openWorkspacePicker: () => ipcRenderer.invoke('repo:open-workspace-picker'),
  setActiveWorkspace: (workspaceId) => ipcRenderer.invoke('repo:set-active-workspace', workspaceId),
  removeWorkspace: (workspaceId) => ipcRenderer.invoke('repo:remove-workspace', workspaceId),
  saveWorkspaceSession: (workspaceId, threads, activeThreadId) =>
    ipcRenderer.invoke('repo:save-workspace-session', workspaceId, threads, activeThreadId),
  listFiles: (limit) => ipcRenderer.invoke('repo:list-files', limit),
  searchInFiles: (query, limit) => ipcRenderer.invoke('repo:search', query, limit),
  runAssistant: (prompt, history) => ipcRenderer.invoke('repo:run-assistant', prompt, history),
  openWorkspacePath: (target) => ipcRenderer.invoke('repo:open-workspace-path', target),
};

const gitApi: GitApi = {
  getStatus: () => ipcRenderer.invoke('git:status'),
  getLog: (limit) => ipcRenderer.invoke('git:log', limit),
  stageFiles: (files) => ipcRenderer.invoke('git:stage-files', files),
  unstageFiles: (files) => ipcRenderer.invoke('git:unstage', files),
  commit: (message) => ipcRenderer.invoke('git:commit', message),
  push: () => ipcRenderer.invoke('git:push'),
  pull: () => ipcRenderer.invoke('git:pull'),
  getDiff: () => ipcRenderer.invoke('git:diff'),
};

const settingsApi: SettingsApi = {
  getApiKey: () => ipcRenderer.invoke('settings:get-api-key'),
  setApiKey: (apiKey) => ipcRenderer.invoke('settings:set-api-key', apiKey),
  listModels: (forceRefresh) => ipcRenderer.invoke('settings:list-models', forceRefresh),
  getModel: () => ipcRenderer.invoke('settings:get-model'),
  setModel: (model) => ipcRenderer.invoke('settings:set-model', model),
};

contextBridge.exposeInMainWorld('mate', {
  repo: repoApi,
  git: gitApi,
  settings: settingsApi,
});
