import type { AuditExecution } from '../services/audit-service';
import type { SearchMatch, WorkspaceSummary } from './workspace';

export interface RepoInspectorApi {
  getWorkspaceSummary: () => Promise<WorkspaceSummary>;
  listFiles: (limit?: number) => Promise<string[]>;
  searchInFiles: (query: string, limit?: number) => Promise<SearchMatch[]>;
  runAudit: (prompt: string) => Promise<AuditExecution>;
}
