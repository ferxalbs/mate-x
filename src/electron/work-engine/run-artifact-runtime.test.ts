import { describe, test } from "bun:test";
import { persistWorkEngineRunArtifactSafely, type WorkEngineRunArtifactPersistFn } from "./run-artifact-runtime";
import { deriveWorkStages } from "./stages";
import { buildWorkPlanFromSnapshot, type WorkPlanInputSnapshot } from "./work-engine-core";
import type { FinalRunVerdict } from "./finalizer";

describe("Work Engine runtime artifact persistence", () => {
  test("success run persists artifact", async () => {
    const result = await runPersistenceSmoke("run tests", "success", false);
    assertEqual(result.ok, true);
    assertEqual(result.artifact?.finalVerdict, "success");
  });

  test("needs_validation run persists artifact", async () => {
    const result = await runPersistenceSmoke("fix this bug", "needs_validation", false);
    assertEqual(result.ok, true);
    assertEqual(result.artifact?.finalVerdict, "needs_validation");
  });

  test("blocked privacy run persists artifact", async () => {
    const result = await runPersistenceSmoke("inspect sk-live_1234567890abcdef", "blocked", true);
    assertEqual(result.ok, true);
    assertEqual(result.artifact?.privacy?.status, "blocked");
  });

  test("failed run after WorkPlan persists artifact", async () => {
    const result = await runPersistenceSmoke("run tests", "failed", false);
    assertEqual(result.ok, true);
    assertEqual(result.artifact?.finalVerdict, "failed");
  });

  test("artifact write failure does not crash finalization", async () => {
    const result = await runPersistenceSmoke("run tests", "success", false, async () => {
      throw new Error("disk full sk-live_1234567890abcdef");
    });
    assertEqual(result.ok, false);
    assertEqual(result.error, "disk full [redacted]");
  });

  test("persisted artifact contains no raw fake secret", async () => {
    let persisted = "";
    const result = await runPersistenceSmoke(
      "inspect sk-live_1234567890abcdef",
      "blocked",
      true,
      async ({ artifact }) => {
        persisted = JSON.stringify(artifact);
        return "/tmp/work-engine-runs/run.json";
      },
    );
    assertEqual(result.ok, true);
    assertFalse(persisted.includes("sk-live_1234567890abcdef"));
  });
});

async function runPersistenceSmoke(
  prompt: string,
  verdict: FinalRunVerdict,
  privacyBlocked: boolean,
  persist?: WorkEngineRunArtifactPersistFn,
) {
  const snapshot = makeSnapshot(prompt, privacyBlocked);
  const workPlan = buildWorkPlanFromSnapshot(snapshot);
  const toolExecutions =
    verdict === "success"
      ? [
          { toolName: "plan_validation", args: {}, output: "planned" },
          { toolName: "run_tests", args: {}, output: "passed" },
          { toolName: "find_similar_failures", args: {}, output: "none" },
          { toolName: "evidence_pack", args: {}, output: "attached" },
        ]
      : [];
  const stages = deriveWorkStages({
    workPlan,
    events: [],
    toolExecutions,
    privacyBlocked,
    evidenceAttached: verdict === "success",
    noPatchNeeded: false,
  });
  return persistWorkEngineRunArtifactSafely({
    appDataRoot: "/tmp/matex-app-data",
    runId: "run-1",
    workspaceId: "workspace-1",
    model: { provider: "test", id: "mock" },
    snapshot,
    workPlan,
    stages,
    finalVerdict: verdict,
    toolEvents: [],
    evidenceAttached: verdict === "success",
    downgradedClaims: verdict === "needs_validation" ? ["Unsupported final claim wording was downgraded."] : [],
    persist,
  });
}

function makeSnapshot(prompt: string, privacyBlocked: boolean): WorkPlanInputSnapshot {
  return {
    prompt,
    mode: "build",
    workspace: { root: "/tmp/repo", name: "repo" },
    git: { branch: "main", changedFiles: ["src/index.ts"], stagedFiles: [], untrackedFiles: [] },
    repoGraph: {
      status: "ready",
      entrypoints: ["src/index.ts"],
      impactedFiles: ["src/index.ts"],
      relatedTests: ["tests/index.test.ts"],
      sensitiveSurfaces: [],
    },
    scripts: [{ name: "test", command: "bun test", signal: "test" }],
    failures: [],
    privacy: {
      status: privacyBlocked ? "blocked" : "active",
      strict: true,
      redactions: privacyBlocked ? 1 : 0,
      categories: privacyBlocked ? ["api_key:sk-live_1234567890abcdef"] : [],
    },
  };
}

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function assertFalse(value: boolean) {
  if (value) throw new Error("Expected false.");
}
