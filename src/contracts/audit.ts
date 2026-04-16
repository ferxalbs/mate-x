export type FindingSeverity = 'critical' | 'warning' | 'note';

export interface AuditFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  summary: string;
  file: string;
  recommendation: string;
}

export interface AuditReport {
  id: string;
  createdAt: string;
  headline: string;
  summary: string;
  findings: AuditFinding[];
  checkedAreas: string[];
}
