/**
 * Task graph compiler — deps, scopes, TSK ids, cycle detection.
 * NES-3.2
 */

import type {
  SpecificationDocument,
  TaskGraphDocument,
  TaskNode,
  TechnicalApproachDocument,
} from '../../contracts/engineering-task';
import { formatDisplayId } from '../../contracts/engineering-task';
import { sha256Hex } from './ids';
import { randomBytes } from 'node:crypto';

function taskId(): string {
  return randomBytes(10).toString('hex');
}

export function detectCycle(tasks: TaskNode[]): string[] | null {
  const byId = new Map(tasks.map((t) => [t.taskId, t]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(id: string): boolean {
    if (visiting.has(id)) {
      stack.push(id);
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (dfs(dep)) {
        stack.push(id);
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const t of tasks) {
    if (dfs(t.taskId)) return stack.reverse();
  }
  return null;
}

export function compileTaskGraph(input: {
  spec: SpecificationDocument;
  approach: TechnicalApproachDocument;
  version?: number;
  remediationOf?: { parentTaskId: string; title: string };
}):
  | { ok: true; graph: TaskGraphDocument }
  | { ok: false; reason: string } {
  const version = input.version ?? 1;
  const tasks: TaskNode[] = [];

  if (input.remediationOf) {
    tasks.push({
      taskId: taskId(),
      displayId: formatDisplayId('TSK', 1),
      title: input.remediationOf.title,
      description: 'Append-only remediation task',
      phase: 'remediation',
      dependsOn: [],
      fileScopes: { write: ['src'], read: ['src'] },
      linkedReqIds: input.spec.functionalRequirements.map((r) => r.reqId),
      linkedAcIds: input.spec.acceptanceScenarios.map((a) => a.acId),
      parallelSafe: false,
      validationObligations: ['run_tests'],
      preconditions: [],
      completionConditions: ['evidence recorded'],
      status: 'pending',
      remediationOf: input.remediationOf.parentTaskId,
      evidenceIds: [],
      version: 1,
    });
  } else if (input.spec.verifyOnly) {
    tasks.push({
      taskId: taskId(),
      displayId: formatDisplayId('TSK', 1),
      title: 'Run verification suite',
      description: input.spec.objective,
      phase: 'slice',
      dependsOn: [],
      fileScopes: { write: [], read: ['src'] },
      linkedReqIds: [],
      linkedAcIds: input.spec.acceptanceScenarios.map((a) => a.acId),
      parallelSafe: false,
      validationObligations: ['run_tests', 'typecheck'],
      preconditions: [],
      completionConditions: ['validation passed'],
      status: 'pending',
      evidenceIds: [],
      version: 1,
    });
  } else {
    let n = 0;
    for (const decision of input.approach.decisions) {
      n += 1;
      const id = taskId();
      tasks.push({
        taskId: id,
        displayId: formatDisplayId('TSK', n),
        title: decision.statement,
        description: decision.rationale,
        phase: n === 1 ? 'foundational' : 'slice',
        dependsOn: n > 1 ? [tasks[n - 2]!.taskId] : [],
        fileScopes: { write: ['src'], read: ['src'] },
        linkedReqIds: [...decision.linkedReqIds],
        linkedAcIds: input.spec.acceptanceScenarios
          .filter((ac) =>
            ac.linkedReqIds.some((r) => decision.linkedReqIds.includes(r)),
          )
          .map((ac) => ac.acId),
        parallelSafe: false,
        validationObligations: ['run_tests'],
        preconditions: [],
        completionConditions: ['tests pass', 'evidence recorded'],
        status: 'pending',
        evidenceIds: [],
        version: 1,
      });
    }
  }

  const orphan = tasks.filter(
    (t) =>
      !input.spec.verifyOnly &&
      t.phase !== 'remediation' &&
      t.linkedReqIds.length === 0,
  );
  if (orphan.length > 0) {
    return { ok: false, reason: `orphan tasks without REQ: ${orphan.map((t) => t.displayId).join(',')}` };
  }

  const cycle = detectCycle(tasks);
  if (cycle) {
    return { ok: false, reason: `cycle detected: ${cycle.join('→')}` };
  }

  const graph: TaskGraphDocument = {
    taskGraphId: `tg_${taskId()}`,
    version,
    tasks,
    criticalPathTaskIds: tasks.map((t) => t.taskId),
    mvpSliceTaskIds: tasks.map((t) => t.taskId),
    contentHash: '',
  };
  graph.contentHash = sha256Hex(JSON.stringify({ ...graph, contentHash: '' }));
  return { ok: true, graph };
}
