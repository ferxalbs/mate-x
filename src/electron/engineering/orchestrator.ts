/**
 * Serial execution orchestrator + leases.
 * multiAgentLeases=false — max 1 mutating execution per workspace.
 * NES-4.2
 */

import type {
  TaskGraphDocument,
  TaskLease,
  TaskNode,
} from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import { newNamespacedId, nowIso } from './ids';
import type { EngineeringRepository } from './repository';

export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

export function readyTasks(graph: TaskGraphDocument): TaskNode[] {
  const completed = new Set(
    graph.tasks.filter((t) => t.status === 'completed').map((t) => t.taskId),
  );
  return graph.tasks.filter((t) => {
    if (t.status !== 'pending' && t.status !== 'ready') return false;
    return t.dependsOn.every((d) => completed.has(d));
  });
}

export function scopesOverlap(
  a: { write: string[]; read: string[] },
  b: { write: string[]; read: string[] },
): boolean {
  const aw = new Set(a.write);
  for (const w of b.write) {
    if (aw.has(w)) return true;
    // prefix overlap rough check
    for (const x of aw) {
      if (w.startsWith(x) || x.startsWith(w)) return true;
    }
  }
  return false;
}

export function acquireLease(input: {
  repo: EngineeringRepository;
  workspaceId: string;
  engineeringTaskId: string;
  task: TaskNode;
  agentId: string;
  ttlMs?: number;
  multiAgentLeases?: boolean;
  now?: number;
}):
  | { ok: true; lease: TaskLease }
  | { ok: false; code: string; message: string } {
  const multi = input.multiAgentLeases ?? false;
  const now = input.now ?? Date.now();
  const active = input.repo
    .listActiveLeases(input.workspaceId)
    .filter((l) => new Date(l.expiresAt).getTime() > now);

  if (!multi && active.length > 0) {
    return {
      ok: false,
      code: ERR_CODES.ERR_LEASE_CONFLICT,
      message: 'v0.1.2 serial execution: another mutating lease is active',
    };
  }

  if (multi) {
    for (const lease of active) {
      const bundle = input.repo.getBundle(lease.engineeringTaskId);
      const other = bundle?.taskGraphs
        .get(bundle.task.activeTaskGraphVersion ?? -1)
        ?.tasks.find((t) => t.taskId === lease.taskId);
      if (other && scopesOverlap(other.fileScopes, input.task.fileScopes)) {
        return {
          ok: false,
          code: ERR_CODES.ERR_LEASE_CONFLICT,
          message: 'Overlapping write scope with active lease',
        };
      }
    }
  }

  const lease: TaskLease = {
    leaseId: newNamespacedId('lease'),
    engineeringTaskId: input.engineeringTaskId,
    taskId: input.task.taskId,
    agentId: input.agentId,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? DEFAULT_LEASE_TTL_MS)).toISOString(),
    status: 'active',
    workspaceId: input.workspaceId,
  };

  return { ok: true, lease };
}

export function expireStaleLeases(
  repo: EngineeringRepository,
  workspaceId: string,
  now = Date.now(),
): TaskLease[] {
  const expired: TaskLease[] = [];
  for (const lease of repo.listActiveLeases(workspaceId)) {
    if (new Date(lease.expiresAt).getTime() <= now) {
      const next: TaskLease = { ...lease, status: 'expired' };
      const task = repo.getTask(lease.engineeringTaskId);
      if (task) {
        repo.applyTransaction({
          task: { ...task, updatedAt: nowIso() },
          events: [],
          lease: next,
        });
      }
      expired.push(next);
    }
  }
  return expired;
}

export function completeTaskWithEvidence(input: {
  task: TaskNode;
  evidenceIds: string[];
  actorKind: 'human' | 'agent' | 'system';
  humanReason?: string;
}):
  | { ok: true; task: TaskNode }
  | { ok: false; code: string; message: string } {
  if (input.evidenceIds.length === 0) {
    if (input.actorKind === 'agent') {
      return {
        ok: false,
        code: ERR_CODES.ERR_TASK_EVIDENCE_REQUIRED,
        message: 'Agent CompleteTask requires evidenceIds',
      };
    }
    if (input.actorKind !== 'human' || !input.humanReason?.trim()) {
      return {
        ok: false,
        code: ERR_CODES.ERR_TASK_EVIDENCE_REQUIRED,
        message: 'CompleteTask requires evidenceIds',
      };
    }
  }

  return {
    ok: true,
    task: {
      ...input.task,
      status: 'completed',
      evidenceIds: [...input.evidenceIds],
      version: input.task.version + 1,
    },
  };
}

export function revokeLeasesForTask(
  repo: EngineeringRepository,
  engineeringTaskId: string,
): void {
  const bundle = repo.getBundle(engineeringTaskId);
  if (!bundle) return;
  for (const lease of bundle.leases.values()) {
    if (lease.status === 'active') {
      repo.applyTransaction({
        task: { ...bundle.task, updatedAt: nowIso() },
        events: [],
        lease: { ...lease, status: 'revoked' },
      });
    }
  }
}
