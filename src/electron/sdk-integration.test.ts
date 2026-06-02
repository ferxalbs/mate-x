import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  CriticLoopExhaustedError,
  PrivacySentinelBlockError,
  SDKExecutionError,
  SDKOrchestrator,
} from "./orchestration/sdk-orchestrator";
import type {
  AgentAction,
  AgentActionEvidenceEvent,
  AgentId,
  AgentSdkClient,
  AgentSdkResult,
} from "../contracts/sdk-orchestrator.types";

describe("Electron SDK integration pipeline", () => {
  it("privacy_sentinel_blocks_before_sdk_call", async () => {
    const context = createIntegrationContext({ secretCategories: ["api_key"] });

    await assert.rejects(
      context.orchestrator.execute({
        actionType: "review",
        payload: { token: "sk-test-fake-secret" },
        agentId: "codex",
      }),
      PrivacySentinelBlockError,
    );

    assert.equal(context.clients.codex.calls.length, 0);
    assert.equal(context.events[0]?.type, "AGENT_ACTION_BLOCKED");
    assert.equal(context.failures[0]?.errorSignature, "codex:PRIVACY_BLOCK:api_key");
  });

  it("sdk_failure_records_canonical_signature", async () => {
    const context = createIntegrationContext();
    const networkError = new Error("network unavailable") as Error & { code: string };
    networkError.code = "NETWORK_ERROR";
    context.clients.codex.errors.push(networkError);

    await assert.rejects(
      context.orchestrator.execute({ actionType: "audit", payload: {}, agentId: "codex" }),
      SDKExecutionError,
    );

    assert.equal(context.failures[0]?.errorSignature, "codex:audit:NETWORK_ERROR");
    assert.equal(context.events.at(-1)?.type, "AGENT_ACTION_FAILED");
  });

  it("high_impact_action_triggers_policy_stop", async () => {
    let approve: ((value: boolean) => void) | undefined;
    const context = createIntegrationContext({
      confirmHighImpact: async (action) => {
        context.policyStops.push(action);
        return new Promise<boolean>((resolve) => {
          approve = resolve;
        });
      },
    });
    context.clients.antigravity.results.push(successResult());

    const execution = context.orchestrator.execute({
      actionType: "rewrite",
      payload: { path: "src/main.ts" },
      agentId: "antigravity",
      allowHighImpact: true,
    });
    await Promise.resolve();

    assert.equal(context.policyStops.length, 1);
    assert.equal(context.clients.antigravity.calls.length, 0);
    approve?.(true);

    const result = await execution;
    assert.equal(context.clients.antigravity.calls.length, 1);
    assert.equal(result.agentId, "antigravity");
  });

  it("vts_below_threshold_triggers_critic_retry", async () => {
    const context = createIntegrationContext({
      config: { criticLoop: { minVTS: 0.9, maxRetries: 1 } },
    });
    context.clients.cursor.results.push(lowVtsResult(), lowVtsResult());

    await assert.rejects(
      context.orchestrator.execute({ actionType: "patch", payload: {}, agentId: "cursor" }),
      CriticLoopExhaustedError,
    );

    assert.equal(context.clients.cursor.calls.length, 2);
    assert.equal(context.events.at(-1)?.type, "CRITIC_LOOP_EXHAUSTED");
    assert.equal(context.failures.at(-1)?.errorSignature, "cursor:patch:CRITIC_LOOP_EXHAUSTED");
  });

  it("successful_sdk_run_full_pipeline", async () => {
    const context = createIntegrationContext();
    context.clients.codex.results.push(successResult());

    const result = await context.orchestrator.execute({
      actionType: "review",
      payload: { prompt: "inspect local diff" },
      agentId: "codex",
    });

    assert.ok(result.vts >= 0.85);
    assert.equal(context.events[0]?.type, "AGENT_ACTION_PENDING");
    assert.equal(context.events[1]?.type, "AGENT_ACTION_COMPLETED");
    assert.equal(context.failures.length, 0);
    assert.equal(context.orchestrator.getCapabilityStats().codex.sampleSize, 1);
  });
});

function createIntegrationContext(options: {
  secretCategories?: string[];
  config?: ConstructorParameters<typeof SDKOrchestrator>[0]["config"];
  confirmHighImpact?: (action: AgentAction) => Promise<boolean>;
} = {}) {
  const clients = {
    codex: new IntegrationClient("codex"),
    cursor: new IntegrationClient("cursor"),
    antigravity: new IntegrationClient("antigravity"),
  };
  const events: AgentActionEvidenceEvent[] = [];
  const failures: Array<{ errorSignature: string }> = [];
  const policyStops: AgentAction[] = [];
  const orchestrator = new SDKOrchestrator({
    workspaceId: "integration-workspace",
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
    confirmHighImpact: options.confirmHighImpact ?? (async (action) => {
      policyStops.push(action);
      return true;
    }),
    config: options.config,
    now: () => new Date("2026-06-01T12:00:00.000Z"),
  });

  return { clients, events, failures, policyStops, orchestrator };
}

function successResult(): AgentSdkResult {
  return {
    output: { ok: true },
    tool_execution_events: [
      {
        toolName: "read",
        args: { path: "src/electron/orchestration/sdk-orchestrator.ts" },
        status: "success",
      },
      { toolName: "write_file", args: { path: "src/electron/orchestration/sdk-orchestrator.ts" }, status: "success" },
      { toolName: "plan_validation", status: "success" },
      {
        toolName: "run_tests",
        args: { command: "bun test src/electron/sdk-integration.test.ts" },
        status: "success",
        parsedOutput: { exitCode: 0 },
      },
    ],
  };
}

function lowVtsResult(): AgentSdkResult {
  return {
    output: { weak: true },
    tool_execution_events: [
      { toolName: "read", status: "failed" },
      { toolName: "run_tests", status: "failed", parsedOutput: { exitCode: 1 } },
    ],
  };
}

class IntegrationClient implements AgentSdkClient {
  readonly calls: AgentAction[] = [];
  readonly results: AgentSdkResult[] = [];
  readonly errors: Error[] = [];

  constructor(readonly agentId: AgentId) {}

  async execute(action: AgentAction): Promise<AgentSdkResult> {
    this.calls.push(action);
    const error = this.errors.shift();
    if (error) throw error;
    return this.results.shift() ?? successResult();
  }
}
