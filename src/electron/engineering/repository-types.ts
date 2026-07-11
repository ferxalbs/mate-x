/**
 * EngineeringRepository port — production authority is LibSQL/Turso-backed.
 * In-memory is a test-only adapter.
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
  executions: Map<
    string,
    {
      executionId: string;
      workPlanId: string | null;
      status: string;
      document: unknown;
    }
  >;
}

export interface ApplyTransactionInput {
  task: EngineeringTask;
  events: DomainEvent[];
  /** When set, write is rejected if stored aggregate_version differs. */
  expectedAggregateVersion?: number;
  /** Idempotency: if command already applied, no-op success. */
  commandId?: string;
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
}

export interface EngineeringRepository {
  ensureSchema(): void;
  getSchemaVersion(): number;
  listTasks(workspaceId: string): EngineeringTask[];
  getTask(engineeringTaskId: string): EngineeringTask | null;
  getBundle(engineeringTaskId: string): EngineeringTaskBundle | null;
  getEvents(engineeringTaskId: string): DomainEvent[];
  getSpecification(
    engineeringTaskId: string,
    version: number,
  ): SpecificationDocument | null;
  getTaskGraph(
    engineeringTaskId: string,
    version: number,
  ): TaskGraphDocument | null;
  getApproach(
    engineeringTaskId: string,
    version: number,
  ): TechnicalApproachDocument | null;
  getProofByHandle(proofHandle: string): ShipProof | null;
  listActiveLeases(workspaceId: string): TaskLease[];
  getPolicyPack(policyPackId: string, version: string): PolicyPack | null;
  savePolicyPack(pack: PolicyPack): void;
  applyTransaction(input: ApplyTransactionInput): void;
  eventsIntegrityHash(engineeringTaskId: string): string;
  /** Optional test hook — not required on durable impl. */
  simulateAbortOnNextWrite?(): void;
  /** Close underlying resources when durable. */
  close?(): void;
}

export class EngineeringRepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ERR_VERSION_CONFLICT'
      | 'ERR_EVENT_SEQ'
      | 'ERR_MALFORMED_PAYLOAD'
      | 'ERR_DB_FAILURE'
      | 'ERR_NOT_INITIALIZED'
      | 'ERR_SIMULATED_ABORT'
      | 'ERR_IDEMPOTENT_REPLAY' = 'ERR_DB_FAILURE',
  ) {
    super(message);
    this.name = 'EngineeringRepositoryError';
  }
}
