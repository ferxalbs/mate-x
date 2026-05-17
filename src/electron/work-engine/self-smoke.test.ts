import { describe, test } from "bun:test";
import { runWorkEngineBenchmark } from "./benchmark/benchmark-runner";
import { finalizeWorkRun } from "./finalizer";
import { classifyWorkIntent } from "./intent";
import { deriveWorkStages } from "./stages";
import { buildWorkPlanFromSnapshot } from "./work-engine-core";

describe("Work Engine pure core self-smoke", () => {
  test("imports and runs outside Electron runtime", () => {
    assertEqual(classifyWorkIntent("Run the Work Engine regression suite and report the result."), "validate");

    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Run the Work Engine regression suite and report the result.",
      mode: "build",
      workspace: {
        root: "/Users/fer/Projects/mate-x",
        name: "mate-x",
      },
      git: {
        branch: "work-engine",
        changedFiles: ["src/electron/work-engine/work-engine-core.ts"],
        stagedFiles: [],
        untrackedFiles: [],
      },
      repoGraph: {
        status: "partial",
        entrypoints: ["src/electron/work-engine/work-engine-core.ts"],
        impactedFiles: ["src/electron/work-engine/finalizer.ts"],
        relatedTests: ["src/electron/work-engine/self-smoke.test.ts"],
        sensitiveSurfaces: [],
      },
      scripts: [
        {
          name: "test:work-engine",
          command: "bun run test:work-engine",
          signal: "test",
        },
      ],
      failures: [],
      privacy: {
        status: "active",
        strict: true,
        redactions: 0,
        categories: [],
      },
    });

    const toolExecutions = [
      {
        toolName: "plan_validation",
        input: { command: "bun run test:work-engine" },
        output: "planned",
      },
      {
        toolName: "run_tests",
        input: { command: "bun run test:work-engine" },
        output: "pass",
      },
      {
        toolName: "find_similar_failures",
        input: { command: "bun run test:work-engine" },
        output: "none",
      },
      {
        toolName: "evidence_pack",
        input: {},
        output: "attached",
      },
    ] as any[];
    const stages = deriveWorkStages({
      workPlan,
      events: [],
      toolExecutions,
      privacyBlocked: false,
      evidenceAttached: true,
      noPatchNeeded: false,
    });

    const verdict = finalizeWorkRun({
      workPlan,
      stages,
      toolExecutions,
      content: "Validated by runtime evidence.",
      evidenceAttached: true,
    });

    assertEqual(workPlan.intent, "validate");
    assertEqual(workPlan.runbook, "validate_only");
    assertEqual(verdict.verdict, "success");
    assertEqual(runWorkEngineBenchmark().summary.passRate, 1);
  });
});

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}
