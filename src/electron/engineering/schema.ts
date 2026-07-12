/**
 * EngineeringTask libSQL schema statements (NES-1.2).
 * Applied via CREATE TABLE IF NOT EXISTS — idempotent.
 */

export const ENGINEERING_SCHEMA_VERSION = 1;

export const ENGINEERING_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS engineering_schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_tasks (
    engineering_task_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT,
    path_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    objective_seed TEXT NOT NULL,
    status TEXT NOT NULL,
    aggregate_version INTEGER NOT NULL,
    active_specification_version INTEGER,
    active_plan_version INTEGER,
    active_task_graph_version INTEGER,
    policy_pack_ref_json TEXT,
    readiness TEXT NOT NULL,
    prior_legal_status TEXT,
    blocked_reason_code TEXT,
    last_execution_id TEXT,
    last_proof_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT,
    ready_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engineering_tasks_workspace
    ON engineering_tasks(workspace_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS engineering_events (
    event_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    caused_by_command_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    UNIQUE(engineering_task_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engineering_events_task_seq
    ON engineering_events(engineering_task_id, seq)`,
  `CREATE TABLE IF NOT EXISTS engineering_specifications (
    engineering_task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    specification_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    frozen_at TEXT,
    PRIMARY KEY(engineering_task_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_approaches (
    engineering_task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    approach_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY(engineering_task_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_task_graphs (
    engineering_task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    task_graph_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY(engineering_task_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_decisions (
    decision_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    item_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engineering_decisions_task
    ON engineering_decisions(engineering_task_id)`,
  `CREATE TABLE IF NOT EXISTS engineering_leases (
    lease_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engineering_leases_workspace_status
    ON engineering_leases(workspace_id, status)`,
  `CREATE TABLE IF NOT EXISTS engineering_executions (
    execution_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    work_plan_id TEXT,
    status TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_validation_runs (
    validation_run_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_coverage_reports (
    report_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_proofs (
    proof_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    proof_handle TEXT NOT NULL UNIQUE,
    document_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engineering_proofs_handle
    ON engineering_proofs(proof_handle)`,
  `CREATE TABLE IF NOT EXISTS engineering_policy_packs (
    policy_pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(policy_pack_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS engineering_consistency_reports (
    report_id TEXT PRIMARY KEY,
    engineering_task_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];
