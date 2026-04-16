import type { RepoInspectorApi } from '../contracts/ipc';

function getMateApi(): RepoInspectorApi {
  if (!window.mate?.repo) {
    throw new Error('Mate repo API is not available in the renderer.');
  }

  return window.mate.repo;
}

export function bootstrapWorkspaceState() {
  return getMateApi().bootstrap();
}

export function listWorkspaces() {
  return getMateApi().getWorkspaces();
}

export function getWorkspaceSummary() {
  return getMateApi().getWorkspaceSummary();
}

export function openWorkspacePicker() {
  return getMateApi().openWorkspacePicker();
}

export function setActiveWorkspace(workspaceId: string) {
  return getMateApi().setActiveWorkspace(workspaceId);
}

export function removeWorkspace(workspaceId: string) {
  return getMateApi().removeWorkspace(workspaceId);
}

export function listRepoFiles(limit?: number) {
  return getMateApi().listFiles(limit);
}

export function searchRepoFiles(query: string, limit?: number) {
  return getMateApi().searchInFiles(query, limit);
}

export function runAssistant(prompt: string, history: string[]) {
  return getMateApi().runAssistant(prompt, history);
}

export function openWorkspacePath(target: 'folder' | 'vscode' | 'terminal') {
  return getMateApi().openWorkspacePath(target);
}
