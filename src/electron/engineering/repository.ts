/**
 * In-memory EngineeringTask repository with transactional apply semantics.
 * Production wiring can swap persistence via EngineeringStore adapter.
 * NES-1.2 / NES-1.3
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
import { sha256Hex } from './ids';

export interface EngineeringTaskBundle {
  task: EngineeringTask;
  events: DomainEvent[];
  specifications: Map<number, SpecificationDocument>;
  approaches: Map<number, TechnicalApproachDocument>;
  taskGraphs: Map<number, TaskGraphDocument>;
  decisions: Map<string, DecisionQueueItem>;
  leases: Map<string, TaskLease>;
  validationRuns: Map<string, ValidationRun>;
  coverageReports: Map<string, CoverageConvergenceReport>;
  proofs: Map<string, ShipProof>;
  consistencyReports: Map<string, unknown>;
  executions: Map<string, { executionId: string; workPlanId: string | null; status: string; document: unknown }>;
}

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

export class EngineeringRepository {
  private readonly byId = new Map<string, EngineeringTaskBundle>();
  private readonly byWorkspace = new Map<string, Set<string>>();
  private readonly proofsByHandle = new Map<string, string>();
  private readonly policyPacks = new Map<string, PolicyPack>();
  private schemaVersion = 0;
  private writeDepth = 0;
  private abortNextWrite = false;

  /** Test hook: simulate crash mid-transaction. */
  simulateAbortOnNextWrite(): void {
    this.abortNextWrite = true;
  }

  ensureSchema(): void {
    this.schemaVersion = 1;
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

  /**
   * Atomically persist aggregate + events (+ optional nested documents).
   * On abort, leaves prior version intact.
   */
  applyTransaction(input: {
    task: EngineeringTask;
    events: DomainEvent[];
    specification?: SpecificationDocument;
    approach?: TechnicalApproachDocument;
    taskGraph?: TaskGraphDocument;
    decisions?: DecisionQueueItem[];
    lease?: TaskLease;
    validationRun?: ValidationRun;
    coverage?: CoverageConvergenceReport;
    proof?: ShipProof;
    consistencyReport?: { reportId: string; document: unknown };
    execution?: {
      executionId: string;
      workPlanId: string | null;
      status: string;
      document: unknown;
    };
  }): void {
    this.writeDepth += 1;
    try {
      if (this.abortNextWrite) {
        this.abortNextWrite = false;
        throw new Error('SIMULATED_ABORT');
      }

      const existing = this.byId.get(input.task.engineeringTaskId);
      const bundle = existing
        ? cloneBundle(existing)
        : emptyBundle(structuredClone(input.task));

      bundle.task = structuredClone(input.task);
      for (const event of input.events) {
        const lastSeq = bundle.events[bundle.events.length - 1]?.seq ?? 0;
        if (event.seq !== lastSeq + 1) {
          throw new Error(`Event seq gap: expected ${lastSeq + 1}, got ${event.seq}`);
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
    } finally {
      this.writeDepth -= 1;
    }
  }

  /** Hash all events for integrity checks. */
  eventsIntegrityHash(engineeringTaskId: string): string {
    const events = this.getEvents(engineeringTaskId);
    return sha256Hex(JSON.stringify(events.map((e) => e.eventId + e.seq + e.type)));
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

/** Process-local default repository (main process). */
let defaultRepo: EngineeringRepository | null = null;

export function getEngineeringRepository(): EngineeringRepository {
  if (!defaultRepo) {
    defaultRepo = new EngineeringRepository();
    defaultRepo.ensureSchema();
  }
  return defaultRepo;
}

export function resetEngineeringRepositoryForTests(): EngineeringRepository {
  defaultRepo = new EngineeringRepository();
  defaultRepo.ensureSchema();
  return defaultRepo;
}
