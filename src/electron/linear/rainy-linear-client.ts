import { RAINY_API_BASE_URL, RAINY_REQUEST_TIMEOUT_MS } from '../../config/rainy';
import type { LinearConnectionState } from '../../contracts/linear-integration';
import { randomUUID } from 'node:crypto';

export const RAINY_LINEAR_ENDPOINTS = {
  oauthStart: '/v1/integrations/linear/oauth/start',
  status: '/v1/integrations/linear/status',
  disconnect: '/v1/integrations/linear',
} as const;

export interface RainyLinearStatus {
  state: LinearConnectionState;
  installationState: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  organizationName: string | null;
  scopes: string[];
  message: string | null;
}

type FetchLike = typeof fetch;

export class RainyLinearClient {
  private readonly baseUrl = RAINY_API_BASE_URL.replace(/\/+$/, '');

  constructor(
    private readonly getApiKey: () => Promise<string | null>,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly deviceId = `matex-${randomUUID()}`,
  ) {}

  async start(): Promise<string> {
    const payload = await this.request(RAINY_LINEAR_ENDPOINTS.oauthStart, { method: 'GET' });
    const root = asRecord(payload);
    const value = firstString(asRecord(root?.data) ?? root, ['authorizationUrl', 'authorization_url', 'url']);
    if (!value || !isLinearAuthorizationUrl(value)) {
      throw new Error('Rainy returned an invalid Linear authorization URL. Try again.');
    }
    return value;
  }

  async status(): Promise<RainyLinearStatus> {
    const payload = await this.request(RAINY_LINEAR_ENDPOINTS.status, { method: 'GET' });
    return normalizeStatus(payload);
  }

  async disconnect(): Promise<void> {
    await this.request(RAINY_LINEAR_ENDPOINTS.disconnect, { method: 'DELETE' });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const apiKey = (await this.getApiKey())?.trim();
    if (!apiKey) throw new Error('Connect Rainy API in Settings → Connections first.');

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-MaTE-Device-ID': this.deviceId,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(RAINY_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error('Rainy could not be reached. Check your connection and try again.');
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Rainy API authentication failed. Update Settings → Connections and try again.');
      }
      if (response.status === 404) {
        throw new Error('Rainy does not have the Linear connection service enabled.');
      }
      throw new Error(`Rainy Linear request failed (${response.status}). Try again.`);
    }

    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new Error('Rainy returned an invalid Linear response. Try again.');
    }
  }
}

function normalizeStatus(payload: unknown): RainyLinearStatus {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? root;
  const installations = Array.isArray(data.installations)
    ? data.installations.map(asRecord).filter((value): value is Record<string, unknown> => value !== null)
    : [];
  const installation = asRecord(data.installation) ?? installations.find((value) => firstString(value, ['status', 'state']) === 'connected') ?? installations[0] ?? null;
  const workspace = asRecord(data.workspace) ?? asRecord(data.organization) ?? installation;
  const installationState = firstString(data, ['installationState', 'installation_state', 'status'])
    ?? firstString(installation, ['state', 'status']);
  const connected = firstBoolean(data, ['connected', 'isConnected', 'is_connected']);
  const rawState = firstString(data, ['state', 'connectionState', 'connection_state'])
    ?? installationState;
  const state = normalizeState(rawState, connected);
  const workspaceId = firstString(data, ['workspaceId', 'workspace_id', 'organizationId', 'organization_id', 'linear_organization_id'])
    ?? firstString(workspace, ['id']);
  const workspaceName = firstString(data, ['workspaceName', 'workspace_name', 'organizationName', 'organization_name', 'linear_organization_name'])
    ?? firstString(workspace, ['name']);

  return {
    state,
    installationState,
    workspaceId,
    workspaceName,
    organizationName: workspaceName,
    scopes: firstScopes(data),
    message: firstString(data, ['message', 'detail']),
  };
}

function normalizeState(value: string | null, connected: boolean | null): LinearConnectionState {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'connected' || normalized === 'permission_changed' || normalized === 'revoked' || normalized === 'error') {
    return normalized;
  }
  if (normalized === 'pending' || normalized === 'connecting' || normalized === 'authorization_pending') return 'connecting';
  if (connected === true) return 'connected';
  return 'disconnected';
}

function isLinearAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'linear.app';
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

function firstBoolean(record: Record<string, unknown> | null, keys: string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key];
  return null;
}

function firstScopes(record: Record<string, unknown> | null): string[] {
  if (!record) return [];
  const value = record.scopes ?? record.permissions ?? record.granted_scopes;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}
