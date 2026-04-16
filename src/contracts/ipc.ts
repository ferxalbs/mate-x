import type { AssistantExecution } from './chat';
import type { SearchMatch, WorkspaceSummary } from './workspace';

export interface RepoInspectorApi {
  getWorkspaceSummary: () => Promise<WorkspaceSummary>;
  listFiles: (limit?: number) => Promise<string[]>;
  searchInFiles: (query: string, limit?: number) => Promise<SearchMatch[]>;
  runAssistant: (prompt: string, history: string[]) => Promise<AssistantExecution>;
}
