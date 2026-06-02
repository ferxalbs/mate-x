import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  CriticLoopExhaustedError,
  HighImpactApprovalError,
  PrivacySentinelBlockError,
  SDKOrchestrator,
} from "./sdk-orchestrator";
import type {
  AgentAction,
  AgentActionEvidenceEvent,
  AgentId,
  AgentSdkClient,
  AgentSdkResult,
} from "../../contracts/sdk-orchestrator.types";

describe("SDKOrchestrator", () => {
  it("scans privacy first and blocks without calling an SDK", async () => {
    const context = testContext({ secretCategories: ["api_key"] });
    const orchestrator = context.orchestrator();

    await assert.rejects(
      orchestrator.execute({ actionType: "review", payload: { token: "secret" }, agentId: "codex" }),
      PrivacySentinelBlockError,
    );

    assert.equal(context.clients.codex.calls.length, 0);
    assert.equal(context.events[0]?.type, "AGENT_ACTION_BLOCKED");
    assert.equal(context.failures[0]?.errorSignature, "codex:PRIVACY_BLOCK:api_key");
  });

  it("records pending and completed events with output hash and VTS", async () => {
    const context = testContext();
    context.clients.codex.results.push(successResult());
    const result = await context.orchestrator().execute({
      actionType: "review",
      payload: { ok: true },
      agentId: "codex",
    });

    assert.equal(result.vts, 1);
    assert.equal(context.events[0]?.type, "AGENT_ACTION_PENDING");
    assert.equal(context.events[1]?.type, "AGENT_ACTION_COMPLETED");
    assert.equal(typeof context.events[1]?.outputHash, "string");
  });

  it("records SDK failures with canonical Failure Memory signature", async () => {
    const context = testContext();
    const sdkError = new Error("provider failed") as Error & { code: string };
    sdkError.code = "SDK_DOWN";
    context.clients.cursor.errors.push(sdkError);

    await assert.rejects(
      context.orchestrator().execute({ actionType: "patch", payload: {}, agentId: "cursor" }),
      /provider failed/,
    );

    assert.equal(context.events.at(-1)?.type, "AGENT_ACTION_FAILED");
    assert.equal(context.failures[0]?.errorSignature, "cursor:patch:SDK_DOWN");
  });

  it("requires explicit confirmation for high-impact actions before SDK calls", async () => {
    const context = testContext({ approveHighImpact: false });
    context.clients.antigravity.results.push(successResult());

    await assert.rejects(
      context.orchestrator().execute({
        actionType: "delete",
        payload: { path: "important" },
        agentId: "antigravity",
        allowHighImpact: true,
      }),
      HighImpactApprovalError,
    );

    assert.equal(context.confirmed.length, 1);
    assert.equal(context.clients.antigravity.calls.length, 0);
  });

  it("retries low-VTS results and exhausts Critic Loop after max retries", async () => {
    const context = testContext({ config: { criticLoop: { minVTS: 0.9, maxRetries: 1 } } });
    context.clients.codex.results.push(lowVtsResult(), lowVtsResult());

    await assert.rejects(
      context.orchestrator().execute({ actionType: "review", payload: {}, agentId: "codex" }),
      CriticLoopExhaustedError,
    );

    assert.equal(context.clients.codex.calls.length, 2);
    assert.equal(context.events.at(-1)?.type, "CRITIC_LOOP_EXHAUSTED");
  });

  it("updates routing recommendations and auto-routes to the best agent", async () => {
    const context = testContext({ config: { routing: { autoRoute: true, routingWindowSize: 10 } } });
    const orchestrator = context.orchestrator();
    for (let i = 0; i < 10; i += 1) {
      context.clients.cursor.results.push(successResult());
      await orchestrator.execute({ actionType: "audit", payload: { i }, agentId: "cursor" });
    }

    assert.deepEqual(orchestrator.getRoutingRecommendations(), { audit: "cursor" });
    context.clients.cursor.results.push(successResult());
    await orchestrator.execute({ actionType: "audit", payload: { routed: true } });
    assert.equal(context.clients.cursor.calls.length, 11);
  });

  it("records timeouts with canonical TIMEOUT signature", async () => {
    const context = testContext({ config: { timeoutMs: 1 } });
    context.clients.codex.results.push(new Promise((resolve) => setTimeout(() => resolve(successResult()), 50)));

    await assert.rejects(
      context.orchestrator().execute({ actionType: "slow", payload: {}, agentId: "codex" }),
      /timed out/,
    );

    assert.equal(context.failures[0]?.errorSignature, "codex:slow:TIMEOUT");
  });
});

function testContext(options: {
  secretCategories?: string[];
  approveHighImpact?: boolean;
  config?: ConstructorParameters<typeof SDKOrchestrator>[0]["config"];
} = {}) {
  const clients = {
    codex: new MockClient("codex"),
    cursor: new MockClient("cursor"),
    antigravity: new MockClient("antigravity"),
  };
  const events: AgentActionEvidenceEvent[] = [];
  const failures: Array<{ errorSignature: string }> = [];
  const confirmed: AgentAction[] = [];
  return {
    clients,
    events,
    failures,
    confirmed,
    orchestrator: () => new SDKOrchestrator({
      workspaceId: "workspace-1",
      codexClient: clients.codex,
      cursorClient: clients.cursor,
      antigravityClient: clients.antigravity,
      privacySentinel: {
        scan: async () => ({
          hasSecrets: Boolean(options.secretCategories?.length),
          categories: options.secretCategories ?? [],
        }),
      },
      evidenceRecorder: {
        appendAgentActionEvent: async (event) => {
          events.push(event);
        },
      },
      failureMemory: {
        recordFailure: async (failure) => {
          failures.push({ errorSignature: failure.errorSignature });
        },
      },
      confirmHighImpact: async (action) => {
        confirmed.push(action);
        return options.approveHighImpact ?? true;
      },
      config: options.config,
      now: () => new Date("2026-05-31T10:00:00.000Z"),
    }),
  };
}

function successResult(): AgentSdkResult {
  return {
    output: { ok: true },
    tool_execution_events: [
      { toolName: "read", status: "success" },
      { toolName: "run_tests", status: "success" },
    ],
  };
}

function lowVtsResult(): AgentSdkResult {
  return {
    output: { weak: true },
    tool_execution_events: [
      { toolName: "read", status: "failed" },
      { toolName: "run_tests", status: "failed" },
    ],
  };
}

class MockClient implements AgentSdkClient {
  readonly calls: AgentAction[] = [];
  readonly results: Array<AgentSdkResult | Promise<AgentSdkResult>> = [];
  readonly errors: Error[] = [];

  constructor(readonly agentId: AgentId) {}

  async execute(action: AgentAction): Promise<AgentSdkResult> {
    this.calls.push(action);
    const error = this.errors.shift();
    if (error) throw error;
    const result = this.results.shift();
    return result ? await result : successResult();
  }
}
