import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";
import type { Socket } from "node:net";

import type { AssistantRunOptions } from "../contracts/chat";
import {
  MOBILE_BRIDGE_COMMAND_TYPES,
  MOBILE_BRIDGE_PROTOCOL_VERSION,
  type MobileAssistantRunRequest,
  type MobileBridgeCommandEnvelope,
  type MobileBridgeCommandResponse,
  type MobileBridgeDeviceSession,
  type MobileBridgePairingPayload,
  type MobileBridgePermissions,
  type MobilePendingPairingRequest,
  type MobileBridgeStatus,
  type MobilePairingApproval,
  type MobileWorkspaceEntry,
  type MobileWorkspaceSummary,
} from "../contracts/mobile-bridge";
import type { ResolvePolicyStopRequest } from "../contracts/policy";
import { policyService } from "./policy-service";
import { getWorkspaceEntries, getWorkspaceSummary, runAssistant } from "./repo-service";
import { repoGraphService, resolveActiveWorkspaceForRepoGraph } from "./repo-graph-service";
import { GitService } from "./git-service";
import { isPrivateLanAddress } from "./mobile-bridge-network";
import { tursoService } from "./turso-service";

const MAX_MESSAGE_BYTES = 64_000;
const MAX_PROMPT_LENGTH = 20_000;
const PAIRING_TTL_MS = 5 * 60_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 40;

interface ActivePairing {
  payload: MobileBridgePairingPayload;
  secretHash: string;
  attempts: number;
}

interface ClientConnection {
  socket: Socket;
  sessionId: string | null;
  buffer: Buffer;
}

interface PendingPairingApproval extends MobilePairingApproval {
  client: ClientConnection;
}

class MobileBridgeService {
  private server: ReturnType<typeof createServer> | null = null;
  private host: string | null = null;
  private port: number | null = null;
  private pairing: ActivePairing | null = null;
  private awaitingApproval: PendingPairingApproval | null = null;
  private sessions = new Map<string, MobileBridgeDeviceSession>();
  private sequences = new Map<string, number>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();
  private readonly desktopPublicKey = randomBytes(32).toString("base64url");

  async startPairing(): Promise<MobileBridgePairingPayload> {
    const settings = await tursoService.getAppSettings();
    if (!settings.mobileCompanionEnabled) {
      throw new Error("Mobile companion is disabled.");
    }

    await this.ensureServer(settings.mobileCompanionPrivateLanOnly);
    const pairingSecret = randomBytes(24).toString("base64url");
    const payload: MobileBridgePairingPayload = {
      version: MOBILE_BRIDGE_PROTOCOL_VERSION,
      host: this.host ?? "127.0.0.1",
      port: this.port ?? 0,
      pairingId: randomBytes(12).toString("base64url"),
      desktopPublicKey: this.desktopPublicKey,
      pairingSecret,
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    };

    this.pairing = {
      payload,
      secretHash: this.hashSecret(pairingSecret),
      attempts: 0,
    };
    this.awaitingApproval = null;
    this.audit("pairing_started", { pairingId: payload.pairingId, expiresAt: payload.expiresAt });
    return payload;
  }

  async stopPairing(): Promise<MobileBridgeStatus> {
    this.pairing = null;
    this.awaitingApproval = null;
    this.audit("bridge_stopped", {});
    return this.getStatus();
  }

  async getStatus(): Promise<MobileBridgeStatus> {
    const settings = await tursoService.getAppSettings();
    this.expirePairing();
    this.expireSessions();
    return {
      enabled: settings.mobileCompanionEnabled,
      running: this.server !== null,
      host: this.host,
      port: this.port,
      pairingState: this.awaitingApproval ? "awaiting_approval" : this.pairing ? "pairing" : "idle",
      pairingExpiresAt: this.pairing?.payload.expiresAt ?? null,
      activeSessionCount: [...this.sessions.values()].filter((session) => session.state === "active").length,
      requireApproval: settings.mobileCompanionRequireApproval,
      privateLanOnly: settings.mobileCompanionPrivateLanOnly,
    };
  }

  getPendingPairing(): MobilePendingPairingRequest | null {
    this.expirePairing();
    if (!this.pairing || !this.awaitingApproval) return null;
    return {
      pairingId: this.awaitingApproval.pairingId,
      deviceName: this.awaitingApproval.deviceName,
      deviceFingerprint: this.fingerprint(this.awaitingApproval.devicePublicKey),
      expiresAt: this.pairing.payload.expiresAt,
    };
  }

  async approvePendingPairing(approved: boolean): Promise<MobileBridgeDeviceSession | null> {
    if (!this.awaitingApproval) return null;
    return this.approvePairing({
      pairingId: this.awaitingApproval.pairingId,
      deviceName: this.awaitingApproval.deviceName,
      devicePublicKey: this.awaitingApproval.devicePublicKey,
      approved,
    });
  }

  listDevices(): MobileBridgeDeviceSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session, devicePublicKey: this.fingerprint(session.devicePublicKey) }));
  }

  revokeDevice(deviceId: string): MobileBridgeDeviceSession[] {
    const session = this.sessions.get(deviceId);
    if (session) {
      session.state = "revoked";
      this.audit("session_revoked", { sessionId: deviceId, deviceName: session.deviceName });
    }
    return this.listDevices();
  }

  async approvePairing(approval: MobilePairingApproval): Promise<MobileBridgeDeviceSession> {
    this.expirePairing();
    if (!this.pairing || this.pairing.payload.pairingId !== approval.pairingId) {
      throw new Error("No active pairing request.");
    }
    const pending = this.awaitingApproval;
    if (!pending || pending.pairingId !== approval.pairingId) {
      throw new Error("No pending device approval.");
    }
    if (!approval.approved) {
      this.send(pending.client, { id: "handshake", ok: false, error: { code: "PAIRING_DENIED", message: "Pairing denied." } });
      this.pairing = null;
      this.awaitingApproval = null;
      throw new Error("Pairing denied.");
    }
    const session = await this.createSession(approval.deviceName, approval.devicePublicKey);
    pending.client.sessionId = session.id;
    this.send(pending.client, { id: "handshake", ok: true, payload: { sessionId: session.id, expiresAt: session.expiresAt, permissions: session.permissions } });
    this.pairing = null;
    this.awaitingApproval = null;
    this.audit("pairing_approved", { sessionId: session.id, deviceName: session.deviceName });
    this.audit("session_created", { sessionId: session.id, deviceName: session.deviceName });
    return session;
  }

  private async ensureServer(privateLanOnly: boolean) {
    if (this.server) return;
    this.host = this.resolveLanHost(privateLanOnly);
    this.server = createServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    this.server.on("upgrade", (req, socket) => void this.handleUpgrade(req, socket as Socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, this.host ?? "127.0.0.1", () => {
        const address = this.server?.address();
        this.port = typeof address === "object" && address ? address.port : null;
        resolve();
      });
    });
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket) {
    if (req.url !== "/mobile-bridge") {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")}`,
      "",
      "",
    ].join("\r\n"));
    const client: ClientConnection = { socket, sessionId: null, buffer: Buffer.alloc(0) };
    socket.on("data", (chunk) => this.handleSocketData(client, chunk));
    socket.on("error", () => socket.destroy());
  }

  private handleSocketData(client: ClientConnection, chunk: Buffer) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const frame = this.readFrame(client.buffer);
      if (!frame) return;
      client.buffer = client.buffer.subarray(frame.bytes);
      void this.handleRawMessage(client, frame.payload.toString("utf8"));
    }
  }

  private async handleRawMessage(client: ClientConnection, raw: string) {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
      this.send(client, { id: "unknown", ok: false, error: { code: "MESSAGE_TOO_LARGE", message: "Message too large." } });
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(client, { id: "unknown", ok: false, error: { code: "INVALID_JSON", message: "Invalid JSON." } });
      return;
    }
    if (this.isHandshake(message)) {
      await this.handleHandshake(client, message);
      return;
    }
    if (!this.isEnvelope(message)) {
      this.send(client, { id: "unknown", ok: false, error: { code: "INVALID_COMMAND", message: "Invalid command envelope." } });
      return;
    }
    await this.handleCommand(client, message);
  }

  private async handleHandshake(client: ClientConnection, message: { type: "pairing:handshake"; pairingId: string; pairingSecret: string; deviceName: string; devicePublicKey: string }) {
    this.expirePairing();
    if (!this.pairing || this.pairing.payload.pairingId !== message.pairingId) {
      this.send(client, { id: "handshake", ok: false, error: { code: "PAIRING_EXPIRED", message: "Pairing expired." } });
      return;
    }
    this.pairing.attempts += 1;
    if (this.pairing.attempts > 5 || !this.safeEqual(this.pairing.secretHash, this.hashSecret(message.pairingSecret))) {
      this.audit("command_denied", { reason: "bad_pairing_secret", pairingId: message.pairingId });
      this.send(client, { id: "handshake", ok: false, error: { code: "PAIRING_DENIED", message: "Pairing denied." } });
      return;
    }
    const settings = await tursoService.getAppSettings();
    if (settings.mobileCompanionRequireApproval) {
      this.awaitingApproval = { pairingId: message.pairingId, deviceName: this.boundString(message.deviceName, 80), devicePublicKey: this.boundString(message.devicePublicKey, 500), approved: true, client };
      this.send(client, { id: "handshake", ok: false, error: { code: "AWAITING_DESKTOP_APPROVAL", message: "Desktop approval required." } });
      return;
    }
    const session = await this.createSession(message.deviceName, message.devicePublicKey);
    client.sessionId = session.id;
    this.pairing = null;
    this.send(client, { id: "handshake", ok: true, payload: { sessionId: session.id, expiresAt: session.expiresAt, permissions: session.permissions } });
  }

  private async handleCommand(client: ClientConnection, envelope: MobileBridgeCommandEnvelope) {
    const session = this.sessions.get(envelope.sessionId);
    if (!session || session.state !== "active" || new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sendDenied(client, envelope.id, "SESSION_INVALID", "Session invalid.");
      return;
    }
    if (!this.consumeRateLimit(session.id)) {
      this.sendDenied(client, envelope.id, "RATE_LIMITED", "Rate limited.");
      return;
    }
    const lastSequence = this.sequences.get(session.id) ?? 0;
    if (!Number.isInteger(envelope.sequence) || envelope.sequence <= lastSequence) {
      this.sendDenied(client, envelope.id, "REPLAY_DETECTED", "Sequence must increase.");
      return;
    }
    this.sequences.set(session.id, envelope.sequence);
    session.lastSeenAt = new Date().toISOString();
    this.audit("command_received", { sessionId: session.id, type: envelope.type });
    try {
      this.send(client, { id: envelope.id, ok: true, payload: await this.routeCommand(session, envelope, client) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed.";
      this.audit("command_denied", { sessionId: session.id, type: envelope.type, reason: message });
      this.send(client, { id: envelope.id, ok: false, error: { code: "COMMAND_FAILED", message } });
    }
  }

  private async routeCommand(session: MobileBridgeDeviceSession, envelope: MobileBridgeCommandEnvelope, client: ClientConnection) {
    switch (envelope.type) {
      case "bridge:get-status":
        return this.getStatus();
      case "workspace:list":
        return (await getWorkspaceEntries()).map(this.toMobileWorkspaceEntry);
      case "workspace:get-active-summary":
        return this.toMobileWorkspaceSummary(await getWorkspaceSummary());
      case "git:get-status": {
        if (!session.permissions.canReadGit) throw new Error("Git read not allowed.");
        const workspace = await resolveActiveWorkspaceForRepoGraph();
        const status = await new GitService(workspace.path).getStatus();
        void repoGraphService.noteGitStatusChanged(workspace);
        return status;
      }
      case "git:get-diff": {
        if (!session.permissions.canReadGit) throw new Error("Git read not allowed.");
        const workspace = await resolveActiveWorkspaceForRepoGraph();
        return new GitService(workspace.path).getDiff();
      }
      case "assistant:run":
        if (!session.permissions.canRunAssistant) throw new Error("Assistant run not allowed.");
        return this.runAssistantFromMobile(envelope.payload, client, envelope.id);
      case "policy:list-stops":
        if (!session.permissions.canResolvePolicyStops) throw new Error("Policy access not allowed.");
        return policyService.listStops(typeof envelope.payload === "string" ? envelope.payload : undefined);
      case "policy:resolve-stop":
        if (!session.permissions.canResolvePolicyStops) throw new Error("Policy resolution not allowed.");
        this.audit("policy_stop_resolved", { sessionId: session.id });
        return policyService.resolveStop(envelope.payload as ResolvePolicyStopRequest);
      case "git:stage":
      case "git:commit":
      case "git:push":
        throw new Error("Git write commands are not implemented in mobile bridge.");
    }
  }

  private async runAssistantFromMobile(payload: unknown, client: ClientConnection, commandId: string) {
    const request = this.validateAssistantRunRequest(payload);
    this.audit("assistant_run_started", { runId: request.runId, promptLength: request.prompt.length, promptPreview: request.prompt.slice(0, 120) });
    const options = this.validateAssistantOptions(request.options);
    return runAssistant(
      request.prompt,
      request.history ?? [],
      request.workspaceId,
      options,
      request.runId
        ? {
            runId: request.runId,
            emit: (progress) => this.send(client, { id: commandId, ok: true, payload: { type: "assistant:progress", progress } }),
          }
        : undefined,
    );
  }

  private validateAssistantRunRequest(payload: unknown): MobileAssistantRunRequest {
    const value = this.requireRecord(payload);
    return {
      prompt: this.boundString(value.prompt, MAX_PROMPT_LENGTH),
      history: Array.isArray(value.history) ? value.history.map((item) => this.boundString(item, MAX_PROMPT_LENGTH)).slice(0, 20) : [],
      workspaceId: typeof value.workspaceId === "string" ? this.boundString(value.workspaceId, 200) : undefined,
      runId: typeof value.runId === "string" ? this.boundString(value.runId, 200) : undefined,
      options: this.validateAssistantOptions(value.options),
    };
  }

  private validateAssistantOptions(value: unknown): AssistantRunOptions {
    const defaults: AssistantRunOptions = {
      reasoningEnabled: true,
      reasoning: "medium",
      mode: "build",
      access: "approval",
    };
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const input = value as Record<string, unknown>;
    return {
      ...defaults,
      mode: input.mode === "plan" || input.mode === "critic_loop" || input.mode === "build" ? input.mode : defaults.mode,
      access: "approval",
      reasoningEnabled: typeof input.reasoningEnabled === "boolean" ? input.reasoningEnabled : defaults.reasoningEnabled,
      runbookId: typeof input.runbookId === "string" ? input.runbookId as AssistantRunOptions["runbookId"] : defaults.runbookId,
    };
  }

  private async createSession(deviceName: string, devicePublicKey: string): Promise<MobileBridgeDeviceSession> {
    const settings = await tursoService.getAppSettings();
    const ttl = Math.min(168, Math.max(1, settings.mobileCompanionSessionTtlHours));
    const now = Date.now();
    const session: MobileBridgeDeviceSession = {
      id: randomBytes(18).toString("base64url"),
      deviceName: this.boundString(deviceName, 80),
      devicePublicKey: this.boundString(devicePublicKey, 500),
      permissions: this.defaultPermissions(settings.mobileCompanionAllowGitWrite, settings.mobileCompanionAllowPush),
      state: "active",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 60 * 60_000).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private defaultPermissions(allowGitWrite: boolean, allowPush: boolean): MobileBridgePermissions {
    return {
      canRunAssistant: true,
      canResolvePolicyStops: true,
      canReadGit: true,
      canWriteGit: allowGitWrite,
      canPush: allowGitWrite && allowPush,
    };
  }

  private toMobileWorkspaceEntry(workspace: Awaited<ReturnType<typeof getWorkspaceEntries>>[number]): MobileWorkspaceEntry {
    return {
      id: workspace.id,
      name: workspace.name,
      lastOpenedAt: workspace.lastOpenedAt,
    };
  }

  private toMobileWorkspaceSummary(workspace: Awaited<ReturnType<typeof getWorkspaceSummary>>): MobileWorkspaceSummary {
    return {
      id: workspace.id,
      name: workspace.name,
      branch: workspace.branch,
      status: workspace.status,
      stack: workspace.stack,
      facts: workspace.facts.slice(0, 20),
    };
  }

  private readFrame(buffer: Buffer): { payload: Buffer; bytes: number } | null {
    const second = buffer[1];
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      throw new Error("Large WebSocket frames are unsupported.");
    }
    const masked = (second & 0x80) !== 0;
    const maskOffset = masked ? 4 : 0;
    if (buffer.length < offset + maskOffset + length) return null;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += maskOffset;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    return { payload, bytes: offset + length };
  }

  private send(client: ClientConnection, response: MobileBridgeCommandResponse) {
    const payload = Buffer.from(JSON.stringify(response));
    const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    client.socket.write(Buffer.concat([header, payload]));
  }

  private sendDenied(client: ClientConnection, id: string, code: string, message: string) {
    this.audit("command_denied", { code, message });
    this.send(client, { id, ok: false, error: { code, message } });
  }

  private isHandshake(value: unknown): value is { type: "pairing:handshake"; pairingId: string; pairingSecret: string; deviceName: string; devicePublicKey: string } {
    const record = value as Record<string, unknown>;
    return record?.type === "pairing:handshake" && ["pairingId", "pairingSecret", "deviceName", "devicePublicKey"].every((key) => typeof record[key] === "string");
  }

  private isEnvelope(value: unknown): value is MobileBridgeCommandEnvelope {
    const record = value as Record<string, unknown>;
    return Boolean(record && typeof record.id === "string" && typeof record.sessionId === "string" && Number.isInteger(record.sequence) && MOBILE_BRIDGE_COMMAND_TYPES.includes(record.type as never));
  }

  private requireRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Payload must be an object.");
    return value as Record<string, unknown>;
  }

  private boundString(value: unknown, maxLength: number) {
    if (typeof value !== "string") throw new Error("Expected string.");
    if (value.length > maxLength) throw new Error("String too long.");
    return value;
  }

  private consumeRateLimit(sessionId: string) {
    const now = Date.now();
    const current = this.rateLimits.get(sessionId);
    if (!current || current.resetAt < now) {
      this.rateLimits.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT_MAX;
  }

  private expirePairing() {
    if (this.pairing && new Date(this.pairing.payload.expiresAt).getTime() <= Date.now()) {
      this.pairing = null;
      this.awaitingApproval = null;
    }
  }

  private expireSessions() {
    for (const session of this.sessions.values()) {
      if (session.state === "active" && new Date(session.expiresAt).getTime() <= Date.now()) session.state = "expired";
    }
  }

  private resolveLanHost(privateLanOnly: boolean) {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (
          entry.family === "IPv4" &&
          !entry.internal &&
          (!privateLanOnly || isPrivateLanAddress(entry.address))
        ) return entry.address;
      }
    }
    return "127.0.0.1";
  }

  private hashSecret(secret: string) {
    return createHash("sha256").update(secret).digest("hex");
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private fingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  private audit(event: string, details: Record<string, unknown>) {
    console.info("[mobile-bridge:audit]", JSON.stringify({ event, at: new Date().toISOString(), details }));
  }
}

export const mobileBridgeService = new MobileBridgeService();
