import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { buildWorkPlanFromSnapshot } from "./work-engine-core";

describe("WorkPlan mode-independent intent", () => {
  test("keeps the exact legacy migration request on patch_test_verify", () => {
    const plan = buildWorkPlanFromSnapshot({
      prompt: `Migrate every legacy SDK v2 record API call to v3.

Update the three runtime service call sites, search for remaining deprecated
usages, and run the focused tests plus typecheck. Do not modify tests unless required.`,
      mode: "execute",
      workspace: { root: "/workspace/synthetic", name: "synthetic" },
      git: {
        branch: "main",
        changedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
      },
      scripts: [
        {
          name: "typecheck",
          command: "bun run typecheck",
          signal: "typecheck",
        },
      ],
    });

    assert.equal(plan.intent, "patch");
    assert.equal(plan.runbook, "patch_test_verify");
    assert.equal(plan.validationPlan.required, true);
    assert.equal(plan.validationPlan.primaryCommand, "bun run typecheck");
  });
});
