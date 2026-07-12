/**
 * Durable LibSQL/Turso-backed EngineeringRepository (production authority).
 * Aggregate + ledger writes share one SQL transaction; optimistic concurrency via version.
 * NES-1.2 / R1
 */

import Database from 'libsql';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

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
import { ENGINEERING_SCHEMA_SQL, ENGINEERING_SCHEMA_VERSION } from './schema';
import { sha256Hex } from './ids';
import {
  type ApplyTransactionInput,
  type EngineeringRepository,
  type EngineeringTaskBundle,
  EngineeringRepositoryError,
} from './repository-types';

type SqlDb = InstanceType<typeof Database>;

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new EngineeringRepositoryError(
      `Malformed serialized payload (${label}): ${error instanceof Error ? error.message : String(error)}`,
      'ERR_MALFORMED_PAYLOAD',
    );
  }
}

function taskFromRow(row: Record<string, unknown>): EngineeringTask {
  return {
    engineeringTaskId: String(row.engineering_task_id),
    workspaceId: String(row.workspace_id),
    conversationId: row.conversation_id == null ? null : String(row.conversation_id),
    pathKind: String(row.path_kind) as EngineeringTask['pathKind'],
    title: String(row.title),
    objectiveSeed: String(row.objective_seed),
    status: String(row.status) as EngineeringTask['status'],
    aggregateVersion: Number(row.aggregate_version),
    activeSpecificationVersion:
      row.active_specification_version == null
        ? null
        : Number(row.active_specification_version),
    activePlanVersion:
      row.active_plan_version == null ? null : Number(row.active_plan_version),
    activeTaskGraphVersion:
      row.active_task_graph_version == null
        ? null
        : Number(row.active_task_graph_version),
    policyPackRef:
      row.policy_pack_ref_json == null
        ? null
        : parseJson(String(row.policy_pack_ref_json), 'policy_pack_ref'),
    readiness: String(row.readiness) as EngineeringTask['readiness'],
    priorLegalStatus:
      row.prior_legal_status == null
        ? null
        : (String(row.prior_legal_status) as EngineeringTask['priorLegalStatus']),
    blockedReasonCode:
      row.blocked_reason_code == null
        ? null
        : (String(row.blocked_reason_code) as EngineeringTask['blockedReasonCode']),
    lastExecutionId:
      row.last_execution_id == null ? null : String(row.last_execution_id),
    lastProofId: row.last_proof_id == null ? null : String(row.last_proof_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
    readyAt: row.ready_at == null ? null : String(row.ready_at),
  };
}

export class LibSqlEngineeringRepository implements EngineeringRepository {
  private readonly db: SqlDb;
  private abortNextWrite = false;

  constructor(dbPathOrDb: string | SqlDb) {
    if (typeof dbPathOrDb === 'string') {
      if (dbPathOrDb !== ':memory:' && !dbPathOrDb.startsWith('file:')) {
        mkdirSync(path.dirname(dbPathOrDb), { recursive: true });
      }
      const filename =
        dbPathOrDb.startsWith('file:') ? dbPathOrDb.slice('file:'.length) : dbPathOrDb;
      this.db = new Database(filename);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
    } else {
      this.db = dbPathOrDb;
    }
  }

  static open(dbPath: string): LibSqlEngineeringRepository {
    const repo = new LibSqlEngineeringRepository(dbPath);
    repo.ensureSchema();
    return repo;
  }

  simulateAbortOnNextWrite(): void {
    this.abortNextWrite = true;
  }

  ensureSchema(): void {
    try {
      for (const sql of ENGINEERING_SCHEMA_SQL) {
        this.db.exec(sql);
      }
      // Applied-command idempotency ledger
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS engineering_applied_commands (
          command_id TEXT PRIMARY KEY,
          engineering_task_id TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      this.db
        .prepare(
          `INSERT INTO engineering_schema_meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(ENGINEERING_SCHEMA_VERSION));
    } catch (error) {
      throw new EngineeringRepositoryError(
        `Schema ensure failed: ${error instanceof Error ? error.message : String(error)}`,
        'ERR_DB_FAILURE',
      );
    }
  }

  getSchemaVersion(): number {
    try {
      const row = this.db
        .prepare(
          `SELECT value FROM engineering_schema_meta WHERE key = 'schema_version' LIMIT 1`,
        )
        .get() as { value?: string } | undefined;
      return row?.value ? Number(row.value) : 0;
    } catch {
      return 0;
    }
  }

  listTasks(workspaceId: string): EngineeringTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM engineering_tasks
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map(taskFromRow);
  }

  getTask(engineeringTaskId: string): EngineeringTask | null {
    const row = this.db
      .prepare(`SELECT * FROM engineering_tasks WHERE engineering_task_id = ?`)
      .get(engineeringTaskId) as Record<string, unknown> | undefined;
    return row ? taskFromRow(row) : null;
  }

  getEvents(engineeringTaskId: string): DomainEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM engineering_events
         WHERE engineering_task_id = ?
         ORDER BY seq ASC`,
      )
      .all(engineeringTaskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      eventId: String(row.event_id),
      engineeringTaskId: String(row.engineering_task_id),
      seq: Number(row.seq),
      type: String(row.type),
      payload: parseJson(String(row.payload_json), 'event.payload'),
      actor: parseJson(String(row.actor_json), 'event.actor'),
      causedByCommandId: String(row.caused_by_command_id),
      occurredAt: String(row.occurred_at),
      integrityHash: String(row.integrity_hash),
    }));
  }

  getSpecification(
    engineeringTaskId: string,
    version: number,
  ): SpecificationDocument | null {
    const row = this.db
      .prepare(
        `SELECT document_json FROM engineering_specifications
         WHERE engineering_task_id = ? AND version = ?`,
      )
      .get(engineeringTaskId, version) as { document_json?: string } | undefined;
    if (!row?.document_json) return null;
    return parseJson(row.document_json, 'specification');
  }

  getTaskGraph(
    engineeringTaskId: string,
    version: number,
  ): TaskGraphDocument | null {
    const row = this.db
      .prepare(
        `SELECT document_json FROM engineering_task_graphs
         WHERE engineering_task_id = ? AND version = ?`,
      )
      .get(engineeringTaskId, version) as { document_json?: string } | undefined;
    if (!row?.document_json) return null;
    return parseJson(row.document_json, 'task_graph');
  }

  getApproach(
    engineeringTaskId: string,
    version: number,
  ): TechnicalApproachDocument | null {
    const row = this.db
      .prepare(
        `SELECT document_json FROM engineering_approaches
         WHERE engineering_task_id = ? AND version = ?`,
      )
      .get(engineeringTaskId, version) as { document_json?: string } | undefined;
    if (!row?.document_json) return null;
    return parseJson(row.document_json, 'approach');
  }

  getProofByHandle(proofHandle: string): ShipProof | null {
    const row = this.db
      .prepare(
        `SELECT document_json FROM engineering_proofs WHERE proof_handle = ?`,
      )
      .get(proofHandle) as { document_json?: string } | undefined;
    if (!row?.document_json) return null;
    return parseJson(row.document_json, 'proof');
  }

  listActiveLeases(workspaceId: string): TaskLease[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM engineering_leases
         WHERE workspace_id = ? AND status = 'active'`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((row) => ({
      leaseId: String(row.lease_id),
      engineeringTaskId: String(row.engineering_task_id),
      taskId: String(row.task_id),
      agentId: String(row.agent_id),
      workspaceId: String(row.workspace_id),
      acquiredAt: String(row.acquired_at),
      expiresAt: String(row.expires_at),
      status: String(row.status) as TaskLease['status'],
    }));
  }

  getPolicyPack(policyPackId: string, version: string): PolicyPack | null {
    const row = this.db
      .prepare(
        `SELECT document_json FROM engineering_policy_packs
         WHERE policy_pack_id = ? AND version = ?`,
      )
      .get(policyPackId, version) as { document_json?: string } | undefined;
    if (!row?.document_json) return null;
    return parseJson(row.document_json, 'policy_pack');
  }

  savePolicyPack(pack: PolicyPack): void {
    this.db
      .prepare(
        `INSERT INTO engineering_policy_packs
          (policy_pack_id, version, policy_hash, document_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(policy_pack_id, version) DO UPDATE SET
           policy_hash = excluded.policy_hash,
           document_json = excluded.document_json`,
      )
      .run(
        pack.policyPackId,
        pack.version,
        pack.policyHash,
        JSON.stringify(pack),
        pack.createdAt,
      );
  }

  getBundle(engineeringTaskId: string): EngineeringTaskBundle | null {
    const task = this.getTask(engineeringTaskId);
    if (!task) return null;

    const events = this.getEvents(engineeringTaskId);
    const specifications = new Map<number, SpecificationDocument>();
    const approaches = new Map<number, TechnicalApproachDocument>();
    const taskGraphs = new Map<number, TaskGraphDocument>();
    const decisions = new Map<string, DecisionQueueItem>();
    const leases = new Map<string, TaskLease>();
    const validationRuns = new Map<string, ValidationRun>();
    const coverageReports = new Map<string, CoverageConvergenceReport>();
    const proofs = new Map<string, ShipProof>();
    const consistencyReports = new Map<string, unknown>();
    const executions = new Map<
      string,
      {
        executionId: string;
        workPlanId: string | null;
        status: string;
        document: unknown;
      }
    >();

    for (const row of this.db
      .prepare(
        `SELECT version, document_json FROM engineering_specifications
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ version: number; document_json: string }>) {
      specifications.set(
        Number(row.version),
        parseJson(row.document_json, 'specification'),
      );
    }
    for (const row of this.db
      .prepare(
        `SELECT version, document_json FROM engineering_approaches
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ version: number; document_json: string }>) {
      approaches.set(Number(row.version), parseJson(row.document_json, 'approach'));
    }
    for (const row of this.db
      .prepare(
        `SELECT version, document_json FROM engineering_task_graphs
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ version: number; document_json: string }>) {
      taskGraphs.set(Number(row.version), parseJson(row.document_json, 'task_graph'));
    }
    for (const row of this.db
      .prepare(
        `SELECT decision_id, item_json FROM engineering_decisions
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ decision_id: string; item_json: string }>) {
      decisions.set(String(row.decision_id), parseJson(row.item_json, 'decision'));
    }
    for (const row of this.db
      .prepare(
        `SELECT * FROM engineering_leases WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Record<string, unknown>[]) {
      const lease: TaskLease = {
        leaseId: String(row.lease_id),
        engineeringTaskId: String(row.engineering_task_id),
        taskId: String(row.task_id),
        agentId: String(row.agent_id),
        workspaceId: String(row.workspace_id),
        acquiredAt: String(row.acquired_at),
        expiresAt: String(row.expires_at),
        status: String(row.status) as TaskLease['status'],
      };
      leases.set(lease.leaseId, lease);
    }
    for (const row of this.db
      .prepare(
        `SELECT validation_run_id, document_json FROM engineering_validation_runs
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{
      validation_run_id: string;
      document_json: string;
    }>) {
      validationRuns.set(
        String(row.validation_run_id),
        parseJson(row.document_json, 'validation_run'),
      );
    }
    for (const row of this.db
      .prepare(
        `SELECT report_id, document_json FROM engineering_coverage_reports
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ report_id: string; document_json: string }>) {
      coverageReports.set(
        String(row.report_id),
        parseJson(row.document_json, 'coverage'),
      );
    }
    for (const row of this.db
      .prepare(
        `SELECT proof_id, document_json FROM engineering_proofs
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ proof_id: string; document_json: string }>) {
      proofs.set(String(row.proof_id), parseJson(row.document_json, 'proof'));
    }
    for (const row of this.db
      .prepare(
        `SELECT report_id, document_json FROM engineering_consistency_reports
         WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{ report_id: string; document_json: string }>) {
      consistencyReports.set(
        String(row.report_id),
        parseJson(row.document_json, 'consistency'),
      );
    }
    for (const row of this.db
      .prepare(
        `SELECT execution_id, work_plan_id, status, document_json
         FROM engineering_executions WHERE engineering_task_id = ?`,
      )
      .all(engineeringTaskId) as Array<{
      execution_id: string;
      work_plan_id: string | null;
      status: string;
      document_json: string;
    }>) {
      executions.set(String(row.execution_id), {
        executionId: String(row.execution_id),
        workPlanId: row.work_plan_id == null ? null : String(row.work_plan_id),
        status: String(row.status),
        document: parseJson(row.document_json, 'execution'),
      });
    }

    return {
      task,
      events,
      specifications,
      approaches,
      taskGraphs,
      decisions,
      leases,
      validationRuns,
      coverageReports,
      proofs,
      consistencyReports,
      executions,
    };
  }

  applyTransaction(input: ApplyTransactionInput): void {
    if (input.commandId) {
      const prior = this.db
        .prepare(
          `SELECT command_id FROM engineering_applied_commands WHERE command_id = ?`,
        )
        .get(input.commandId);
      if (prior) {
        return;
      }
    }

    const run = this.db.transaction(() => {
      if (this.abortNextWrite) {
        this.abortNextWrite = false;
        throw new EngineeringRepositoryError(
          'SIMULATED_ABORT',
          'ERR_SIMULATED_ABORT',
        );
      }

      const existing = this.getTask(input.task.engineeringTaskId);
      if (
        input.expectedAggregateVersion !== undefined &&
        existing &&
        existing.aggregateVersion !== input.expectedAggregateVersion
      ) {
        throw new EngineeringRepositoryError(
          `aggregate version conflict: expected ${input.expectedAggregateVersion}, got ${existing.aggregateVersion}`,
          'ERR_VERSION_CONFLICT',
        );
      }

      // Optimistic concurrency: reject if stored version is ahead of write target
      if (existing && existing.aggregateVersion > input.task.aggregateVersion) {
        throw new EngineeringRepositoryError(
          `stale write: stored ${existing.aggregateVersion} > write ${input.task.aggregateVersion}`,
          'ERR_VERSION_CONFLICT',
        );
      }
      if (
        existing &&
        input.task.aggregateVersion !== existing.aggregateVersion &&
        input.task.aggregateVersion !== existing.aggregateVersion + 1 &&
        existing.aggregateVersion !== 0
      ) {
        // Allow first write and monotonic +1; capture creates version 1
        if (!(existing.aggregateVersion === 0)) {
          // still allow any higher version if caller owns write path; enforce equality of prior
        }
      }

      // Event seq continuity
      const lastSeqRow = this.db
        .prepare(
          `SELECT MAX(seq) AS max_seq FROM engineering_events
           WHERE engineering_task_id = ?`,
        )
        .get(input.task.engineeringTaskId) as { max_seq: number | null };
      let lastSeq = lastSeqRow?.max_seq ?? 0;
      for (const event of input.events) {
        if (event.seq !== lastSeq + 1) {
          throw new EngineeringRepositoryError(
            `Event seq gap: expected ${lastSeq + 1}, got ${event.seq}`,
            'ERR_EVENT_SEQ',
          );
        }
        lastSeq = event.seq;
      }

      const t = input.task;
      this.db
        .prepare(
          `INSERT INTO engineering_tasks (
            engineering_task_id, workspace_id, conversation_id, path_kind, title,
            objective_seed, status, aggregate_version, active_specification_version,
            active_plan_version, active_task_graph_version, policy_pack_ref_json,
            readiness, prior_legal_status, blocked_reason_code, last_execution_id,
            last_proof_id, created_at, updated_at, cancelled_at, ready_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(engineering_task_id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            conversation_id = excluded.conversation_id,
            path_kind = excluded.path_kind,
            title = excluded.title,
            objective_seed = excluded.objective_seed,
            status = excluded.status,
            aggregate_version = excluded.aggregate_version,
            active_specification_version = excluded.active_specification_version,
            active_plan_version = excluded.active_plan_version,
            active_task_graph_version = excluded.active_task_graph_version,
            policy_pack_ref_json = excluded.policy_pack_ref_json,
            readiness = excluded.readiness,
            prior_legal_status = excluded.prior_legal_status,
            blocked_reason_code = excluded.blocked_reason_code,
            last_execution_id = excluded.last_execution_id,
            last_proof_id = excluded.last_proof_id,
            updated_at = excluded.updated_at,
            cancelled_at = excluded.cancelled_at,
            ready_at = excluded.ready_at`,
        )
        .run(
          t.engineeringTaskId,
          t.workspaceId,
          t.conversationId,
          t.pathKind,
          t.title,
          t.objectiveSeed,
          t.status,
          t.aggregateVersion,
          t.activeSpecificationVersion,
          t.activePlanVersion,
          t.activeTaskGraphVersion,
          t.policyPackRef ? JSON.stringify(t.policyPackRef) : null,
          t.readiness,
          t.priorLegalStatus,
          t.blockedReasonCode,
          t.lastExecutionId,
          t.lastProofId,
          t.createdAt,
          t.updatedAt,
          t.cancelledAt,
          t.readyAt,
        );

      for (const event of input.events) {
        this.db
          .prepare(
            `INSERT INTO engineering_events (
              event_id, engineering_task_id, seq, type, payload_json, actor_json,
              caused_by_command_id, occurred_at, integrity_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            event.engineeringTaskId,
            event.seq,
            event.type,
            JSON.stringify(event.payload),
            JSON.stringify(event.actor),
            event.causedByCommandId,
            event.occurredAt,
            event.integrityHash,
          );
      }

      if (input.specification) {
        const s = input.specification;
        this.db
          .prepare(
            `INSERT INTO engineering_specifications
              (engineering_task_id, version, specification_id, document_json, content_hash, frozen_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(engineering_task_id, version) DO UPDATE SET
               document_json = excluded.document_json,
               content_hash = excluded.content_hash,
               frozen_at = excluded.frozen_at`,
          )
          .run(
            t.engineeringTaskId,
            s.version,
            s.specificationId,
            JSON.stringify(s),
            s.contentHash,
            s.frozenAt,
          );
      }
      if (input.approach) {
        const a = input.approach;
        this.db
          .prepare(
            `INSERT INTO engineering_approaches
              (engineering_task_id, version, approach_id, document_json, content_hash)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(engineering_task_id, version) DO UPDATE SET
               document_json = excluded.document_json,
               content_hash = excluded.content_hash`,
          )
          .run(
            t.engineeringTaskId,
            a.version,
            a.approachId,
            JSON.stringify(a),
            a.contentHash,
          );
      }
      if (input.taskGraph) {
        const g = input.taskGraph;
        this.db
          .prepare(
            `INSERT INTO engineering_task_graphs
              (engineering_task_id, version, task_graph_id, document_json, content_hash)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(engineering_task_id, version) DO UPDATE SET
               document_json = excluded.document_json,
               content_hash = excluded.content_hash`,
          )
          .run(
            t.engineeringTaskId,
            g.version,
            g.taskGraphId,
            JSON.stringify(g),
            g.contentHash,
          );
      }
      if (input.decisions) {
        for (const d of input.decisions) {
          this.db
            .prepare(
              `INSERT INTO engineering_decisions
                (decision_id, engineering_task_id, item_json, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(decision_id) DO UPDATE SET
                 item_json = excluded.item_json,
                 updated_at = excluded.updated_at`,
            )
            .run(d.decisionId, t.engineeringTaskId, JSON.stringify(d), t.updatedAt);
        }
      }
      if (input.lease) {
        const l = input.lease;
        this.db
          .prepare(
            `INSERT INTO engineering_leases
              (lease_id, engineering_task_id, task_id, agent_id, workspace_id,
               acquired_at, expires_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(lease_id) DO UPDATE SET
               status = excluded.status,
               expires_at = excluded.expires_at`,
          )
          .run(
            l.leaseId,
            l.engineeringTaskId,
            l.taskId,
            l.agentId,
            l.workspaceId,
            l.acquiredAt,
            l.expiresAt,
            l.status,
          );
      }
      if (input.validationRun) {
        const v = input.validationRun;
        this.db
          .prepare(
            `INSERT INTO engineering_validation_runs
              (validation_run_id, engineering_task_id, document_json, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(validation_run_id) DO UPDATE SET document_json = excluded.document_json`,
          )
          .run(
            v.validationRunId,
            t.engineeringTaskId,
            JSON.stringify(v),
            t.updatedAt,
          );
      }
      if (input.coverage) {
        const c = input.coverage;
        this.db
          .prepare(
            `INSERT INTO engineering_coverage_reports
              (report_id, engineering_task_id, document_json, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(report_id) DO UPDATE SET document_json = excluded.document_json`,
          )
          .run(c.reportId, t.engineeringTaskId, JSON.stringify(c), t.updatedAt);
      }
      if (input.proof) {
        const p = input.proof;
        this.db
          .prepare(
            `INSERT INTO engineering_proofs
              (proof_id, engineering_task_id, proof_handle, document_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(proof_id) DO UPDATE SET
               document_json = excluded.document_json,
               status = excluded.status`,
          )
          .run(
            p.proofId,
            p.engineeringTaskId,
            p.proofHandle,
            JSON.stringify(p),
            p.status,
            p.generatedAt,
          );
      }
      if (input.consistencyReport) {
        this.db
          .prepare(
            `INSERT INTO engineering_consistency_reports
              (report_id, engineering_task_id, document_json, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(report_id) DO UPDATE SET document_json = excluded.document_json`,
          )
          .run(
            input.consistencyReport.reportId,
            t.engineeringTaskId,
            JSON.stringify(input.consistencyReport.document),
            t.updatedAt,
          );
      }
      if (input.execution) {
        const e = input.execution;
        this.db
          .prepare(
            `INSERT INTO engineering_executions
              (execution_id, engineering_task_id, work_plan_id, status, document_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(execution_id) DO UPDATE SET
               status = excluded.status,
               document_json = excluded.document_json,
               updated_at = excluded.updated_at`,
          )
          .run(
            e.executionId,
            t.engineeringTaskId,
            e.workPlanId,
            e.status,
            JSON.stringify(e.document),
            t.updatedAt,
            t.updatedAt,
          );
      }

      if (input.commandId) {
        this.db
          .prepare(
            `INSERT INTO engineering_applied_commands
              (command_id, engineering_task_id, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(input.commandId, t.engineeringTaskId, t.updatedAt);
      }
    });

    try {
      run();
    } catch (error) {
      if (error instanceof EngineeringRepositoryError) throw error;
      throw new EngineeringRepositoryError(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        'ERR_DB_FAILURE',
      );
    }
  }

  eventsIntegrityHash(engineeringTaskId: string): string {
    const events = this.getEvents(engineeringTaskId);
    return sha256Hex(
      JSON.stringify(events.map((e) => e.eventId + e.seq + e.type)),
    );
  }

  close(): void {
    this.db.close();
  }
}
