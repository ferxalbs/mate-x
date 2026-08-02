import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import type { ObjectiveVerificationEvidence } from "../../contracts/work-objective";
import type { RepositoryToolchainProfile } from "../repository-toolchain";
import { buildWorkPlanFromSnapshot } from "./work-engine-core";
import {
  scheduledValidationPlanMatches,
  selectSupplementalNoOpTest,
} from "./supplemental-validation";

const prompt = `Migrate the runtime API.

Replace client.createCustomer(email) with client.customers.create({ email }).

After editing:
- run focused tests
- run typecheck`;

describe("supplemental validation scheduling", () => {
  test("schedules an explicitly requested focused test for a verified no-op", () => {
    const workPlan = plan();
    workPlan.objectiveVerification = satisfiedVerification();

    assert.deepEqual(selectSupplementalNoOpTest(workPlan, []), {
      command: "bun run test",
      plannedCommand: "primary",
      scope: "full-suite",
    });
  });

  test("does not duplicate tests or schedule them for mutations or incomplete proof", () => {
    const workPlan = plan();
    workPlan.objectiveVerification = satisfiedVerification();
    const passedTest = {
      toolName: "run_tests",
      args: { scope: "full-suite" },
      output: "passed",
      evidence: {
        toolName: "run_tests",
        outcome: "completed" as const,
        summary: "passed",
        changedFiles: [],
        validationStatus: "passed" as const,
        validationRequirementId: "test" as const,
        validationExecutionId: "test-execution",
      },
    };
    const mutation = {
      toolName: "file_editor",
      args: { path: "src/service.ts" },
      output: "edited",
      evidence: {
        toolName: "file_editor",
        outcome: "completed" as const,
        summary: "edited",
        changedFiles: [{
          path: "src/service.ts",
          operation: "modified" as const,
          backupCreated: false,
          impactAnalysis: "full" as const,
        }],
      },
    };

    assert.equal(selectSupplementalNoOpTest(workPlan, [passedTest]), null);
    assert.equal(selectSupplementalNoOpTest(workPlan, [mutation]), null);
    workPlan.objectiveVerification = { ...satisfiedVerification(), coverage: "partial" };
    assert.equal(selectSupplementalNoOpTest(workPlan, []), null);
  });

  test("accepts only the exact current test plan", () => {
    assert.equal(scheduledValidationPlanMatches({
      primary: {
        command: "bun   run test",
        availability: "resolved",
        requirementId: "test",
      },
    }, "bun run test"), true);
    assert.equal(scheduledValidationPlanMatches({
      primary: {
        command: "bun run typecheck",
        availability: "resolved",
        requirementId: "typecheck",
      },
    }, "bun run test"), false);
  });
});

function plan() {
  const unavailable = { command: null, source: null, guarantee: null } as const;
  const targetToolchain: RepositoryToolchainProfile = {
    packagePath: "/fixture",
    manager: "bun",
    managerSource: "fixture",
    status: "resolved",
    commands: {
      test: {
        command: "bun run test",
        source: "script",
        guarantee: "local_only_no_install",
      },
      typecheck: unavailable,
      lint: unavailable,
      build: unavailable,
    },
    typecheck: unavailable,
  };
  return buildWorkPlanFromSnapshot({
    prompt,
    mode: "execute",
    workspace: { root: "/fixture", name: "fixture" },
    git: { changedFiles: [], stagedFiles: [], untrackedFiles: [] },
    targetToolchain,
    scripts: [{ name: "test", command: "bun run test", signal: "test" }],
  });
}

function satisfiedVerification(): ObjectiveVerificationEvidence {
  return {
    id: "objective-verification",
    objectiveId: "objective",
    objectiveContractHash: "contract-hash",
    requiredScopeHash: "scope-hash",
    runId: "run",
    workspaceId: "workspace",
    repositorySnapshotId: "snapshot",
    repositoryHead: "head",
    status: "satisfied",
    coverage: "complete",
    assertions: [],
    inspectedFiles: ["src/service.ts"],
    evidenceExecutionIds: ["objective-verifier:objective-verification"],
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}
