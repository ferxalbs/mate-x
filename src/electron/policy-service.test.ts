import assert from "node:assert/strict";
import { test } from "bun:test";

import { policyService } from "./policy-service";

function createApproval(runId: string) {
  return policyService.createStop({
    runId,
    workspacePath: "/tmp/policy-workspace",
    toolName: "file_editor",
    severity: "warning",
    policyId: "workspace.approval",
    title: "Approval required",
    explanation: "Approve this repository change once.",
    kind: "file_write",
    target: "README.md",
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort"],
  });
}

test("approval state pauses and resumes the same run exactly once", async () => {
  const stop = createApproval("run-same-context");
  const waiting = policyService.waitForResolution(stop.id);
  policyService.resolveStop({ stopId: stop.id, action: "approve_once" });
  const resumed = await waiting;

  assert.equal(resumed.runId, "run-same-context");
  assert.equal(resumed.status, "approved");
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
  assert.equal(
    policyService.resolveStop({ stopId: stop.id, action: "approve_once" }),
    resumed,
  );
});

test("approval denial is terminal and does not reopen a request", async () => {
  const stop = createApproval("run-denied");
  policyService.resolveStop({ stopId: stop.id, action: "abort" });

  const resolved = await policyService.waitForResolution(stop.id);
  assert.equal(resolved.status, "declined");
  assert.equal(resolved.resolution?.action, "abort");
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
});

test("approval waits can be cancelled and clean up their resolver", async () => {
  const stop = createApproval("run-cancelled-policy");
  const controller = new AbortController();
  const waiting = policyService.waitForResolution(stop.id, controller.signal);
  controller.abort();

  await assert.rejects(waiting, { name: "AbortError" });
  policyService.resolveStop({ stopId: stop.id, action: "abort" });
  assert.equal(policyService.getRunState(stop.runId).status, "clear");
});
