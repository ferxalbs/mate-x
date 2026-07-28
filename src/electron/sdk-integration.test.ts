import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  CriticLoopExhaustedError,
  HighImpactApprovalError,
  PrivacySentinelBlockError,
  SDKExecutionError,
  SDKAuthorizationError,
  SDKOrchestrator,
} from "./orchestration/sdk-orchestrator";
import type {
  AgentAction,
  AgentActionEvidenceEvent,
  AgentId,
  AgentSdkClient,
  AgentSdkResult,
} from "../contracts/sdk-orchestrator.types";
import { createDefaultWorkspaceTrustContract } from "./workspace-trust";
import { policyService } from "./policy-service";
import {
  createPolicyStopResolutionRequest,
  type PolicyStop,
} from "../contracts/policy";

let integrationRunSequence = 0;

describe("Electron SDK integration pipeline", () => {
  it("privacy_sentinel_blocks_before_sdk_call", async () => {
    const context = createIntegrationContext({ secretCategories: ["api_key"] });

    await assert.rejects(
      context.execute({
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
      context.execute({ actionType: "audit", payload: {}, agentId: "codex" }),
      SDKExecutionError,
    );

    assert.equal(context.failures[0]?.errorSignature, "codex:audit:NETWORK_ERROR");
    assert.equal(context.events.at(-1)?.type, "AGENT_ACTION_FAILED");
  });

  it("high_impact_action_triggers_policy_stop", async () => {
    const context = createIntegrationContext({ manualApproval: true });
    context.clients.antigravity.results.push(successResult());

    const execution = context.execute({
      actionType: "rewrite",
      payload: { path: "src/main.ts" },
      agentId: "antigravity",
    });
    const stop = context.policyStops.at(-1);
    assert.equal(context.policyStops.length, 1);
    assert.equal(context.clients.antigravity.calls.length, 0);
    assert.ok(stop);
    policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));
    policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

    const result = await execution;
    assert.equal(context.clients.antigravity.calls.length, 1);
    assert.equal(result.agentId, "antigravity");
  });

  it("sdk approval revalidates current Workspace Policy and Behavior", async () => {
    for (const scenario of ["read-only", "review"] as const) {
      const context = createIntegrationContext({ manualApproval: true });
      const execution = context.execute({
        actionType: "rewrite",
        payload: { path: "README.md" },
        agentId: "codex",
      });
      const stop = context.policyStops.at(-1);
      assert.ok(stop);
      if (scenario === "read-only") {
        context.workspacePolicy.writeAccess = "read-only";
      } else {
        policyService.updateRunBehavior(stop.runId, "review");
      }
      policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

      await assert.rejects(execution, SDKAuthorizationError);
      assert.equal(context.clients.codex.calls.length, 0);
    }
  });

  it("sdk pending approvals are scoped by run and workspace", async () => {
    const first = createIntegrationContext({
      manualApproval: true,
      workspaceId: "sdk-workspace-shared",
    });
    const second = createIntegrationContext({
      manualApproval: true,
      workspaceId: "sdk-workspace-shared",
    });
    const otherWorkspace = createIntegrationContext({
      manualApproval: true,
      workspaceId: "sdk-workspace-other",
    });
    const firstExecution = first.execute({
      actionType: "rewrite",
      payload: { path: "README.md", content: "first" },
      agentId: "codex",
    });
    const secondExecution = second.execute({
      actionType: "rewrite",
      payload: { path: "README.md", content: "second" },
      agentId: "codex",
    });
    const otherWorkspaceExecution = otherWorkspace.execute({
      actionType: "rewrite",
      payload: { path: "README.md", content: "other" },
      agentId: "codex",
    });
    const firstStop = first.policyStops.at(-1);
    const secondStop = second.policyStops.at(-1);
    const otherWorkspaceStop = otherWorkspace.policyStops.at(-1);
    assert.ok(firstStop);
    assert.ok(secondStop);
    assert.ok(otherWorkspaceStop);
    assert.notEqual(firstStop.runId, secondStop.runId);
    assert.equal(
      firstStop.operation.workspaceId,
      secondStop.operation.workspaceId,
    );
    assert.notEqual(
      firstStop.operation.workspaceId,
      otherWorkspaceStop.operation.workspaceId,
    );

    policyService.resolveStop(
      createPolicyStopResolutionRequest(firstStop, "approve_once"),
    );
    await firstExecution;
    assert.equal(first.clients.codex.calls.length, 1);
    assert.equal(second.clients.codex.calls.length, 0);
    assert.equal(otherWorkspace.clients.codex.calls.length, 0);

    policyService.resolveStop(
      createPolicyStopResolutionRequest(secondStop, "abort"),
    );
    await assert.rejects(secondExecution, HighImpactApprovalError);
    assert.equal(second.clients.codex.calls.length, 0);
    policyService.resolveStop(
      createPolicyStopResolutionRequest(otherWorkspaceStop, "abort"),
    );
    await assert.rejects(otherWorkspaceExecution, HighImpactApprovalError);
    assert.equal(otherWorkspace.clients.codex.calls.length, 0);
  });

  it("sdk approval cannot authorize a materially changed pending operation", async () => {
    const context = createIntegrationContext({ manualApproval: true });
    const payload = { path: "README.md", content: "first" };
    const execution = context.execute({
      actionType: "rewrite",
      payload,
      agentId: "codex",
    });
    const stop = context.policyStops.at(-1);
    assert.ok(stop);
    payload.content = "second";
    policyService.resolveStop(
      createPolicyStopResolutionRequest(stop, "approve_once"),
    );

    await assert.rejects(execution, SDKAuthorizationError);
    assert.equal(context.clients.codex.calls.length, 0);
  });

  it("cancelled SDK run cannot resume from a stale approval", async () => {
    const context = createIntegrationContext({ manualApproval: true });
    const controller = new AbortController();
    const execution = context.execute(
      {
        actionType: "rewrite",
        payload: { path: "README.md" },
        agentId: "codex",
      },
      controller.signal,
    );
    const stop = context.policyStops.at(-1);
    assert.ok(stop);
    policyService.cancelRun(stop.runId);
    controller.abort();
    policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

    await assert.rejects(execution);
    assert.equal(context.clients.codex.calls.length, 0);
  });

  it("vts_below_threshold_triggers_critic_retry", async () => {
    const context = createIntegrationContext({
      config: { criticLoop: { minVTS: 0.9, maxRetries: 1 } },
    });
    context.clients.cursor.results.push(lowVtsResult(), lowVtsResult());

    await assert.rejects(
      context.execute({ actionType: "patch", payload: {}, agentId: "cursor" }),
      CriticLoopExhaustedError,
    );

    assert.equal(context.clients.cursor.calls.length, 2);
    assert.equal(context.events.at(-1)?.type, "CRITIC_LOOP_EXHAUSTED");
    assert.equal(context.failures.at(-1)?.errorSignature, "cursor:patch:CRITIC_LOOP_EXHAUSTED");
  });

  it("successful_sdk_run_full_pipeline", async () => {
    const context = createIntegrationContext();
    context.clients.codex.results.push(successResult());

    const result = await context.execute({
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
  manualApproval?: boolean;
  workspaceId?: string;
} = {}) {
  const workspaceId = options.workspaceId ?? "integration-workspace";
  const clients = {
    codex: new IntegrationClient("codex"),
    cursor: new IntegrationClient("cursor"),
    antigravity: new IntegrationClient("antigravity"),
  };
  const events: AgentActionEvidenceEvent[] = [];
  const failures: Array<{ errorSignature: string }> = [];
  const policyStops: PolicyStop[] = [];
  const orchestrator = new SDKOrchestrator({
    workspaceId,
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
    config: options.config,
    now: () => new Date("2026-06-01T12:00:00.000Z"),
  });
  const workspacePolicy = createDefaultWorkspaceTrustContract(
    workspaceId,
    "Repo",
    { packageManager: "bun", hasPackageJson: true },
  );
  workspacePolicy.writeAccess = "workspace";
  const execute = (
    request: Parameters<SDKOrchestrator["execute"]>[0],
    signal?: AbortSignal,
  ) => {
    const runId = `sdk-integration-${integrationRunSequence += 1}`;
    const workspacePath = "/tmp/sdk-integration-workspace";
    policyService.registerRunContext({
      runId,
      workspaceId: workspacePolicy.workspaceId,
      workspacePath,
      behaviorMode: "execute",
      resolvePolicy: async () => ({ workspacePolicy }),
    });
    const execution = orchestrator.execute(request, {
      authority: { behaviorMode: "execute", workspacePolicy },
      signal,
      runId,
      workspaceId: workspacePolicy.workspaceId,
      workspacePath,
    });
    const stop = policyService.listStops(runId).find((candidate) => candidate.status === "open");
    if (stop) {
      policyStops.push(stop);
      if (!options.manualApproval) {
        policyService.resolveStop(
          createPolicyStopResolutionRequest(stop, "approve_once"),
        );
      }
    }
    return execution.finally(() => policyService.closeRun(runId));
  };

  return {
    clients,
    events,
    failures,
    policyStops,
    orchestrator,
    execute,
    workspacePolicy,
  };
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
