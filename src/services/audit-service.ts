import type { AuditReport } from '../contracts/audit';
import type { ToolEvent } from '../contracts/chat';
import { runRepositoryAudit as runAuditViaIpc } from './repo-client';

export interface AuditExecution {
  events: ToolEvent[];
  report: AuditReport;
}

export async function runRepositoryAudit(prompt: string): Promise<AuditExecution> {
  return runAuditViaIpc(prompt);
}
