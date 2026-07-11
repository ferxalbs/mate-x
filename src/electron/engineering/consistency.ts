/**
 * Consistency analyzer — ID coverage only (no LLM).
 * NES-3.3
 */

import type {
  SpecificationDocument,
  TaskGraphDocument,
  TechnicalApproachDocument,
} from '../../contracts/engineering-task';
import { sha256Hex } from './ids';

export type ConsistencySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConsistencyFinding {
  findingId: string;
  severity: ConsistencySeverity;
  code: string;
  message: string;
  linkedIds: string[];
}

export interface ConsistencyReport {
  reportId: string;
  engineeringTaskId: string;
  generatedAt: string;
  findings: ConsistencyFinding[];
  criticalCount: number;
  inputsHash: string;
}

function findingId(code: string, linked: string[]): string {
  return sha256Hex(`${code}|${linked.join(',')}`).slice(0, 16);
}

export function analyzeConsistency(input: {
  engineeringTaskId: string;
  spec: SpecificationDocument;
  approach: TechnicalApproachDocument | null;
  graph: TaskGraphDocument | null;
}): ConsistencyReport {
  const findings: ConsistencyFinding[] = [];
  const activeReqs = input.spec.functionalRequirements.filter(
    (r) => r.status === 'active' || r.status === 'draft',
  );

  if (!input.spec.verifyOnly) {
    for (const req of activeReqs) {
      if (req.status === 'waived') continue;
      const linkedTask = input.graph?.tasks.some((t) =>
        t.linkedReqIds.includes(req.reqId),
      );
      if (!linkedTask) {
        findings.push({
          findingId: findingId('REQ_WITHOUT_TASK', [req.reqId]),
          severity: 'CRITICAL',
          code: 'REQ_WITHOUT_TASK',
          message: `Requirement ${req.reqId} has no linked task`,
          linkedIds: [req.reqId],
        });
      }
    }

    for (const ac of input.spec.acceptanceScenarios) {
      const hasValidationPath =
        ac.verificationMethod !== 'unspecified' &&
        (input.graph?.tasks.some((t) => t.linkedAcIds.includes(ac.acId)) ?? false);
      if (!hasValidationPath) {
        findings.push({
          findingId: findingId('AC_WITHOUT_VALIDATION_PATH', [ac.acId]),
          severity: 'CRITICAL',
          code: 'AC_WITHOUT_VALIDATION_PATH',
          message: `Acceptance ${ac.acId} lacks task/validation path`,
          linkedIds: [ac.acId],
        });
      }
    }
  }

  if (input.graph) {
    for (const task of input.graph.tasks) {
      if (
        !input.spec.verifyOnly &&
        task.phase !== 'remediation' &&
        task.linkedReqIds.length === 0
      ) {
        findings.push({
          findingId: findingId('TASK_WITHOUT_REQ', [task.taskId]),
          severity: 'CRITICAL',
          code: 'TASK_WITHOUT_REQ',
          message: `Task ${task.displayId} has no source requirement`,
          linkedIds: [task.taskId],
        });
      }
    }
  }

  if (input.approach) {
    for (const d of input.approach.decisions) {
      if (d.kind === 'product_linked' && d.linkedReqIds.length === 0) {
        findings.push({
          findingId: findingId('DECISION_UNLINKED', [d.researchId]),
          severity: 'CRITICAL',
          code: 'DECISION_UNLINKED',
          message: `Research decision ${d.researchId} not linked to REQs`,
          linkedIds: [d.researchId],
        });
      }
    }
  }

  const inputsHash = sha256Hex(
    JSON.stringify({
      spec: input.spec.contentHash,
      approach: input.approach?.contentHash ?? null,
      graph: input.graph?.contentHash ?? null,
    }),
  );

  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;

  return {
    reportId: `cons_${inputsHash.slice(0, 12)}`,
    engineeringTaskId: input.engineeringTaskId,
    generatedAt: new Date().toISOString(),
    findings,
    criticalCount,
    inputsHash,
  };
}
