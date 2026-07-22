import { safeStorage, shell } from "electron";
import { LinearClient } from "@linear/sdk";
import type { LinearIntegrationStatus, LinearOAuthConfiguration } from "../../contracts/linear-integration";
import { LINEAR_OAUTH_SCOPES } from "../../contracts/linear-integration";
import { createLinearOAuthAttempt, exchangeLinearOAuthCode, normalizeLinearScopes, refreshLinearOAuthToken, requireMatchingLinearOAuthState, revokeLinearOAuthToken } from "./linear-oauth";
import { createLinearDeveloperSetup, type LinearConfigurationSource } from "./linear-product-config";
import { LinearStore, type StoredLinearInstallation } from "./linear-store";

export class LinearConnectionService {
  private pending: { state: string; verifier: string } | null = null;
  private relayConnected = false;
  private message: string | null = null;

  constructor(
    private readonly store: LinearStore,
    private config: LinearOAuthConfiguration,
    private configurationSource: LinearConfigurationSource,
  ) {}

  setRelayConnected(value: boolean): void { this.relayConnected = value; }

  async begin(): Promise<void> {
    if (this.pending) return;
    if (!this.config.clientId || !this.config.redirectUri) {
      this.message = "Enter the Client ID from your Linear app to continue.";
      return;
    }
    const attempt = createLinearOAuthAttempt(this.config);
    this.pending = { state: attempt.state, verifier: attempt.verifier };
    this.message = null;
    try {
      await shell.openExternal(attempt.authorizeUrl);
    } catch {
      this.pending = null;
      this.message = "MaTE X could not open Linear. Try again.";
      throw new Error(this.message);
    }
  }

  async openDeveloperSetup(): Promise<void> {
    await shell.openExternal(createLinearDeveloperSetup().createAppUrl);
  }

  async saveClientIdAndBegin(clientId: string): Promise<void> {
    const normalized = clientId.trim();
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(normalized)) {
      this.message = "Enter a valid Linear Client ID.";
      throw new Error(this.message);
    }
    await this.store.saveClientId(normalized);
    this.config = { ...this.config, clientId: normalized };
    this.configurationSource = "local";
    await this.begin();
  }

  cancel(message = "Linear authorization was cancelled."): void {
    this.pending = null;
    this.message = message;
  }

  failCallback(message: string): void {
    this.pending = null;
    this.message = message;
  }

  async complete(code: string, state: string): Promise<LinearIntegrationStatus> {
    const pending = this.pending;
    try { requireMatchingLinearOAuthState(pending?.state ?? null, state); } catch (error) {
      this.message = error instanceof Error ? error.message : "Linear authorization could not be verified.";
      throw error;
    }
    const verifier = pending!.verifier;
    this.pending = null;
    const token = await exchangeLinearOAuthCode({ code, verifier, config: this.config });
    const client = new LinearClient({ accessToken: token.access_token });
    const [viewer, organization] = await Promise.all([client.viewer, client.organization]);
    await this.store.saveInstallation({
      organizationId: organization.id,
      organizationName: organization.name,
      appUserId: viewer.id,
      accessToken: this.encrypt(token.access_token),
      refreshToken: this.encrypt(token.refresh_token),
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: normalizeLinearScopes(token.scope),
      state: "connected",
    });
    this.message = null;
    return this.status();
  }

  async accessToken(organizationId: string): Promise<string> {
    const installation = await this.store.getInstallation(organizationId);
    if (!installation || installation.state !== "connected") throw new Error("Linear installation is not connected");
    if (Date.parse(installation.expiresAt) > Date.now() + 60_000) return this.decrypt(installation.accessToken);
    try {
      const token = await refreshLinearOAuthToken({ refreshToken: this.decrypt(installation.refreshToken), clientId: this.config.clientId });
      await this.store.saveInstallation({ ...installation, accessToken: this.encrypt(token.access_token), refreshToken: this.encrypt(token.refresh_token), expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), scopes: normalizeLinearScopes(token.scope), state: "connected" });
      return token.access_token;
    } catch (error) {
      await this.store.setInstallationState(organizationId, "error");
      throw error;
    }
  }

  async revoke(): Promise<void> {
    const installation = await this.store.firstInstallation();
    if (!installation) return;
    try {
      await revokeLinearOAuthToken({ token: this.decrypt(installation.refreshToken) });
    } catch {
      this.message = "Linear could not confirm revocation, but the local connection was removed.";
    } finally {
      await this.store.deleteInstallation(installation.organizationId);
    }
  }

  async status(): Promise<LinearIntegrationStatus> {
    const installation = await this.store.firstInstallation();
    const scopes = installation?.scopes ?? [];
    const missing = LINEAR_OAUTH_SCOPES.filter((scope) => !scopes.includes(scope));
    return {
      state: this.pending ? "connecting" : !installation ? "disconnected" : missing.length > 0 && installation.state === "connected" ? "permission_changed" : installation.state as LinearIntegrationStatus["state"],
      organizationName: installation?.organizationName ?? null,
      scopes,
      relayConnected: this.relayConnected,
      lastDeliveryAt: null,
      message: this.message ?? (missing.length > 0 ? `Missing permissions: ${missing.join(", ")}` : null),
      configurationSource: this.configurationSource,
      setup: createLinearDeveloperSetup(),
    };
  }

  decryptInstallation(value: StoredLinearInstallation): StoredLinearInstallation {
    return { ...value, accessToken: this.decrypt(value.accessToken), refreshToken: this.decrypt(value.refreshToken) };
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS credential encryption is unavailable");
    return safeStorage.encryptString(value).toString("base64");
  }
  private decrypt(value: string): string { return safeStorage.decryptString(Buffer.from(value, "base64")); }
}
