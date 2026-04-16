import { ipcMain } from 'electron';

import { getWorkspaceSummary, listFiles, runAudit, searchInFiles } from './repo-service';

export function registerIpcHandlers() {
  ipcMain.handle('repo:get-workspace-summary', async () => getWorkspaceSummary());
  ipcMain.handle('repo:list-files', async (_event, limit?: number) => listFiles(limit));
  ipcMain.handle('repo:search', async (_event, query: string, limit?: number) =>
    searchInFiles(query, limit),
  );
  ipcMain.handle('repo:run-audit', async (_event, prompt: string) => runAudit(prompt));
}
