import { mkdir, mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, test } from "bun:test";
import { finalizeWorkRun } from "./finalizer";
import { buildWorkEngineRunArtifact, exportSanitizedWorkEngineRunArtifact } from "./run-artifact";
import { persistWorkEngineRunArtifact, resolveWorkEngineRunArtifactPath } from "./run-artifact-persistence";
import { deriveWorkStages } from "./stages";
import { buildWorkPlanFromSnapshot, type WorkPlanInputSnapshot } from "./work-engine-core";

describe("Work Engine run artifacts", () => {
  test("builds from pure snapshot, stages, and verdict", () => {
    const snapshot = makeSnapshot("run tests");
    const workPlan = buildWorkPlanFromSnapshot(snapshot);
    const stages = deriveWorkStages({
      workPlan,
      events: [],
      toolExecutions: [{ toolName: "plan_validation", args: {}, output: "planned" }],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: false,
    });
    const verdict = finalizeWorkRun({
      workPlan,
      stages,
      toolExecutions: [{ toolName: "plan_validation", args: {}, output: "planned" }],
      content: "Tests appear fine.",
      evidenceAttached: false,
    });
    const artifact = buildWorkEngineRunArtifact({
      runId: "run-1",
      snapshot,
      workPlan,
      stages,
      finalVerdict: verdict.verdict,
      evidenceAttached: false,
      downgradedClaims: verdict.warnings,
    });

    assertEqual(artifact.version, 1);
    assertEqual(artifact.finalVerdict, "needs_validation");
    assertEqual(artifact.validation?.status, "missing");
    assertIncludes(artifact.missingStages, "validation_executed");
  });

  test("does not include raw secret-like values from privacy categories", () => {
    const snapshot = makeSnapshot("inspect sk-live_1234567890abcdef");
    snapshot.privacy = {
      status: "blocked",
      strict: true,
      redactions: 1,
      categories: ["api_key:sk-live_1234567890abcdef"],
    };
    const workPlan = buildWorkPlanFromSnapshot(snapshot);
    const stages = deriveWorkStages({
      workPlan,
      events: [],
      toolExecutions: [],
      privacyBlocked: true,
      evidenceAttached: false,
      noPatchNeeded: false,
    });
    const artifact = exportSanitizedWorkEngineRunArtifact(buildWorkEngineRunArtifact({
      runId: "run-secret",
      snapshot,
      workPlan,
      stages,
      finalVerdict: "blocked",
      evidenceAttached: false,
    }));
    const json = JSON.stringify(artifact);

    assertFalse(json.includes("sk-live_1234567890abcdef"));
    assertEqual(artifact.snapshot.prompt, "[redacted by Privacy Sentinel]");
    assertEqual(artifact.privacy?.redactions, 1);
  });

  test("records downgraded claims and round-trips as JSON", () => {
    const snapshot = makeSnapshot("fix this bug");
    const workPlan = buildWorkPlanFromSnapshot(snapshot);
    const stages = deriveWorkStages({
      workPlan,
      events: [],
      toolExecutions: [{ toolName: "file_editor", args: {}, output: "patched" }],
      privacyBlocked: false,
      evidenceAttached: false,
      noPatchNeeded: false,
    });
    const artifact = buildWorkEngineRunArtifact({
      runId: "run-claims",
      snapshot,
      workPlan,
      stages,
      finalVerdict: "needs_validation",
      evidenceAttached: false,
      downgradedClaims: ["Unsupported final claim wording was downgraded by Work Engine."],
    });
    const parsed = JSON.parse(JSON.stringify(artifact));

    assertEqual(parsed.runId, "run-claims");
    assertIncludes(parsed.downgradedClaims, "Unsupported final claim wording was downgraded by Work Engine.");
  });

  test("persistence adapter writes expected app-data path", async () => {
    const appDataRoot = await mkdtemp(join(tmpdir(), "matex-work-engine-artifacts-"));
    await mkdir(appDataRoot, { recursive: true });
    const snapshot = makeSnapshot("review current changes");
    const workPlan = buildWorkPlanFromSnapshot(snapshot);
    const stages = deriveWorkStages({
      workPlan,
      events: [{ id: "tool-1-evidence_pack", label: "evidence_pack", detail: "attached", status: "done" }],
      toolExecutions: [{ toolName: "evidence_pack", args: {}, output: "attached" }],
      privacyBlocked: false,
      evidenceAttached: true,
      noPatchNeeded: false,
    });
    const artifact = buildWorkEngineRunArtifact({
      runId: "run/path:test",
      snapshot,
      workPlan,
      stages,
      finalVerdict: "success",
      toolEvents: [{ id: "tool-1-evidence_pack", label: "evidence_pack", detail: "attached", status: "done" }],
      evidenceAttached: true,
    });

    const expectedPath = resolveWorkEngineRunArtifactPath({ appDataRoot, runId: "run/path:test" });
    const actualPath = await persistWorkEngineRunArtifact({ appDataRoot, artifact });
    const persisted = JSON.parse(await readFile(actualPath, "utf8"));

    assertEqual(actualPath, expectedPath);
    assertEqual(persisted.runId, "run/path:test");
    assertEqual(persisted.evidence.attached, true);
  });
});

function makeSnapshot(prompt: string): WorkPlanInputSnapshot {
  return {
    prompt,
    mode: "build",
    workspace: {
      root: "/tmp/repo",
      name: "repo",
    },
    git: {
      branch: "main",
      changedFiles: ["src/index.ts"],
      stagedFiles: [],
      untrackedFiles: [],
    },
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
      status: "active",
      strict: true,
      redactions: 0,
      categories: [],
    },
  };
}

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function assertIncludes(values: string[], expected: string) {
  if (!values.includes(expected)) throw new Error(`Expected ${values.join(", ")} to include ${expected}`);
}

function assertFalse(value: boolean) {
  if (value) throw new Error("Expected false.");
}
