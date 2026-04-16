import { contextBridge, ipcRenderer } from 'electron';

import type { GitApi, RepoInspectorApi } from './contracts/ipc';

const repoApi: RepoInspectorApi = {
  getWorkspaceSummary: () => ipcRenderer.invoke('repo:get-workspace-summary'),
  listFiles: (limit) => ipcRenderer.invoke('repo:list-files', limit),
  searchInFiles: (query, limit) => ipcRenderer.invoke('repo:search', query, limit),
  runAssistant: (prompt, history) => ipcRenderer.invoke('repo:run-assistant', prompt, history),
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

contextBridge.exposeInMainWorld('mate', {
  repo: repoApi,
  git: gitApi,
});
