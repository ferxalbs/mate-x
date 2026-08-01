import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { validationPlanner } from "./validation-planner";

describe("validation planner command authority", () => {
  test("does not replay stale bunx typecheck failures", () => {
    const plan = validationPlanner.createPlan({
      objective: "Validate the changed service.",
      changedFiles: ["src/services/service.ts"],
      impactedFiles: [],
      packageScripts: { test: "vitest run" },
      detectedFramework: "vitest",
      previousFailures: [{
        id: "run-1",
        workspaceId: "workspace-1",
        command: "bunx tsc --noEmit",
        status: "failed",
        ranAt: new Date().toISOString(),
      }],
      profile: {
        workspaceId: "workspace-1",
        packageManager: "bun",
        testCommand: "bun run test",
        typecheckCommand: "bunx tsc --noEmit",
        updatedAt: new Date().toISOString(),
      },
    });

    assert.notEqual(plan.primary.command, "bunx tsc --noEmit");
    assert.notEqual(plan.fallback.command, "bunx tsc --noEmit");
  });
});
