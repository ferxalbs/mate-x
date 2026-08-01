import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "bun:test";

import { authorizeValidationInvocation } from "./validation-authority";
import type { ValidationPlan } from "../contracts/workspace";

function planFor(command: string, requirementId: "test" | "typecheck"): ValidationPlan {
  const primary = {
    command,
    availability: "resolved" as const,
    requirementId,
    reason: "test fixture",
    estimatedCost: "cheap" as const,
    expectedSignal: "test fixture",
  };
  return {
    id: "plan-test",
    objective: "test",
    changedFiles: ["src/service.ts"],
    impactedFiles: [],
    riskLevel: "low",
    primary,
    fallback: {
      ...primary,
      command: null,
      availability: "unresolved",
      requirementId: "validation",
      unavailableCause: "VALIDATION_COMMAND_UNRESOLVED",
    },
    fallbackTrigger: "test",
    recommendations: [],
    comments: [],
    executionState: {
      primary: "not_run",
      fallback: "not_run",
      persistence: "not_verified",
      blockingInstruction: "test",
    },
    createdAt: new Date().toISOString(),
  };
}

async function createBunScriptWorkspace() {
  const root = join(tmpdir(), `mate-x-validation-authority-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "acme-demo",
    private: true,
    scripts: { test: "bun test" },
  }));
  return root;
}

describe("repository-backed validation authority", () => {
  test("allows the exact current Bun repository script", async () => {
    const workspacePath = await createBunScriptWorkspace();
    try {
      const decision = await authorizeValidationInvocation({
        command: "bun run test",
        workspacePath,
        validationPlan: planFor("bun run test", "test"),
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.authorization, "planned");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test("blocks a stale generated typecheck before executable resolution", async () => {
    const workspacePath = await createBunScriptWorkspace();
    try {
      const decision = await authorizeValidationInvocation({
        command: "bunx tsc --noEmit",
        workspacePath,
        validationPlan: planFor("bunx tsc --noEmit", "typecheck"),
      });

      assert.equal(decision.allowed, false);
      assert.equal(decision.cause, "TYPECHECK_UNAVAILABLE");
      assert.match(decision.recommendedNextAction ?? "", /plan_validation/i);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test("records an approved fallback as an override instead of normal authority", async () => {
    const workspacePath = await createBunScriptWorkspace();
    try {
      const decision = await authorizeValidationInvocation({
        command: "bunx tsc --noEmit",
        workspacePath,
        validationPlan: planFor("bunx tsc --noEmit", "typecheck"),
        approvedPolicyStopId: "policy-stop-test",
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.authorization, "approved_override");
      assert.equal(decision.cause, "TYPECHECK_UNAVAILABLE");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
