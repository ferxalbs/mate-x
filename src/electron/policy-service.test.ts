import assert from "node:assert/strict";
import { test } from "bun:test";

import { createDefaultWorkspaceTrustContract } from "./workspace-trust";
import { policyService } from "./policy-service";

test("dependency installation pauses with concise context and resumes the same run", async () => {
  const contract = createDefaultWorkspaceTrustContract("policy-workspace", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  const stop = policyService.evaluateToolCall({
    runId: "run-same-context",
    workspacePath: "/tmp/policy-workspace",
    toolName: "sandbox_run",
    args: { command: "bun add left-pad" },
    contract,
  });
  assert.ok(stop);
  assert.equal(stop.title, "MaTE X needs approval to install a dependency.");
  const waiting = policyService.waitForResolution(stop.id);
  policyService.resolveStop({ stopId: stop.id, action: "approve_once" });
  const resumed = await waiting;
  assert.equal(resumed.runId, "run-same-context");
  assert.equal(resumed.status, "approved");
});

test("scoped changes cannot bypass high-impact or out-of-workspace policy", () => {
  const contract = createDefaultWorkspaceTrustContract("scoped-policy", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  contract.autonomy = "trusted-patch";

  const highImpactStop = policyService.evaluateToolCall({
    runId: "run-high-impact",
    workspacePath: "/tmp/scoped-policy",
    toolName: "file_editor",
    args: { path: "src/electron/policy-service.ts" },
    contract,
  });
  assert.equal(highImpactStop?.policyId, "change.high_impact");

  const outsideStop = policyService.evaluateToolCall({
    runId: "run-outside",
    workspacePath: "/tmp/scoped-policy",
    toolName: "file_editor",
    args: { path: "../outside.ts" },
    contract,
  });
  assert.equal(outsideStop?.policyId, "workspace.scope.write");
});

test("policy approval waits can be cancelled and clean up their resolver", async () => {
  const stop = policyService.createStop({
    runId: "run-cancelled-policy",
    workspacePath: "/tmp/policy-cancelled",
    toolName: "sandbox_run",
    severity: "warning",
    policyId: "command.direct_workspace_execution",
    title: "Approval required",
    explanation: "Test approval stop.",
    kind: "command",
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort"],
  });
  const controller = new AbortController();
  const waiting = policyService.waitForResolution(stop.id, controller.signal);
  controller.abort();

  await assert.rejects(waiting, { name: "AbortError" });
  policyService.resolveStop({ stopId: stop.id, action: "abort" });
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
});

test("one-time approvals are scoped to the approving run", () => {
  const args = { command: "bun add dependency" };
  const stop = policyService.evaluateToolCall({
    runId: "run-approval-owner",
    workspacePath: "/tmp/policy-run-scope",
    toolName: "sandbox_run",
    args,
  });
  assert.ok(stop);
  policyService.resolveStop({ stopId: stop.id, action: "approve_once" });

  assert.equal(
    policyService.isApprovedToolCall({
      runId: "run-approval-owner",
      workspacePath: "/tmp/policy-run-scope",
      toolName: "sandbox_run",
      args,
    }),
    true,
  );
  assert.equal(
    policyService.isApprovedToolCall({
      runId: "run-other",
      workspacePath: "/tmp/policy-run-scope",
      toolName: "sandbox_run",
      args,
    }),
    false,
  );
});
