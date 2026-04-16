import { app } from 'electron';
import { createClient, type Client } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Conversation } from '../contracts/chat';
import type { WorkspaceEntry } from '../contracts/workspace';
import { createId } from '../lib/id';

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
}

function safeParseThreads(raw: string): Conversation[] {
  try {
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const tursoService = new TursoService();
