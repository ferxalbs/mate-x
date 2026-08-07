import assert from "node:assert/strict";
import { test } from "bun:test";

import { fingerprintOperation, policyService } from "./policy-service";
import { createDefaultWorkspaceTrustContract } from "./workspace-trust";
import { createPolicyStopResolutionRequest } from "../contracts/policy";

function createApproval(
  runId: string,
  args: Record<string, unknown> = { path: "README.md", content: "next" },
) {
  const workspacePolicy = createDefaultWorkspaceTrustContract(
    "policy-workspace",
    "Repo",
  );
  workspacePolicy.writeAccess = "approval-required";
  policyService.registerRunContext({
    runId,
    workspaceId: "policy-workspace",
    workspacePath: "/tmp/policy-workspace",
    behaviorMode: "execute",
    resolvePolicy: async () => ({ workspacePolicy }),
  });
  const stop = policyService.createStop({
    runId,
    workspaceId: "policy-workspace",
    workspacePath: "/tmp/policy-workspace",
    toolName: "file_editor",
    requiredCapability: "workspace.write",
    operationArgs: args,
    severity: "warning",
    policyId: "workspace.approval",
    title: "Approval required",
    explanation: "Approve this repository change once.",
    kind: "file_write",
    target: "README.md",
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort"],
  });
  return { stop, args };
}

test("approval state pauses and resumes the same run exactly once", async () => {
  const { stop, args } = createApproval("run-same-context");
  const waiting = policyService.waitForResolution(stop.id);
  policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));
  const resumed = await waiting;

  assert.equal(resumed.runId, "run-same-context");
  assert.equal(resumed.status, "approved");
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
  assert.equal(
    policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once")),
    resumed,
  );
  const first = policyService.consumeApprovedOperation({
    stopId: stop.id,
    runId: stop.runId,
    workspaceId: stop.operation.workspaceId,
    workspacePath: stop.workspacePath,
    operationName: "file_editor",
    requiredCapability: "workspace.write",
    args,
  });
  const second = policyService.consumeApprovedOperation({
    stopId: stop.id,
    runId: stop.runId,
    workspaceId: stop.operation.workspaceId,
    workspacePath: stop.workspacePath,
    operationName: "file_editor",
    requiredCapability: "workspace.write",
    args,
  });
  assert.equal(first.consumed, true);
  assert.deepEqual(second, { consumed: false, reason: "not_approved" });
  policyService.closeRun(stop.runId);
});

test("approval denial is terminal and does not reopen a request", async () => {
  const { stop, args } = createApproval("run-denied");
  policyService.resolveStop(createPolicyStopResolutionRequest(stop, "abort"));

  const resolved = await policyService.waitForResolution(stop.id);
  assert.equal(resolved.status, "declined");
  assert.equal(resolved.resolution?.action, "abort");
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
  assert.deepEqual(
    policyService.consumeApprovedOperation({
      stopId: stop.id,
      runId: stop.runId,
      workspaceId: stop.operation.workspaceId,
      workspacePath: stop.workspacePath,
      operationName: "file_editor",
      requiredCapability: "workspace.write",
      args,
    }),
    { consumed: false, reason: "not_approved" },
  );
  policyService.closeRun(stop.runId);
});

test("approval waits can be cancelled and clean up their resolver", async () => {
  const { stop, args } = createApproval("run-cancelled-policy");
  const controller = new AbortController();
  const waiting = policyService.waitForResolution(stop.id, controller.signal);
  controller.abort();

  await assert.rejects(waiting, { name: "AbortError" });
  policyService.resolveStop(createPolicyStopResolutionRequest(stop, "abort"));
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
  assert.deepEqual(
    policyService.consumeApprovedOperation({
      stopId: stop.id,
      runId: stop.runId,
      workspaceId: stop.operation.workspaceId,
      workspacePath: stop.workspacePath,
      operationName: "file_editor",
      requiredCapability: "workspace.write",
      args,
    }),
    { consumed: false, reason: "not_approved" },
  );
  policyService.closeRun(stop.runId);
});

test("approval binding rejects changed arguments, run, and workspace", () => {
  const { stop } = createApproval("run-bound-operation");
  policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

  const base = {
    stopId: stop.id,
    runId: stop.runId,
    workspaceId: stop.operation.workspaceId,
    workspacePath: stop.workspacePath,
    operationName: "file_editor",
    requiredCapability: "workspace.write" as const,
    args: { path: "README.md", content: "changed" },
  };
  assert.deepEqual(policyService.consumeApprovedOperation(base), {
    consumed: false,
    reason: "operation_mismatch",
  });
  assert.deepEqual(
    policyService.consumeApprovedOperation({ ...base, runId: "run-other" }),
    { consumed: false, reason: "run_mismatch" },
  );
  assert.deepEqual(
    policyService.consumeApprovedOperation({
      ...base,
      workspaceId: "workspace-other",
    }),
    { consumed: false, reason: "workspace_mismatch" },
  );
  policyService.closeRun(stop.runId);
});

test("approval binding fails closed for non-JSON operation metadata", () => {
  assert.throws(
    () =>
      fingerprintOperation({
        operationName: "file_editor",
        requiredCapability: "workspace.write",
        args: { changedAt: new Date("2026-07-27T00:00:00.000Z") },
      }),
    /plain objects/,
  );
  assert.throws(
    () =>
      fingerprintOperation({
        operationName: "file_editor",
        requiredCapability: "workspace.write",
        args: { value: undefined },
      }),
    /JSON-compatible/,
  );
});

test("approval fingerprints bind secret arguments without retaining their values", () => {
  const first = fingerprintOperation({
    operationName: "creds_validator",
    requiredCapability: "network.access",
    args: { provider: "github", token: "first-secret" },
  });
  const second = fingerprintOperation({
    operationName: "creds_validator",
    requiredCapability: "network.access",
    args: { provider: "github", token: "second-secret" },
  });

  assert.notEqual(first, second);
  assert.doesNotMatch(first, /first-secret|second-secret/);
});

test("resolution itself requires the exact run, workspace, and fingerprint", () => {
  const { stop } = createApproval("run-resolution-binding");
  const request = createPolicyStopResolutionRequest(stop, "approve_once");

  assert.throws(
    () => policyService.resolveStop({ ...request, runId: "run-other" }),
    /does not match/i,
  );
  assert.throws(
    () =>
      policyService.resolveStop({
        ...request,
        workspaceId: "workspace-other",
      }),
    /does not match/i,
  );
  assert.throws(
    () =>
      policyService.resolveStop({
        ...request,
        operationFingerprint: "0".repeat(64),
      }),
    /does not match/i,
  );
  assert.equal(stop.status, "open");
  policyService.closeRun(stop.runId);
});

test("cancelled run invalidates an approved but unconsumed operation", () => {
  const { stop, args } = createApproval("run-cancel-before-consume");
  policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));
  policyService.cancelRun(stop.runId);

  assert.deepEqual(
    policyService.consumeApprovedOperation({
      stopId: stop.id,
      runId: stop.runId,
      workspaceId: stop.operation.workspaceId,
      workspacePath: stop.workspacePath,
      operationName: "file_editor",
      requiredCapability: "workspace.write",
      args,
    }),
    { consumed: false, reason: "not_approved" },
  );
  policyService.closeRun(stop.runId);
});
