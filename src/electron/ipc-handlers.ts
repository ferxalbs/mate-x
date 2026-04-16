import { BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { GitService } from './git-service';
import {
  addWorkspace,
  bootstrapWorkspaceState,
  getWorkspaceEntries,
  getWorkspaceSummary,
  listFiles,
  removeWorkspace,
  runAssistant,
  searchInFiles,
  setActiveWorkspace,
} from './repo-service';
import { workspaceRegistry } from './workspace-registry';

async function resolveActiveWorkspacePath() {
  const state = await workspaceRegistry.ensureSeedWorkspace(process.cwd());
  const activeWorkspace =
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ??
    state.workspaces[0];

  if (!activeWorkspace) {
    throw new Error('No active workspace available.');
  }

  return activeWorkspace.path;
}

async function resolveGitService() {
  const workspacePath = await resolveActiveWorkspacePath();
  return new GitService(workspacePath);
}

export function registerIpcHandlers() {
  ipcMain.handle('repo:bootstrap', async () => bootstrapWorkspaceState());
  ipcMain.handle('repo:get-workspaces', async () => getWorkspaceEntries());
  ipcMain.handle('repo:get-workspace-summary', async () => getWorkspaceSummary());
  ipcMain.handle('repo:set-active-workspace', async (_event, workspaceId: string) =>
    setActiveWorkspace(workspaceId),
  );
  ipcMain.handle('repo:remove-workspace', async (_event, workspaceId: string) =>
    removeWorkspace(workspaceId),
  );
  ipcMain.handle('repo:open-workspace-picker', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return addWorkspace(result.filePaths[0]);
  });
  ipcMain.handle('repo:open-workspace-path', async (_event, target: 'folder' | 'vscode' | 'terminal') => {
    const workspacePath = await resolveActiveWorkspacePath();
    const encodedWorkspacePath = encodeURI(workspacePath);

    if (target === 'folder') {
      await shell.openPath(workspacePath);
      return;
    }

    if (target === 'vscode') {
      await shell.openExternal(`vscode://file/${encodedWorkspacePath}`);
      return;
    }

    if (process.platform === 'darwin') {
      await shell.openExternal(`file://${encodedWorkspacePath}`);
      return;
    }

    await shell.openPath(workspacePath);
  });
  ipcMain.handle('repo:list-files', async (_event, limit?: number) => listFiles(limit));
  ipcMain.handle('repo:search', async (_event, query: string, limit?: number) =>
    searchInFiles(query, limit),
  );
  ipcMain.handle('repo:run-assistant', async (_event, prompt: string, history: string[]) =>
    runAssistant(prompt, history),
  );

  ipcMain.handle('git:status', async () => (await resolveGitService()).getStatus());
  ipcMain.handle('git:log', async (_event, limit?: number) => (await resolveGitService()).getLog(limit));
  ipcMain.handle('git:stage-files', async (_event, files: string[]) =>
    (await resolveGitService()).stageFiles(files),
  );
  ipcMain.handle('git:commit', async (_event, message: string) =>
    (await resolveGitService()).commit(message),
  );
  ipcMain.handle('git:push', async () => (await resolveGitService()).push());
  ipcMain.handle('git:pull', async () => (await resolveGitService()).pull());
  ipcMain.handle('git:diff', async () => (await resolveGitService()).getDiff());
  ipcMain.handle('git:unstage', async (_event, files: string[]) =>
    (await resolveGitService()).unstageFiles(files),
  );
}
