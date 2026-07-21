import { afterEach, describe, expect as rawExpect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { LinearWebhookClient } from "@linear/sdk/webhooks";
import { EngineeringCommandBus } from "../engineering/command-bus";
import { InMemoryEngineeringRepository } from "../engineering/in-memory-repository";
import { LinearAgentService, type LinearAgentApi, type LinearRuntimeAuthority } from "./linear-agent-service";
import { createLinearOAuthAttempt, refreshLinearOAuthToken } from "./linear-oauth";
import { LinearStore } from "./linear-store";

// The repository's narrow global expect declaration intentionally exposes only
// two matchers; Bun provides the full runtime matcher set used in this focused suite.
const bunExpect = rawExpect as unknown as any;

const stores: LinearStore[] = [];
async function store(url = ":memory:") {
  const value = new LinearStore(url);
  await value.initialize();
  stores.push(value);
  await value.saveInstallation({ organizationId: "org", organizationName: "Acme", appUserId: "app", accessToken: "access", refreshToken: "refresh", expiresAt: new Date(Date.now() + 60_000).toISOString(), scopes: ["read", "write"], state: "connected" });
  return value;
}

function payload(action: "created" | "prompted", body = "Please fix it") {
  return { action, organizationId: "org", promptContext: "Issue context", agentSession: { id: "session", issue: { id: "issue", title: "Fix bug" } }, agentActivity: action === "prompted" ? { id: "prompt", body } : null };
}

function harness(linearStore: LinearStore, candidates = [{ workspaceId: "workspace", hostname: "github.com", repositoryFullName: "acme/app" }]) {
  const calls = { start: 0, resume: 0, cancel: 0, activities: [] as Record<string, unknown>[] };
  const runtime: LinearRuntimeAuthority = {
    start: async () => { calls.start += 1; },
    resume: async () => { calls.resume += 1; },
    cancel: async () => { calls.cancel += 1; },
  };
  const api: LinearAgentApi = {
    activity: async (_session, content) => { calls.activities.push(content); },
    repositorySuggestions: async () => candidates.map((candidate, index) => ({ ...candidate, confidence: index === 0 ? 0.91 : 0.4 })),
    externalUrls: async () => undefined,
  };
  return { calls, service: new LinearAgentService(linearStore, new EngineeringCommandBus(new InMemoryEngineeringRepository()), runtime, () => api, async () => candidates, (binding) => `matex://runs/${binding.graphRunId}`) };
}

describe("Linear webhook security", () => {
  it("verifies the raw body HMAC and rejects stale timestamps", () => {
    const raw = Buffer.from(JSON.stringify({ type: "AgentSessionEvent", webhookTimestamp: Date.now() }));
    const signature = createHmac("sha256", "secret").update(raw).digest("hex");
    const client = new LinearWebhookClient("secret");
    bunExpect(client.parseData(raw, signature)).toEqual(bunExpect.objectContaining({ type: "AgentSessionEvent" }));
    bunExpect(() => client.parseData(raw, "0".repeat(64))).toThrow();
    bunExpect(() => client.verify(raw, signature, Date.now() - 61_000)).toThrow("timestamp");
  });
});

describe("Linear OAuth PKCE and refresh", () => {
  it("uses S256, actor app, and the exact agent scopes", () => {
    const attempt = createLinearOAuthAttempt({ clientId: "client", redirectUri: "matex://linear/callback" });
    const url = new URL(attempt.authorizeUrl);
    bunExpect(url.searchParams.get("actor")).toBe("app");
    bunExpect(url.searchParams.get("code_challenge_method")).toBe("S256");
    bunExpect(url.searchParams.get("scope")).toBe("read,write,app:assignable,app:mentionable");
  });

  it("persists the rotated refresh token returned by Linear", async () => {
    const token = await refreshLinearOAuthToken({ refreshToken: "old", clientId: "client", fetchImpl: (async (_url, init) => {
      bunExpect(String(init?.body)).toContain("refresh_token=old");
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "read write", token_type: "Bearer" }));
    }) as typeof fetch });
    bunExpect(token.refresh_token).toBe("new-refresh");
  });
});

describe("Linear session authority and recovery", () => {
  it("deduplicates created delivery and maps prompted to the same task and run", async () => {
    const linearStore = await store();
    const { service, calls } = harness(linearStore);
    const envelope = { deliveryId: "one", receivedAt: new Date().toISOString(), payload: payload("created") };
    bunExpect(await service.acceptDelivery(envelope)).toBe(true);
    bunExpect(await service.acceptDelivery(envelope)).toBe(false);
    await service.acceptDelivery({ deliveryId: "two", receivedAt: new Date().toISOString(), payload: payload("prompted") });
    bunExpect(calls.start).toBe(1);
    bunExpect(calls.resume).toBe(1);
    bunExpect((await linearStore.getBinding("session"))?.engineeringTaskId).toMatch(/^etask_/);
  });

  it("emits select elicitation when repository confidence is ambiguous", async () => {
    const linearStore = await store();
    const candidates = [
      { workspaceId: "a", hostname: "github.com", repositoryFullName: "acme/a" },
      { workspaceId: "b", hostname: "github.com", repositoryFullName: "acme/b" },
    ];
    const { service, calls } = harness(linearStore, candidates);
    const api = (service as unknown as { apiFor: () => LinearAgentApi }).apiFor();
    api.repositorySuggestions = async () => candidates.map((candidate) => ({ ...candidate, confidence: 0.7 }));
    await service.acceptDelivery({ deliveryId: "ambiguous", receivedAt: new Date().toISOString(), payload: payload("created") });
    bunExpect(calls.start).toBe(0);
    bunExpect(calls.activities).toContainEqual(bunExpect.objectContaining({ type: "elicitation", subtype: "select" }));
  });

  it("cancels immediately and confirms a stop signal", async () => {
    const linearStore = await store();
    const { service, calls } = harness(linearStore);
    await service.acceptDelivery({ deliveryId: "create", receivedAt: new Date().toISOString(), payload: payload("created") });
    await service.acceptDelivery({ deliveryId: "stop", receivedAt: new Date().toISOString(), payload: payload("prompted", "stop") });
    bunExpect(calls.cancel).toBe(1);
    bunExpect(calls.activities.at(-1)).toEqual(bunExpect.objectContaining({ type: "response" }));
  });

  it("replays persisted deliveries and outbound activity after restart", async () => {
    const db = `file:${process.cwd()}/artifacts/linear-recovery-${crypto.randomUUID()}.sqlite`;
    const first = await store(db);
    await first.persistDelivery({ deliveryId: "offline", receivedAt: new Date().toISOString(), payload: payload("created") });
    const second = new LinearStore(db);
    await second.initialize();
    stores.push(second);
    const { service, calls } = harness(second);
    await service.recover();
    bunExpect(calls.start).toBe(1);
  });

  it("keeps activities pending when Linear API fails", async () => {
    const linearStore = await store();
    const { service } = harness(linearStore);
    await linearStore.enqueueActivity({ activityKey: "failed", sessionId: "unknown", content: { type: "error", body: "x" } });
    await bunExpect(service.flushActivities({ activity: async () => { throw new Error("offline"); }, repositorySuggestions: async () => [], externalUrls: async () => undefined })).resolves.toBeUndefined();
    bunExpect((await linearStore.pendingActivities()).map((item) => item.activityKey)).toContain("failed");
  });
});

afterEach(() => { stores.length = 0; });
