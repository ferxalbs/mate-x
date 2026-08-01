/**
 * In-memory EngineeringRepository — TEST ADAPTER ONLY.
 * Production must use LibSqlEngineeringRepository.
 * NES-1.2 / R1
 */

import type {
  CoverageConvergenceReport,
  DecisionQueueItem,
  DomainEvent,
  EngineeringTask,
  PolicyPack,
  ShipProof,
  SpecificationDocument,
  TaskGraphDocument,
  TaskLease,
  TechnicalApproachDocument,
  ValidationRun,
} from '../../contracts/engineering-task';
import type {
  AgentExecutionSessionState,
  AgentRunEventV3,
} from '../../contracts/agent-run-trace';
import { sha256Hex } from './ids';
import {
  type ApplyTransactionInput,
  type EngineeringRepository,
  type EngineeringTaskBundle,
  EngineeringRepositoryError,
} from './repository-types';

function emptyBundle(task: EngineeringTask): EngineeringTaskBundle {
  return {
    task,
    events: [],
    specifications: new Map(),
    approaches: new Map(),
    taskGraphs: new Map(),
    decisions: new Map(),
    leases: new Map(),
    validationRuns: new Map(),
    coverageReports: new Map(),
    proofs: new Map(),
    consistencyReports: new Map(),
    executions: new Map(),
  };
}

export class InMemoryEngineeringRepository implements EngineeringRepository {
  private readonly byId = new Map<string, EngineeringTaskBundle>();
  private readonly byWorkspace = new Map<string, Set<string>>();
  private readonly proofsByHandle = new Map<string, string>();
  private readonly policyPacks = new Map<string, PolicyPack>();
  private readonly appliedCommandIds = new Set<string>();
  private readonly runEvents = new Map<string, AgentRunEventV3[]>();
  private schemaVersion = 0;
  private abortNextWrite = false;

  /** Test hook: simulate crash mid-transaction. */
  simulateAbortOnNextWrite(): void {
    this.abortNextWrite = true;
  }

  ensureSchema(): void {
    this.schemaVersion = 3;
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  listTasks(workspaceId: string): EngineeringTask[] {
    const ids = this.byWorkspace.get(workspaceId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.byId.get(id)?.task)
      .filter((t): t is EngineeringTask => Boolean(t))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getTask(engineeringTaskId: string): EngineeringTask | null {
    return this.byId.get(engineeringTaskId)?.task ?? null;
  }

  getBundle(engineeringTaskId: string): EngineeringTaskBundle | null {
    const b = this.byId.get(engineeringTaskId);
    return b ? cloneBundle(b) : null;
  }

  getEvents(engineeringTaskId: string): DomainEvent[] {
    return [...(this.byId.get(engineeringTaskId)?.events ?? [])];
  }

  getSpecification(
    engineeringTaskId: string,
    version: number,
  ): SpecificationDocument | null {
    return this.byId.get(engineeringTaskId)?.specifications.get(version) ?? null;
  }

  getTaskGraph(
    engineeringTaskId: string,
    version: number,
  ): TaskGraphDocument | null {
    return this.byId.get(engineeringTaskId)?.taskGraphs.get(version) ?? null;
  }

  getApproach(
    engineeringTaskId: string,
    version: number,
  ): TechnicalApproachDocument | null {
    return this.byId.get(engineeringTaskId)?.approaches.get(version) ?? null;
  }

  getProofByHandle(proofHandle: string): ShipProof | null {
    const proofId = this.proofsByHandle.get(proofHandle);
    if (!proofId) return null;
    for (const bundle of this.byId.values()) {
      const proof = bundle.proofs.get(proofId);
      if (proof) return structuredClone(proof);
    }
    return null;
  }

  listActiveLeases(workspaceId: string): TaskLease[] {
    const out: TaskLease[] = [];
    for (const bundle of this.byId.values()) {
      for (const lease of bundle.leases.values()) {
        if (lease.workspaceId === workspaceId && lease.status === 'active') {
          out.push(structuredClone(lease));
        }
      }
    }
    return out;
  }

  getPolicyPack(policyPackId: string, version: string): PolicyPack | null {
    return this.policyPacks.get(`${policyPackId}@${version}`) ?? null;
  }

  savePolicyPack(pack: PolicyPack): void {
    this.policyPacks.set(`${pack.policyPackId}@${pack.version}`, structuredClone(pack));
  }

  applyTransaction(input: ApplyTransactionInput): void {
    if (input.commandId && this.appliedCommandIds.has(input.commandId)) {
      return;
    }
    if (this.abortNextWrite) {
      this.abortNextWrite = false;
      throw new EngineeringRepositoryError('SIMULATED_ABORT', 'ERR_SIMULATED_ABORT');
    }

    const existing = this.byId.get(input.task.engineeringTaskId);
    if (
      input.expectedAggregateVersion !== undefined &&
      existing &&
      existing.task.aggregateVersion !== input.expectedAggregateVersion
    ) {
      throw new EngineeringRepositoryError(
        `aggregate version conflict: expected ${input.expectedAggregateVersion}, got ${existing.task.aggregateVersion}`,
        'ERR_VERSION_CONFLICT',
      );
    }

    const bundle = existing
      ? cloneBundle(existing)
      : emptyBundle(structuredClone(input.task));

    bundle.task = structuredClone(input.task);
    for (const event of input.events) {
      const lastSeq = bundle.events[bundle.events.length - 1]?.seq ?? 0;
      if (event.seq !== lastSeq + 1) {
        throw new EngineeringRepositoryError(
          `Event seq gap: expected ${lastSeq + 1}, got ${event.seq}`,
          'ERR_EVENT_SEQ',
        );
      }
      bundle.events.push(structuredClone(event));
    }

    if (input.specification) {
      bundle.specifications.set(
        input.specification.version,
        structuredClone(input.specification),
      );
    }
    if (input.approach) {
      bundle.approaches.set(input.approach.version, structuredClone(input.approach));
    }
    if (input.taskGraph) {
      bundle.taskGraphs.set(input.taskGraph.version, structuredClone(input.taskGraph));
    }
    if (input.decisions) {
      for (const d of input.decisions) {
        bundle.decisions.set(d.decisionId, structuredClone(d));
      }
    }
    if (input.lease) {
      bundle.leases.set(input.lease.leaseId, structuredClone(input.lease));
    }
    if (input.validationRun) {
      bundle.validationRuns.set(
        input.validationRun.validationRunId,
        structuredClone(input.validationRun),
      );
    }
    if (input.coverage) {
      bundle.coverageReports.set(
        input.coverage.reportId,
        structuredClone(input.coverage),
      );
    }
    if (input.proof) {
      bundle.proofs.set(input.proof.proofId, structuredClone(input.proof));
      this.proofsByHandle.set(input.proof.proofHandle, input.proof.proofId);
    }
    if (input.consistencyReport) {
      bundle.consistencyReports.set(
        input.consistencyReport.reportId,
        structuredClone(input.consistencyReport.document),
      );
    }
    if (input.execution) {
      bundle.executions.set(input.execution.executionId, structuredClone(input.execution));
    }

    this.byId.set(input.task.engineeringTaskId, bundle);
    let set = this.byWorkspace.get(input.task.workspaceId);
    if (!set) {
      set = new Set();
      this.byWorkspace.set(input.task.workspaceId, set);
    }
    set.add(input.task.engineeringTaskId);
    if (input.commandId) {
      this.appliedCommandIds.add(input.commandId);
    }
  }

  eventsIntegrityHash(engineeringTaskId: string): string {
    const events = this.getEvents(engineeringTaskId);
    return sha256Hex(JSON.stringify(events.map((e) => e.eventId + e.seq + e.type)));
  }

  appendAgentRunEvents(input: {
    runId: string;
    traceId: string;
    engineeringTaskId: string | null;
    executionId: string | null;
    behaviorMode: AgentRunEventV3["mode"];
    state: AgentExecutionSessionState;
    events: AgentRunEventV3[];
  }): void {
    void input.traceId;
    void input.engineeringTaskId;
    void input.executionId;
    void input.behaviorMode;
    void input.state;
    const current = this.runEvents.get(input.runId) ?? [];
    let expectedSeq = (current.at(-1)?.seq ?? 0) + 1;
    for (const event of input.events) {
      if (event.seq !== expectedSeq) {
        throw new EngineeringRepositoryError(
          `Run event seq gap: expected ${expectedSeq}, got ${event.seq}`,
          'ERR_EVENT_SEQ',
        );
      }
      current.push(structuredClone(event));
      expectedSeq++;
    }
    this.runEvents.set(input.runId, current);
  }

  getAgentRunEvents(runId: string, afterSeq = 0, limit = 1_000): AgentRunEventV3[] {
    return (this.runEvents.get(runId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  deleteAgentRunEventsBefore(cutoffIso: string): number {
    let deleted = 0;
    for (const [runId, events] of this.runEvents) {
      const retained = events.filter((event) => event.occurredAt >= cutoffIso);
      deleted += events.length - retained.length;
      if (retained.length === 0) this.runEvents.delete(runId);
      else this.runEvents.set(runId, retained);
    }
    return deleted;
  }
}

function cloneBundle(b: EngineeringTaskBundle): EngineeringTaskBundle {
  return {
    task: structuredClone(b.task),
    events: structuredClone(b.events),
    specifications: new Map(
      [...b.specifications.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    approaches: new Map(
      [...b.approaches.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    taskGraphs: new Map(
      [...b.taskGraphs.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    decisions: new Map(
      [...b.decisions.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    leases: new Map([...b.leases.entries()].map(([k, v]) => [k, structuredClone(v)])),
    validationRuns: new Map(
      [...b.validationRuns.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    coverageReports: new Map(
      [...b.coverageReports.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    proofs: new Map([...b.proofs.entries()].map(([k, v]) => [k, structuredClone(v)])),
    consistencyReports: new Map(
      [...b.consistencyReports.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
    executions: new Map(
      [...b.executions.entries()].map(([k, v]) => [k, structuredClone(v)]),
    ),
  };
}

// Re-export nested types used by callers that imported from repository
export type {
  CoverageConvergenceReport,
  DecisionQueueItem,
  DomainEvent,
  EngineeringTask,
  PolicyPack,
  ShipProof,
  SpecificationDocument,
  TaskGraphDocument,
  TaskLease,
  TechnicalApproachDocument,
  ValidationRun,
};
