import { ipcMain } from 'electron';

import { gitService } from './git-service';
import { getWorkspaceSummary, listFiles, runAssistant, searchInFiles } from './repo-service';

export function registerIpcHandlers() {
  // Repo handlers
  ipcMain.handle('repo:get-workspace-summary', async () => getWorkspaceSummary());
  ipcMain.handle('repo:list-files', async (_event, limit?: number) => listFiles(limit));
  ipcMain.handle('repo:search', async (_event, query: string, limit?: number) =>
    searchInFiles(query, limit),
  );
  ipcMain.handle('repo:run-assistant', async (_event, prompt: string, history: string[]) =>
    runAssistant(prompt, history),
  );

  // Git handlers
  ipcMain.handle('git:status', async () => gitService.getStatus());
  ipcMain.handle('git:log', async (_event, limit?: number) => gitService.getLog(limit));
  ipcMain.handle('git:stage-files', async (_event, files: string[]) => gitService.stageFiles(files));
  ipcMain.handle('git:commit', async (_event, message: string) => gitService.commit(message));
  ipcMain.handle('git:push', async () => gitService.push());
  ipcMain.handle('git:pull', async () => gitService.pull());
  ipcMain.handle('git:diff', async () => gitService.getDiff());
  ipcMain.handle('git:unstage', async (_event, files: string[]) => gitService.unstageFiles(files));
}
