import { safeStorage, shell } from 'electron';
import type { LinearIntegrationStatus, LinearConnectionState } from '../../contracts/linear-integration';
import { LinearStore, type StoredLinearInstallation } from './linear-store';
import { RainyLinearClient, type RainyLinearStatus } from './rainy-linear-client';

const LINEAR_CONNECTION_TIMEOUT_MS = 90_000;
const LINEAR_POLL_INITIAL_DELAY_MS = 500;
const LINEAR_POLL_MAX_DELAY_MS = 5_000;

export class LinearConnectionService {
  private pending = false;
  private relayConnected = false;
  private message: string | null = null;

  constructor(
    private readonly store: LinearStore,
    private readonly rainy: RainyLinearClient,
  ) {}

  setRelayConnected(value: boolean): void {
    this.relayConnected = value;
  }

  async begin(): Promise<void> {
    if (this.pending) return;

    this.pending = true;
    this.message = null;
    try {
      const authorizationUrl = await this.rainy.start();
      await shell.openExternal(authorizationUrl);
      await this.waitForInstallation();
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Linear could not complete that action.';
      throw error;
    } finally {
      this.pending = false;
    }
  }

  async revoke(): Promise<void> {
    await this.rainy.disconnect();
    const installation = await this.store.firstInstallation();
    if (installation) await this.store.deleteInstallation(installation.organizationId);
    this.message = null;
  }

  async status(): Promise<LinearIntegrationStatus> {
    try {
      const status = await this.rainy.status();
      return this.toIntegrationStatus(status);
    } catch (error) {
      return this.toIntegrationStatus({
        state: 'error',
        installationState: null,
        workspaceId: null,
        workspaceName: null,
        organizationName: null,
        scopes: [],
        message: error instanceof Error ? error.message : 'Linear status is unavailable. Try again.',
      });
    }
  }

  /**
   * Legacy runtime compatibility: new installations are managed by Rainy and
   * never place OAuth tokens in this store. Existing local runtime bindings
   * can still read their already-encrypted token until they are reconnected.
   */
  async accessToken(organizationId: string): Promise<string> {
    const installation = await this.store.getInstallation(organizationId);
    if (!installation || installation.state !== 'connected') {
      throw new Error('Linear installation is not connected');
    }
    if (Date.parse(installation.expiresAt) <= Date.now() + 60_000) {
      throw new Error('Linear installation needs to be reconnected in Settings.');
    }
    return this.decrypt(installation.accessToken);
  }

  decryptInstallation(value: StoredLinearInstallation): StoredLinearInstallation {
    return {
      ...value,
      accessToken: this.decrypt(value.accessToken),
      refreshToken: this.decrypt(value.refreshToken),
    };
  }

  private async waitForInstallation(): Promise<void> {
    const deadline = Date.now() + LINEAR_CONNECTION_TIMEOUT_MS;
    let delay = LINEAR_POLL_INITIAL_DELAY_MS;
    let lastStatus: LinearIntegrationStatus | null = null;

    while (Date.now() < deadline) {
      await sleep(delay);
      lastStatus = await this.status();
      if (lastStatus.state === 'connected' || lastStatus.state === 'permission_changed') return;
      if (lastStatus.state === 'error' || lastStatus.state === 'revoked') {
        throw new Error(lastStatus.message ?? 'Linear authorization did not complete. Try again.');
      }
      delay = Math.min(delay * 2, LINEAR_POLL_MAX_DELAY_MS);
    }

    throw new Error(
      lastStatus?.message ?? 'Linear authorization is still pending. Check Linear, then choose Retry.',
    );
  }

  private toIntegrationStatus(status: RainyLinearStatus): LinearIntegrationStatus {
    const state: LinearConnectionState = this.pending
      && status.state !== 'connected'
      && status.state !== 'permission_changed'
      ? 'connecting'
      : status.state;
    return {
      state,
      installationState: status.installationState,
      workspaceId: status.workspaceId,
      workspaceName: status.workspaceName,
      organizationName: status.organizationName,
      scopes: status.scopes,
      relayConnected: this.relayConnected,
      lastDeliveryAt: null,
      message: this.message ?? status.message,
    };
  }

  private decrypt(value: string): string {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
