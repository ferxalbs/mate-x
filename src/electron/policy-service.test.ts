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
