import { ipcMain } from 'electron';

import { getWorkspaceSummary, listFiles, runAssistant, searchInFiles } from './repo-service';

export function registerIpcHandlers() {
  ipcMain.handle('repo:get-workspace-summary', async () => getWorkspaceSummary());
  ipcMain.handle('repo:list-files', async (_event, limit?: number) => listFiles(limit));
  ipcMain.handle('repo:search', async (_event, query: string, limit?: number) =>
    searchInFiles(query, limit),
  );
  ipcMain.handle('repo:run-assistant', async (_event, prompt: string, history: string[]) =>
    runAssistant(prompt, history),
  );
}
