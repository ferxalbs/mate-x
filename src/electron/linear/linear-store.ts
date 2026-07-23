import { createClient, type Client } from "@libsql/client";
import type { LinearWebhookEnvelope } from "../../contracts/linear-integration";

export interface StoredLinearInstallation {
  organizationId: string;
  organizationName: string;
  appUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  state: string;
}

export interface LinearSessionBinding {
  sessionId: string;
  organizationId: string;
  issueId: string | null;
  workspaceId: string;
  engineeringTaskId: string;
  graphRunId: string;
}

export class LinearStore {
  private readonly client: Client;

  constructor(databaseUrl: string) {
    this.client = createClient({ url: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.client.batch([
      `CREATE TABLE IF NOT EXISTS linear_installations (organization_id TEXT PRIMARY KEY, organization_name TEXT NOT NULL, app_user_id TEXT NOT NULL, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expires_at TEXT NOT NULL, scopes_json TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS linear_session_bindings (session_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, issue_id TEXT, workspace_id TEXT NOT NULL, engineering_task_id TEXT NOT NULL UNIQUE, graph_run_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS linear_webhook_deliveries (delivery_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT, error TEXT)`,
      `CREATE TABLE IF NOT EXISTS linear_outbound_activities (activity_key TEXT PRIMARY KEY, session_id TEXT NOT NULL, content_json TEXT NOT NULL, ephemeral INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, delivered_at TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_linear_outbound_state ON linear_outbound_activities(state, created_at)`,
    ], "write");
  }

  async saveInstallation(value: StoredLinearInstallation): Promise<void> {
    await this.client.execute({ sql: `INSERT INTO linear_installations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id) DO UPDATE SET organization_name=excluded.organization_name, app_user_id=excluded.app_user_id, access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, scopes_json=excluded.scopes_json, state=excluded.state, updated_at=excluded.updated_at`, args: [value.organizationId, value.organizationName, value.appUserId, value.accessToken, value.refreshToken, value.expiresAt, JSON.stringify(value.scopes), value.state, new Date().toISOString()] });
  }

  async getInstallation(organizationId: string): Promise<StoredLinearInstallation | null> {
    const row = (await this.client.execute({ sql: `SELECT * FROM linear_installations WHERE organization_id=?`, args: [organizationId] })).rows[0];
    return row ? { organizationId: String(row.organization_id), organizationName: String(row.organization_name), appUserId: String(row.app_user_id), accessToken: String(row.access_token), refreshToken: String(row.refresh_token), expiresAt: String(row.expires_at), scopes: JSON.parse(String(row.scopes_json)) as string[], state: String(row.state) } : null;
  }

  async firstInstallation(): Promise<StoredLinearInstallation | null> {
    const row = (await this.client.execute(`SELECT organization_id FROM linear_installations ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    return row ? this.getInstallation(String(row.organization_id)) : null;
  }

  async setInstallationState(organizationId: string, state: string, scopes?: string[]): Promise<void> {
    await this.client.execute({ sql: `UPDATE linear_installations SET state=?, scopes_json=COALESCE(?, scopes_json), updated_at=? WHERE organization_id=?`, args: [state, scopes ? JSON.stringify(scopes) : null, new Date().toISOString(), organizationId] });
  }

  async deleteInstallation(organizationId: string): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM linear_installations WHERE organization_id=?`, args: [organizationId] });
  }

  async persistDelivery(envelope: LinearWebhookEnvelope): Promise<boolean> {
    const result = await this.client.execute({ sql: `INSERT OR IGNORE INTO linear_webhook_deliveries(delivery_id,payload_json,received_at) VALUES(?,?,?)`, args: [envelope.deliveryId, JSON.stringify(envelope.payload), envelope.receivedAt] });
    return result.rowsAffected === 1;
  }

  async pendingDeliveries(): Promise<LinearWebhookEnvelope[]> {
    const rows = (await this.client.execute(`SELECT delivery_id,payload_json,received_at FROM linear_webhook_deliveries WHERE processed_at IS NULL ORDER BY received_at`)).rows;
    return rows.map((row) => ({ deliveryId: String(row.delivery_id), receivedAt: String(row.received_at), payload: JSON.parse(String(row.payload_json)) as Record<string, unknown> }));
  }

  async markDeliveryProcessed(deliveryId: string, error: string | null = null): Promise<void> {
    await this.client.execute({ sql: `UPDATE linear_webhook_deliveries SET processed_at=?,error=? WHERE delivery_id=?`, args: [new Date().toISOString(), error, deliveryId] });
  }

  async markDeliveryFailed(deliveryId: string, error: string): Promise<void> {
    await this.client.execute({ sql: `UPDATE linear_webhook_deliveries SET error=? WHERE delivery_id=?`, args: [error.slice(0, 1000), deliveryId] });
  }

  async isDeliveryPending(deliveryId: string): Promise<boolean> {
    const row = (await this.client.execute({ sql: `SELECT processed_at FROM linear_webhook_deliveries WHERE delivery_id=?`, args: [deliveryId] })).rows[0];
    return Boolean(row && row.processed_at === null);
  }

  async getBinding(sessionId: string): Promise<LinearSessionBinding | null> {
    const row = (await this.client.execute({ sql: `SELECT * FROM linear_session_bindings WHERE session_id=?`, args: [sessionId] })).rows[0];
    return row ? { sessionId: String(row.session_id), organizationId: String(row.organization_id), issueId: row.issue_id ? String(row.issue_id) : null, workspaceId: String(row.workspace_id), engineeringTaskId: String(row.engineering_task_id), graphRunId: String(row.graph_run_id) } : null;
  }

  async getBindingByRun(graphRunId: string): Promise<LinearSessionBinding | null> {
    const row = (await this.client.execute({ sql: `SELECT session_id FROM linear_session_bindings WHERE graph_run_id=?`, args: [graphRunId] })).rows[0];
    return row ? this.getBinding(String(row.session_id)) : null;
  }

  async bindSession(binding: LinearSessionBinding): Promise<LinearSessionBinding> {
    await this.client.execute({ sql: `INSERT OR IGNORE INTO linear_session_bindings VALUES(?,?,?,?,?,?,?,?)`, args: [binding.sessionId, binding.organizationId, binding.issueId, binding.workspaceId, binding.engineeringTaskId, binding.graphRunId, new Date().toISOString(), new Date().toISOString()] });
    return (await this.getBinding(binding.sessionId))!;
  }

  async enqueueActivity(input: { activityKey: string; sessionId: string; content: unknown; ephemeral?: boolean }): Promise<void> {
    await this.client.execute({ sql: `INSERT OR IGNORE INTO linear_outbound_activities(activity_key,session_id,content_json,ephemeral,state,created_at) VALUES(?,?,?,?,?,?)`, args: [input.activityKey, input.sessionId, JSON.stringify(input.content), input.ephemeral ? 1 : 0, "pending", new Date().toISOString()] });
  }

  async pendingActivities(): Promise<Array<{ activityKey: string; sessionId: string; content: Record<string, unknown>; ephemeral: boolean }>> {
    const rows = (await this.client.execute(`SELECT activity_key,session_id,content_json,ephemeral FROM linear_outbound_activities WHERE state='pending' ORDER BY created_at`)).rows;
    return rows.map((row) => ({ activityKey: String(row.activity_key), sessionId: String(row.session_id), content: JSON.parse(String(row.content_json)) as Record<string, unknown>, ephemeral: Number(row.ephemeral) === 1 }));
  }

  async markActivityDelivered(key: string): Promise<void> {
    await this.client.execute({ sql: `UPDATE linear_outbound_activities SET state='delivered',delivered_at=?,attempts=attempts+1,last_error=NULL WHERE activity_key=?`, args: [new Date().toISOString(), key] });
  }

  async markActivityFailed(key: string, error: string): Promise<void> {
    await this.client.execute({ sql: `UPDATE linear_outbound_activities SET attempts=attempts+1,last_error=? WHERE activity_key=?`, args: [error.slice(0, 1000), key] });
  }
}
