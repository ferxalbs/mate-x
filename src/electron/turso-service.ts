import { app } from 'electron';
import { createClient, type Client } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Conversation } from '../contracts/chat';
import type {
  RepoGraphEdge,
  RepoGraphNode,
  RepoGraphSnapshot,
} from '../contracts/repo-graph';
import type {
  WorkspaceEntry,
  WorkspaceProfile,
  WorkspaceTrustContract,
  ValidationRun,
} from '../contracts/workspace';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../contracts/settings';
import { createId } from '../lib/id';
import {
  createDefaultWorkspaceTrustContract,
  normalizeWorkspaceTrustContract,
} from './workspace-trust';

interface WorkspaceSessionRecord {
  activeThreadId: string;
  threads: Conversation[];
}

const DEFAULT_THREADS_JSON = '[]';

export class TursoService {
  private client: Client | null = null;
  private initialized = false;

  private getClient() {
    if (this.client) {
      return this.client;
    }

    const configuredUrl = process.env.TURSO_DATABASE_URL?.trim();
    const databaseUrl =
      configuredUrl && configuredUrl.length > 0
        ? configuredUrl
        : `file:${path.join(app.getPath('userData'), 'mate-x.db')}`;

    this.client = createClient({
      url: databaseUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    });

    return this.client;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await mkdir(app.getPath('userData'), { recursive: true });
    const client = this.getClient();

    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          added_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS workspace_sessions (
          workspace_id TEXT PRIMARY KEY,
          active_thread_id TEXT,
          threads_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS workspace_profiles (
          workspace_id TEXT PRIMARY KEY,
          package_manager TEXT,
          test_framework TEXT,
          test_command TEXT,
          lint_command TEXT,
          build_command TEXT,
          typecheck_command TEXT,
          shell TEXT,
          flags TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS validation_runs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          command TEXT NOT NULL,
          scope TEXT,
          exit_code INTEGER,
          status TEXT,
          output_summary TEXT,
          failing_tests TEXT,
          ran_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS workspace_trust_contracts (
          workspace_id TEXT PRIMARY KEY,
          contract_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS repo_graph_nodes (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          metadata_json TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE(workspace_id, kind, key),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS repo_graph_edges (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          from_node_id TEXT NOT NULL,
          to_node_id TEXT NOT NULL,
          metadata_json TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE(workspace_id, kind, from_node_id, to_node_id),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(from_node_id) REFERENCES repo_graph_nodes(id) ON DELETE CASCADE,
          FOREIGN KEY(to_node_id) REFERENCES repo_graph_nodes(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS repo_graph_snapshots (
          workspace_id TEXT PRIMARY KEY,
          indexed_at TEXT NOT NULL,
          node_count INTEGER NOT NULL,
          edge_count INTEGER NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_repo_graph_nodes_workspace_kind
          ON repo_graph_nodes(workspace_id, kind)`,
        `CREATE INDEX IF NOT EXISTS idx_repo_graph_edges_workspace_kind
          ON repo_graph_edges(workspace_id, kind)`,
      ],
      'write',
    );

    this.initialized = true;
  }

  async ensureSeedWorkspace(defaultPath: string) {
    await this.initialize();
    const existing = await this.getWorkspaces();
    if (existing.length > 0) {
      return;
    }

    await this.upsertWorkspace(defaultPath, true);
  }

  async getWorkspaces(): Promise<WorkspaceEntry[]> {
    await this.initialize();
    const result = await this.getClient().execute(
      `SELECT id, name, path, added_at, last_opened_at
       FROM workspaces
       ORDER BY datetime(last_opened_at) DESC, datetime(added_at) DESC`,
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      addedAt: String(row.added_at),
      lastOpenedAt: String(row.last_opened_at),
    }));
  }

  async getActiveWorkspaceId() {
    await this.initialize();
    const result = await this.getClient().execute({
      sql: `SELECT value FROM app_state WHERE key = ? LIMIT 1`,
      args: ['active_workspace_id'],
    });

    return result.rows[0]?.value ? String(result.rows[0].value) : null;
  }

  async setActiveWorkspaceId(workspaceId: string) {
    await this.initialize();
    await this.getClient().execute({
      sql: `INSERT INTO app_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: ['active_workspace_id', workspaceId],
    });
  }

  async upsertWorkspace(workspacePath: string, setActive = false) {
    await this.initialize();
    const normalizedPath = path.resolve(workspacePath);
    const now = new Date().toISOString();
    const existing = await this.getClient().execute({
      sql: `SELECT id FROM workspaces WHERE path = ? LIMIT 1`,
      args: [normalizedPath],
    });

    let workspaceId: string;
    if (existing.rows[0]?.id) {
      workspaceId = String(existing.rows[0].id);
      await this.getClient().execute({
        sql: `UPDATE workspaces
              SET name = ?, last_opened_at = ?
              WHERE id = ?`,
        args: [path.basename(normalizedPath) || normalizedPath, now, workspaceId],
      });
    } else {
      workspaceId = createId('workspace');
      await this.getClient().execute({
        sql: `INSERT INTO workspaces (id, name, path, added_at, last_opened_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          workspaceId,
          path.basename(normalizedPath) || normalizedPath,
          normalizedPath,
          now,
          now,
        ],
      });
    }

    await this.ensureWorkspaceSession(workspaceId);
    await this.ensureWorkspaceTrustContract(workspaceId);

    if (setActive) {
      await this.setActiveWorkspaceId(workspaceId);
    }

    return workspaceId;
  }

  async removeWorkspace(workspaceId: string) {
    await this.initialize();
    await this.getClient().batch(
      [
        {
          sql: `DELETE FROM workspace_sessions WHERE workspace_id = ?`,
          args: [workspaceId],
        },
        {
          sql: `DELETE FROM workspaces WHERE id = ?`,
          args: [workspaceId],
        },
      ],
      'write',
    );

    const activeWorkspaceId = await this.getActiveWorkspaceId();
    if (activeWorkspaceId === workspaceId) {
      const remaining = await this.getWorkspaces();
      if (remaining[0]?.id) {
        await this.setActiveWorkspaceId(remaining[0].id);
      }
    }
  }

  async getWorkspaceSession(workspaceId: string): Promise<WorkspaceSessionRecord> {
    await this.initialize();
    await this.ensureWorkspaceSession(workspaceId);
    const result = await this.getClient().execute({
      sql: `SELECT active_thread_id, threads_json
            FROM workspace_sessions
            WHERE workspace_id = ?
            LIMIT 1`,
      args: [workspaceId],
    });

    const row = result.rows[0];
    const threads = safeParseThreads(row?.threads_json ? String(row.threads_json) : DEFAULT_THREADS_JSON);
    const activeThreadId =
      row?.active_thread_id && String(row.active_thread_id).length > 0
        ? String(row.active_thread_id)
        : threads[0]?.id ?? createId(`thread-${workspaceId}`);

    return {
      activeThreadId,
      threads,
    };
  }

  async saveWorkspaceSession(
    workspaceId: string,
    threads: Conversation[],
    activeThreadId: string,
  ) {
    await this.initialize();
    await this.ensureWorkspaceSession(workspaceId);
    await this.getClient().execute({
      sql: `UPDATE workspace_sessions
            SET active_thread_id = ?, threads_json = ?, updated_at = ?
            WHERE workspace_id = ?`,
      args: [activeThreadId, JSON.stringify(threads), new Date().toISOString(), workspaceId],
    });
  }

  // ── API Key ─────────────────────────────────────────────────────────────

  async getApiKey(): Promise<string | null> {
    return this.getAppStateValue('rainy_api_key');
  }

  async setApiKey(apiKey: string) {
    await this.initialize();
    const normalizedApiKey = apiKey.trim();
    await this.getClient().execute({
      sql: `INSERT INTO app_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: ['rainy_api_key', normalizedApiKey],
    });
  }

  async getModel(): Promise<string | null> {
    return this.getAppStateValue('rainy_model');
  }

  async setModel(model: string) {
    await this.initialize();
    const normalizedModel = model.trim();
    await this.getClient().execute({
      sql: `INSERT INTO app_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: ['rainy_model', normalizedModel],
    });
  }

  async getAppSettings(): Promise<AppSettings> {
    await this.initialize();
    const raw = await this.getAppStateValue('app_settings');

    if (!raw) {
      return { ...DEFAULT_APP_SETTINGS };
    }

    try {
      return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>);
    } catch {
      return { ...DEFAULT_APP_SETTINGS };
    }
  }

  async updateAppSettings(settings: AppSettings): Promise<AppSettings> {
    await this.initialize();
    const normalizedSettings = normalizeAppSettings(settings);
    await this.getClient().execute({
      sql: `INSERT INTO app_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: ['app_settings', JSON.stringify(normalizedSettings)],
    });
    return normalizedSettings;
  }

  // ── Workspace Profiles & Validation Runs ─────────────────────────────────

  async getWorkspaceProfile(workspaceId: string): Promise<WorkspaceProfile | null> {
    await this.initialize();
    const result = await this.getClient().execute({
      sql: `SELECT workspace_id, package_manager, test_framework, test_command, lint_command, build_command, typecheck_command, shell, flags, updated_at
            FROM workspace_profiles
            WHERE workspace_id = ? LIMIT 1`,
      args: [workspaceId],
    });

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      workspaceId: String(row.workspace_id),
      packageManager: row.package_manager ? String(row.package_manager) : undefined,
      testFramework: row.test_framework ? String(row.test_framework) : undefined,
      testCommand: row.test_command ? String(row.test_command) : undefined,
      lintCommand: row.lint_command ? String(row.lint_command) : undefined,
      buildCommand: row.build_command ? String(row.build_command) : undefined,
      typecheckCommand: row.typecheck_command ? String(row.typecheck_command) : undefined,
      shell: row.shell ? String(row.shell) : undefined,
      flags: row.flags ? String(row.flags) : undefined,
      updatedAt: String(row.updated_at),
    };
  }

  async upsertWorkspaceProfile(profile: Partial<WorkspaceProfile> & { workspaceId: string }) {
    await this.initialize();

    const now = new Date().toISOString();

    await this.getClient().execute({
      sql: `INSERT INTO workspace_profiles (workspace_id, package_manager, test_framework, test_command, lint_command, build_command, typecheck_command, shell, flags, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              package_manager = COALESCE(excluded.package_manager, package_manager),
              test_framework = COALESCE(excluded.test_framework, test_framework),
              test_command = COALESCE(excluded.test_command, test_command),
              lint_command = COALESCE(excluded.lint_command, lint_command),
              build_command = COALESCE(excluded.build_command, build_command),
              typecheck_command = COALESCE(excluded.typecheck_command, typecheck_command),
              shell = COALESCE(excluded.shell, shell),
              flags = COALESCE(excluded.flags, flags),
              updated_at = excluded.updated_at`,
      args: [
        profile.workspaceId,
        profile.packageManager ?? null,
        profile.testFramework ?? null,
        profile.testCommand ?? null,
        profile.lintCommand ?? null,
        profile.buildCommand ?? null,
        profile.typecheckCommand ?? null,
        profile.shell ?? null,
        profile.flags ?? null,
        now,
      ],
    });
  }

  async addValidationRun(run: Omit<ValidationRun, 'id' | 'ranAt'>): Promise<ValidationRun> {
    await this.initialize();

    const now = new Date().toISOString();
    const id = createId('val');
    const failingTestsStr = run.failingTests ? JSON.stringify(run.failingTests) : null;

    await this.getClient().execute({
      sql: `INSERT INTO validation_runs (id, workspace_id, command, scope, exit_code, status, output_summary, failing_tests, ran_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        run.workspaceId,
        run.command,
        run.scope ?? null,
        run.exitCode ?? null,
        run.status ?? null,
        run.outputSummary ?? null,
        failingTestsStr,
        now
      ],
    });

    return {
      ...run,
      id,
      ranAt: now,
    };
  }

  async getRecentValidationRuns(workspaceId: string, limit = 10): Promise<ValidationRun[]> {
    await this.initialize();
    const result = await this.getClient().execute({
      sql: `SELECT id, workspace_id, command, scope, exit_code, status, output_summary, failing_tests, ran_at
            FROM validation_runs
            WHERE workspace_id = ?
            ORDER BY datetime(ran_at) DESC LIMIT ?`,
      args: [workspaceId, limit],
    });

    return result.rows.map(row => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      command: String(row.command),
      scope: row.scope ? String(row.scope) : undefined,
      exitCode: row.exit_code !== null ? Number(row.exit_code) : undefined,
      status: row.status ? String(row.status) : undefined,
      outputSummary: row.output_summary ? String(row.output_summary) : undefined,
      failingTests: row.failing_tests ? safeParseFailingTests(String(row.failing_tests)) : undefined,
      ranAt: String(row.ran_at),
    }));
  }

  // ── Repo Graph ──────────────────────────────────────────────────────────

  async replaceRepoGraph(
    workspaceId: string,
    nodes: RepoGraphNode[],
    edges: RepoGraphEdge[],
  ): Promise<RepoGraphSnapshot> {
    await this.initialize();
    const indexedAt = new Date().toISOString();
    const statements = [
      { sql: `DELETE FROM repo_graph_edges WHERE workspace_id = ?`, args: [workspaceId] },
      { sql: `DELETE FROM repo_graph_nodes WHERE workspace_id = ?`, args: [workspaceId] },
      ...nodes.map((node) => ({
        sql: `INSERT INTO repo_graph_nodes (id, workspace_id, kind, key, label, metadata_json, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          node.id,
          workspaceId,
          node.kind,
          node.key,
          node.label,
          node.metadata ? JSON.stringify(node.metadata) : null,
          indexedAt,
        ],
      })),
      ...edges.map((edge) => ({
        sql: `INSERT INTO repo_graph_edges (id, workspace_id, kind, from_node_id, to_node_id, metadata_json, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          edge.id,
          workspaceId,
          edge.kind,
          edge.fromNodeId,
          edge.toNodeId,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          indexedAt,
        ],
      })),
      {
        sql: `INSERT INTO repo_graph_snapshots (workspace_id, indexed_at, node_count, edge_count)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(workspace_id) DO UPDATE SET
                indexed_at = excluded.indexed_at,
                node_count = excluded.node_count,
                edge_count = excluded.edge_count`,
        args: [workspaceId, indexedAt, nodes.length, edges.length],
      },
    ];

    await this.getClient().batch(statements, 'write');

    return {
      workspaceId,
      indexedAt,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  async getRepoGraphSnapshot(workspaceId: string): Promise<RepoGraphSnapshot | null> {
    await this.initialize();
    const result = await this.getClient().execute({
      sql: `SELECT workspace_id, indexed_at, node_count, edge_count
            FROM repo_graph_snapshots
            WHERE workspace_id = ?
            LIMIT 1`,
      args: [workspaceId],
    });
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      workspaceId: String(row.workspace_id),
      indexedAt: String(row.indexed_at),
      nodeCount: Number(row.node_count),
      edgeCount: Number(row.edge_count),
    };
  }

  async getRepoGraphNodes(workspaceId: string, kinds?: string[]): Promise<RepoGraphNode[]> {
    await this.initialize();
    const whereKinds = kinds?.length
      ? `AND kind IN (${kinds.map(() => '?').join(', ')})`
      : '';
    const result = await this.getClient().execute({
      sql: `SELECT id, workspace_id, kind, key, label, metadata_json, updated_at
            FROM repo_graph_nodes
            WHERE workspace_id = ? ${whereKinds}
            ORDER BY kind, key`,
      args: [workspaceId, ...(kinds ?? [])],
    });

    return result.rows.map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      kind: String(row.kind) as RepoGraphNode['kind'],
      key: String(row.key),
      label: String(row.label),
      metadata: row.metadata_json
        ? safeParseRecord(String(row.metadata_json))
        : undefined,
      updatedAt: String(row.updated_at),
    }));
  }

  async getRepoGraphEdges(workspaceId: string, kinds?: string[]): Promise<RepoGraphEdge[]> {
    await this.initialize();
    const whereKinds = kinds?.length
      ? `AND kind IN (${kinds.map(() => '?').join(', ')})`
      : '';
    const result = await this.getClient().execute({
      sql: `SELECT id, workspace_id, kind, from_node_id, to_node_id, metadata_json, updated_at
            FROM repo_graph_edges
            WHERE workspace_id = ? ${whereKinds}`,
      args: [workspaceId, ...(kinds ?? [])],
    });

    return result.rows.map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      kind: String(row.kind) as RepoGraphEdge['kind'],
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      metadata: row.metadata_json
        ? safeParseRecord(String(row.metadata_json))
        : undefined,
      updatedAt: String(row.updated_at),
    }));
  }

  // ── Workspace Trust Contracts ────────────────────────────────────────────

  async getWorkspaceTrustContract(workspaceId: string): Promise<WorkspaceTrustContract> {
    await this.initialize();
    await this.ensureWorkspaceTrustContract(workspaceId);
    const result = await this.getClient().execute({
      sql: `SELECT contract_json
            FROM workspace_trust_contracts
            WHERE workspace_id = ?
            LIMIT 1`,
      args: [workspaceId],
    });

    const raw = result.rows[0]?.contract_json;
    return safeParseTrustContract(String(raw ?? ''), workspaceId);
  }

  async setWorkspaceTrustContract(
    workspaceId: string,
    contract: WorkspaceTrustContract,
  ): Promise<WorkspaceTrustContract> {
    await this.initialize();
    const normalizedContract = normalizeWorkspaceTrustContract({
      ...contract,
      workspaceId,
      updatedAt: new Date().toISOString(),
    });

    await this.getClient().execute({
      sql: `INSERT INTO workspace_trust_contracts (workspace_id, contract_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
              contract_json = excluded.contract_json,
              updated_at = excluded.updated_at`,
      args: [
        workspaceId,
        JSON.stringify(normalizedContract),
        normalizedContract.updatedAt,
      ],
    });

    return normalizedContract;
  }

  // ── Session ──────────────────────────────────────────────────────────────

  private async ensureWorkspaceSession(workspaceId: string) {
    const existing = await this.getClient().execute({
      sql: `SELECT workspace_id FROM workspace_sessions WHERE workspace_id = ? LIMIT 1`,
      args: [workspaceId],
    });

    if (existing.rows[0]?.workspace_id) {
      return;
    }

    await this.getClient().execute({
      sql: `INSERT INTO workspace_sessions (workspace_id, active_thread_id, threads_json, updated_at)
            VALUES (?, ?, ?, ?)`,
      args: [workspaceId, null, DEFAULT_THREADS_JSON, new Date().toISOString()],
    });
  }

  private async ensureWorkspaceTrustContract(workspaceId: string) {
    const existing = await this.getClient().execute({
      sql: `SELECT workspace_id FROM workspace_trust_contracts WHERE workspace_id = ? LIMIT 1`,
      args: [workspaceId],
    });

    if (existing.rows[0]?.workspace_id) {
      return;
    }

    const workspace = (await this.getWorkspaces()).find((entry) => entry.id === workspaceId);
    const contract = createDefaultWorkspaceTrustContract(
      workspaceId,
      workspace?.name ?? 'Workspace',
    );

    await this.getClient().execute({
      sql: `INSERT INTO workspace_trust_contracts (workspace_id, contract_json, updated_at)
            VALUES (?, ?, ?)`,
      args: [workspaceId, JSON.stringify(contract), contract.updatedAt],
    });
  }

  private async getAppStateValue(key: string): Promise<string | null> {
    await this.initialize();
    const result = await this.getClient().execute({
      sql: `SELECT value FROM app_state WHERE key = ? LIMIT 1`,
      args: [key],
    });
    const raw = result.rows[0]?.value;
    return raw ? String(raw) : null;
  }
}

function safeParseThreads(raw: string): Conversation[] {
  try {
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseFailingTests(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function safeParseTrustContract(raw: string, workspaceId: string): WorkspaceTrustContract {
  try {
    const parsed = JSON.parse(raw) as WorkspaceTrustContract;
    if (parsed && parsed.workspaceId === workspaceId) {
      return normalizeWorkspaceTrustContract(parsed);
    }
  } catch {
    // Fall through to a conservative default contract.
  }

  return createDefaultWorkspaceTrustContract(workspaceId, 'Workspace');
}

function normalizeAppSettings(input: Partial<AppSettings>): AppSettings {
  return {
    theme:
      input.theme === 'dark' || input.theme === 'light' || input.theme === 'system'
        ? input.theme
        : DEFAULT_APP_SETTINGS.theme,
    timeFormat:
      input.timeFormat === '12h' || input.timeFormat === '24h' || input.timeFormat === 'system'
        ? input.timeFormat
        : DEFAULT_APP_SETTINGS.timeFormat,
    agentTraceVersion:
      input.agentTraceVersion === 'v1' || input.agentTraceVersion === 'v2'
        ? input.agentTraceVersion
        : DEFAULT_APP_SETTINGS.agentTraceVersion,
    agentTraceV2InlineEvents:
      typeof input.agentTraceV2InlineEvents === 'boolean'
        ? input.agentTraceV2InlineEvents
        : DEFAULT_APP_SETTINGS.agentTraceV2InlineEvents,
    diffLineWrapping:
      typeof input.diffLineWrapping === 'boolean'
        ? input.diffLineWrapping
        : DEFAULT_APP_SETTINGS.diffLineWrapping,
    assistantOutput:
      typeof input.assistantOutput === 'boolean'
        ? input.assistantOutput
        : DEFAULT_APP_SETTINGS.assistantOutput,
    archiveConfirmation:
      typeof input.archiveConfirmation === 'boolean'
        ? input.archiveConfirmation
        : DEFAULT_APP_SETTINGS.archiveConfirmation,
    deleteConfirmation:
      typeof input.deleteConfirmation === 'boolean'
        ? input.deleteConfirmation
        : DEFAULT_APP_SETTINGS.deleteConfirmation,
    supermemoryApiKey:
      typeof input.supermemoryApiKey === 'string'
        ? input.supermemoryApiKey
        : DEFAULT_APP_SETTINGS.supermemoryApiKey,
  };
}

export const tursoService = new TursoService();
