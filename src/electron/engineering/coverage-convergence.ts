/**
 * CoverageConvergence — deterministic ID coverage only.
 * NES-5.3
 */

import type {
  CoverageConvergenceReport,
  CoverageGap,
  SpecificationDocument,
  TaskGraphDocument,
  ValidationRun,
} from '../../contracts/engineering-task';
import { sha256Hex } from './ids';
import { validationRunUsableForReady } from './validation-engine';

export function runCoverageConvergence(input: {
  engineeringTaskId: string;
  spec: SpecificationDocument;
  graph: TaskGraphDocument;
  validationRuns: ValidationRun[];
  anchors: { headSha: string; diffHash: string; policyHash: string };
  specApproved: boolean;
  planApproved: boolean;
  policyBlocked: boolean;
}): CoverageConvergenceReport {
  const gaps: CoverageGap[] = [];

  if (!input.specApproved || !input.planApproved) {
    gaps.push({
      findingId: sha256Hex('unapproved').slice(0, 16),
      kind: 'unapproved_spec_or_plan',
      severity: 'CRITICAL',
      message: 'Specification or plan not approved',
      linkedIds: [],
    });
  }

  if (input.policyBlocked) {
    gaps.push({
      findingId: sha256Hex('policy').slice(0, 16),
      kind: 'policy_block',
      severity: 'CRITICAL',
      message: 'Unresolved blocking policy violation',
      linkedIds: [],
    });
  }

  const usableRuns = input.validationRuns.filter((r) =>
    validationRunUsableForReady(r, input.anchors),
  );

  for (const req of input.spec.functionalRequirements) {
    if (req.status === 'waived' || req.status === 'superseded') continue;
    const tasks = input.graph.tasks.filter((t) => t.linkedReqIds.includes(req.reqId));
    if (tasks.length === 0 && !input.spec.verifyOnly) {
      gaps.push({
        findingId: sha256Hex(`missing_task:${req.reqId}`).slice(0, 16),
        kind: 'missing_task_link',
        severity: 'CRITICAL',
        message: `Requirement ${req.reqId} has no task`,
        linkedIds: [req.reqId],
      });
      continue;
    }

    const incomplete = tasks.filter(
      (t) => t.status !== 'completed' && t.status !== 'cancelled',
    );
    if (incomplete.length > 0) {
      gaps.push({
        findingId: sha256Hex(`incomplete:${req.reqId}`).slice(0, 16),
        kind: 'incomplete_task',
        severity: 'CRITICAL',
        message: `Requirement ${req.reqId} has incomplete tasks`,
        linkedIds: [req.reqId, ...incomplete.map((t) => t.taskId)],
      });
    }

    for (const t of tasks.filter((x) => x.status === 'completed')) {
      if (t.evidenceIds.length === 0) {
        gaps.push({
          findingId: sha256Hex(`noev:${t.taskId}`).slice(0, 16),
          kind: 'task_without_evidence',
          severity: 'CRITICAL',
          message: `Task ${t.displayId} completed without evidence`,
          linkedIds: [t.taskId],
        });
      }
    }

    const relatedRuns = usableRuns.filter(
      (r) =>
        r.relatedReqIds.includes(req.reqId) ||
        tasks.some((t) => r.relatedTaskIds.includes(t.taskId)),
    );
    if (relatedRuns.length === 0 && !input.spec.verifyOnly) {
      gaps.push({
        findingId: sha256Hex(`unproven:${req.reqId}`).slice(0, 16),
        kind: 'unproven_req',
        severity: 'CRITICAL',
        message: `Requirement ${req.reqId} unproven by validation`,
        linkedIds: [req.reqId],
      });
    }
  }

  for (const ac of input.spec.acceptanceScenarios) {
    const hasTask = input.graph.tasks.some((t) => t.linkedAcIds.includes(ac.acId));
    const hasVal = usableRuns.some((r) =>
      input.graph.tasks.some(
        (t) => t.linkedAcIds.includes(ac.acId) && r.relatedTaskIds.includes(t.taskId),
      ),
    );
    if (!hasTask && !input.spec.verifyOnly) {
      gaps.push({
        findingId: sha256Hex(`ac:${ac.acId}`).slice(0, 16),
        kind: 'missing_task_link',
        severity: 'HIGH',
        message: `AC ${ac.acId} has no task`,
        linkedIds: [ac.acId],
      });
    }
    if (!hasVal) {
      gaps.push({
        findingId: sha256Hex(`acval:${ac.acId}`).slice(0, 16),
        kind: 'missing_validation',
        severity: 'CRITICAL',
        message: `AC ${ac.acId} missing validation evidence`,
        linkedIds: [ac.acId],
      });
    }
  }

  for (const t of input.graph.tasks) {
    if (
      !input.spec.verifyOnly &&
      t.phase !== 'remediation' &&
      t.linkedReqIds.length === 0
    ) {
      gaps.push({
        findingId: sha256Hex(`orphan:${t.taskId}`).slice(0, 16),
        kind: 'task_without_req',
        severity: 'CRITICAL',
        message: `Task ${t.displayId} without requirement`,
        linkedIds: [t.taskId],
      });
    }
  }

  for (const run of input.validationRuns) {
    if (run.passed === false) {
      gaps.push({
        findingId: sha256Hex(`fail:${run.validationRunId}`).slice(0, 16),
        kind: 'failed_validation',
        severity: 'CRITICAL',
        message: `Validation run failed: ${run.validationRunId}`,
        linkedIds: [run.validationRunId],
      });
    }
    if (
      run.headSha !== input.anchors.headSha ||
      run.diffHash !== input.anchors.diffHash
    ) {
      gaps.push({
        findingId: sha256Hex(`stale:${run.validationRunId}`).slice(0, 16),
        kind: 'stale_evidence',
        severity: 'CRITICAL',
        message: `Validation evidence stale: ${run.validationRunId}`,
        linkedIds: [run.validationRunId],
      });
    }
  }

  const inputsHash = sha256Hex(
    JSON.stringify({
      spec: input.spec.contentHash,
      graph: input.graph.contentHash,
      runs: input.validationRuns.map((r) => r.validationRunId),
      anchors: input.anchors,
    }),
  );

  const actionableGapCount = gaps.filter((g) => g.kind !== 'waived').length;

  return {
    reportId: `cvg_${inputsHash.slice(0, 12)}`,
    engineeringTaskId: input.engineeringTaskId,
    generatedAt: new Date().toISOString(),
    gaps,
    actionableGapCount,
    inputsHash,
  };
}
