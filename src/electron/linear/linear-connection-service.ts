import { safeStorage, shell } from "electron";
import { LinearClient } from "@linear/sdk";
import type { LinearIntegrationStatus, LinearOAuthConfiguration } from "../../contracts/linear-integration";
import { LINEAR_OAUTH_SCOPES } from "../../contracts/linear-integration";
import { createLinearOAuthAttempt, exchangeLinearOAuthCode, normalizeLinearScopes, refreshLinearOAuthToken } from "./linear-oauth";
import { LinearStore, type StoredLinearInstallation } from "./linear-store";

export class LinearConnectionService {
  private pending: { state: string; verifier: string } | null = null;
  private relayConnected = false;

  constructor(private readonly store: LinearStore, private readonly config: LinearOAuthConfiguration) {}

  setRelayConnected(value: boolean): void { this.relayConnected = value; }

  async begin(): Promise<void> {
    if (!this.config.clientId || !this.config.redirectUri) throw new Error("Linear OAuth is not configured for this MaTE X build");
    const attempt = createLinearOAuthAttempt(this.config);
    this.pending = { state: attempt.state, verifier: attempt.verifier };
    await shell.openExternal(attempt.authorizeUrl);
  }

  async complete(code: string, state: string): Promise<LinearIntegrationStatus> {
    if (!this.pending || state !== this.pending.state) throw new Error("Linear OAuth state did not match");
    const token = await exchangeLinearOAuthCode({ code, verifier: this.pending.verifier, config: this.config });
    this.pending = null;
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
    if (installation) await this.store.setInstallationState(installation.organizationId, "revoked");
  }

  async status(): Promise<LinearIntegrationStatus> {
    const installation = await this.store.firstInstallation();
    const scopes = installation?.scopes ?? [];
    const missing = LINEAR_OAUTH_SCOPES.filter((scope) => !scopes.includes(scope));
    return {
      state: !installation ? "disconnected" : missing.length > 0 && installation.state === "connected" ? "permission_changed" : installation.state as LinearIntegrationStatus["state"],
      organizationName: installation?.organizationName ?? null,
      scopes,
      relayConnected: this.relayConnected,
      lastDeliveryAt: null,
      message: missing.length > 0 ? `Missing permissions: ${missing.join(", ")}` : null,
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
