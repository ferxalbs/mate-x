import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "bun:test";

import type { NormalizedToolEvidence, ToolExecutionRecord } from "../../contracts/execution";
import type { RepositoryToolchainProfile } from "../repository-toolchain";
import { buildWorkPlanFromSnapshot } from "./work-engine-core";
import { createModelToolsUnavailableResult } from "../repo-service/agentic-runtime/model-tools-unavailable";
import { deriveWorkStages } from "./stages";
import { finalizeWorkRun } from "./finalizer";
import { scheduleObjectiveVerification, verifyRepositoryObjective } from "./objective-verifier";
import { buildWorkEngineRunArtifact } from "./run-artifact";
import { persistWorkEngineRunArtifact } from "./run-artifact-persistence";

const execFileAsync = promisify(execFile);
const MIGRATION_PROMPT = `Migrate every legacy SDK customer API.

Replace client.createCustomer(email) with client.customers.create({ email }) in all runtime service files.

Do not modify tests unless required.

After editing:
- run focused tests`;

type FixtureState = "satisfied" | "legacy" | "one-legacy";

describe("deterministic repository objective verifier", () => {
  test("already-satisfied runtime state completes without mutation and keeps typed proof", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      workPlan.objectiveVerification = await verify(workPlan, workspacePath, "already-satisfied");
      const testEvidence = await runFocusedTests(workspacePath);
      const result = finish(workPlan, [testEvidence], "Provider progress says inspection is still running.");

      assert.equal(workPlan.objectiveVerification.status, "satisfied");
      assert.equal(workPlan.objectiveVerification.coverage, "complete");
      assert.equal(result.terminalState, "completed");
      assert.equal(result.completionKind, "already_satisfied");
      assert.deepEqual(result.evidence.changedFiles, []);
      assert.equal(result.evidence.validation.status, "not_required");
      assert.equal(result.evidence.validation.contract?.items.find((item) => item.signal === "test")?.evidence.status, "passed");
      assert.deepEqual(result.evidence.objective?.evidenceIds, workPlan.objectiveVerification.evidenceExecutionIds);
    });
  });

  test("a performed migration is re-inspected and completes changed_verified", async () => {
    await withRepository("legacy", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const initial = await verify(workPlan, workspacePath, "migration");
      assert.equal(initial.status, "unsatisfied");

      const changedFiles = await migrateRuntimeServices(workspacePath);
      const postMutation = await scheduleObjectiveVerification({
        workPlan,
        workspacePath,
        workspaceId: "fixture-workspace",
        runId: "migration",
      });
      assert.ok(postMutation);
      const testEvidence = await runFocusedTests(workspacePath);
      const result = finish(workPlan, [
        ...changedFiles.map(mutation),
        testEvidence,
      ], "Migration applied.");

      assert.equal(postMutation.status, "satisfied");
      assert.notEqual(postMutation.id, initial.id);
      assert.deepEqual(result.evidence.changedFiles.map((file) => file.path).sort(), changedFiles.sort());
      assert.equal(result.terminalState, "completed");
      assert.equal(result.completionKind, "changed_verified");
      assert.equal(result.evidence.validation.status, "passed");
    });
  });

  test("one remaining runtime legacy call is unsatisfied with its location", async () => {
    await withRepository("one-legacy", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const evidence = await verify(workPlan, workspacePath, "remaining-call");
      const forbidden = evidence.assertions.find((assertion) => assertion.kind === "forbidden_pattern_absent");

      assert.equal(evidence.status, "unsatisfied");
      assert.equal(forbidden?.status, "failed");
      assert.equal(forbidden?.matches[0]?.path, "src/services/customer-c.ts");
      assert.equal(forbidden?.matches[0]?.line, 2);
    });
  });

  test("a deprecated SDK declaration is an allowed remaining match", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const evidence = await verify(workPlan, workspacePath, "declaration-only");
      const allowed = evidence.assertions.find((assertion) => assertion.kind === "allowed_match_only");

      assert.equal(evidence.status, "satisfied");
      assert.equal(allowed?.status, "passed");
      assert.deepEqual(allowed?.matches.map((match) => match.path), ["src/sdk/deprecated-client.ts"]);
    });
  });

  test("partial scope coverage leaves the objective indeterminate", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const evidence = await verifyRepositoryObjective({
        objective: workPlan.objectiveContract!,
        workspacePath,
        workspaceId: "fixture-workspace",
        runId: "partial",
        maxFiles: 1,
      });

      assert.equal(evidence.status, "indeterminate");
      assert.equal(evidence.coverage, "partial");
      assert.ok(evidence.assertions.some((assertion) => assertion.status === "indeterminate"));
    });
  });

  test("passing tests without objective verification never infer satisfaction", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const testEvidence = await runFocusedTests(workspacePath);
      const result = finish(workPlan, [testEvidence], "Everything is complete and ready.");

      assert.equal(result.evidence.objective?.state, "unknown");
      assert.equal(result.terminalState, "blocked");
      assert.notEqual(result.completionKind, "already_satisfied");
    });
  });

  test("preexisting changes preserve provenance while verified state is already satisfied", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath, ["README.md"]);
      workPlan.objectiveVerification = await verify(workPlan, workspacePath, "preexisting");
      const result = finish(workPlan, [await runFocusedTests(workspacePath)], "No mutation required.");
      const testItem = result.evidence.validation.contract?.items.find((item) => item.signal === "test");

      assert.deepEqual({
        terminalState: result.terminalState,
        completionKind: result.completionKind,
        workspaceProvenance: result.evidence.workspaceProvenance,
        objectiveVerification: {
          status: result.evidence.objective?.verification?.status,
          coverage: result.evidence.objective?.verification?.coverage,
        },
        tests: testItem?.evidence.status,
        validation: testItem?.applicability,
        changedFiles: result.evidence.changedFiles.map((file) => file.path),
      }, {
        terminalState: "completed",
        completionKind: "already_satisfied",
        workspaceProvenance: "preexisting_changes",
        objectiveVerification: {
          status: "satisfied",
          coverage: "complete",
        },
        tests: "passed",
        validation: "not_applicable",
        changedFiles: [],
      });
      assert.deepEqual(workPlan.objectiveContract?.actualDelta.preexistingFiles, ["README.md"]);
    });
  });

  test("verified preexisting state is not failed by a provider without repository tools", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath, ["README.md"]);
      workPlan.objectiveVerification = await verify(workPlan, workspacePath, "provider-tools-unavailable");
      const providerFailure = createModelToolsUnavailableResult([]);
      const stages = deriveWorkStages({
        workPlan,
        events: [],
        toolExecutions: providerFailure.toolExecutions,
        privacyBlocked: false,
        evidenceAttached: true,
        noPatchNeeded: false,
      });
      const result = finalizeWorkRun({
        workPlan,
        stages,
        toolExecutions: providerFailure.toolExecutions,
        content: providerFailure.content,
        evidenceAttached: true,
        terminalOutcome: providerFailure.outcome,
        synthesisStatus: providerFailure.synthesisStatus,
        synthesisSummary: providerFailure.synthesisSummary,
      });

      assert.deepEqual({
        terminalState: result.terminalState,
        completionKind: result.completionKind,
        workspaceProvenance: result.evidence.workspaceProvenance,
        objectiveVerification: {
          status: result.evidence.objective?.verification?.status,
          coverage: result.evidence.objective?.verification?.coverage,
        },
        validation: result.evidence.validation.status,
        changedFiles: result.evidence.changedFiles.map((file) => file.path),
      }, {
        terminalState: "completed",
        completionKind: "already_satisfied",
        workspaceProvenance: "preexisting_changes",
        objectiveVerification: {
          status: "satisfied",
          coverage: "complete",
        },
        validation: "not_required",
        changedFiles: [],
      });
      assert.doesNotMatch(result.warnings.join("\n"), /cannot be marked successful/i);
    });
  });

  test("repository changes reject stale evidence and force a new verification", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      const first = await verify(workPlan, workspacePath, "resume");
      await writeFile(
        join(workspacePath, "src/services/customer-c.ts"),
        legacyService("createCustomerC"),
      );
      const second = await verifyRepositoryObjective({
        objective: workPlan.objectiveContract!,
        workspacePath,
        workspaceId: "fixture-workspace",
        runId: "resume",
        previousEvidence: first,
      });

      assert.notEqual(second.repositorySnapshotId, first.repositorySnapshotId);
      assert.notEqual(second.id, first.id);
      assert.equal(second.status, "unsatisfied");
    });
  });

  test("run persistence retains the exact objective evidence IDs", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const workPlan = plan(workspacePath);
      workPlan.objectiveVerification = await verify(workPlan, workspacePath, "persisted-run");
      const toolExecutions = [await runFocusedTests(workspacePath)];
      const stages = deriveWorkStages({
        workPlan,
        events: [],
        toolExecutions,
        privacyBlocked: false,
        evidenceAttached: true,
        noPatchNeeded: false,
      });
      const finalization = finalizeWorkRun({
        workPlan,
        stages,
        toolExecutions,
        content: "No mutation required.",
        evidenceAttached: true,
        synthesisStatus: "valid",
      });
      const artifact = buildWorkEngineRunArtifact({
        runId: "persisted-run",
        workspaceId: "fixture-workspace",
        snapshot: {
          prompt: MIGRATION_PROMPT,
          mode: "execute",
          workspace: { root: workspacePath, name: "fixture" },
        },
        workPlan,
        stages,
        finalVerdict: finalization.verdict,
        executionOutcome: {
          terminalState: finalization.terminalState,
          completionKind: finalization.completionKind,
          evidence: finalization.evidence,
          summary: finalization.summary,
        },
        evidenceAttached: true,
      });
      const artifactPath = await persistWorkEngineRunArtifact({
        appDataRoot: join(workspacePath, ".app-data"),
        artifact,
      });
      const persisted = JSON.parse(await readFile(artifactPath, "utf8"));

      assert.deepEqual(
        persisted.workPlan.objectiveVerification.evidenceExecutionIds,
        workPlan.objectiveVerification.evidenceExecutionIds,
      );
      assert.equal(
        persisted.executionOutcome.evidence.objective.verification.id,
        workPlan.objectiveVerification.id,
      );
    });
  });

  test("provider prose cannot change an identical repository outcome", async () => {
    await withRepository("satisfied", async (workspacePath) => {
      const firstPlan = plan(workspacePath);
      firstPlan.objectiveVerification = await verify(firstPlan, workspacePath, "provider-independent");
      const tests = await runFocusedTests(workspacePath);
      const first = finish(firstPlan, [tests], "All done, ship it.");

      const secondPlan = plan(workspacePath);
      secondPlan.objectiveVerification = await verify(secondPlan, workspacePath, "provider-independent");
      const second = finish(secondPlan, [tests], "Blocked maybe, I am still searching.");

      assert.equal(first.terminalState, second.terminalState);
      assert.equal(first.completionKind, second.completionKind);
      assert.equal(first.evidence.objective?.state, second.evidence.objective?.state);
      assert.equal(first.evidence.objective?.verification?.id, second.evidence.objective?.verification?.id);
    });
  });
});

async function withRepository<T>(state: FixtureState, run: (workspacePath: string) => Promise<T>) {
  const workspacePath = await mkdtemp(join(tmpdir(), "mate-x-objective-"));
  try {
    await Promise.all([
      mkdir(join(workspacePath, "src/services"), { recursive: true }),
      mkdir(join(workspacePath, "src/sdk"), { recursive: true }),
      mkdir(join(workspacePath, "tests"), { recursive: true }),
    ]);
    const runtimeFiles = ["customer-a.ts", "customer-b.ts", "customer-c.ts"];
    await Promise.all([
      writeFile(join(workspacePath, "package.json"), `${JSON.stringify({
        name: "objective-verifier-fixture",
        private: true,
        scripts: { test: "bun test tests/migration.test.ts" },
      }, null, 2)}\n`),
      writeFile(
        join(workspacePath, "src/sdk/deprecated-client.ts"),
        "/** @deprecated compatibility stub */\nexport const legacySignature = \"client.createCustomer(email)\";\n",
      ),
      ...runtimeFiles.map((file, index) => writeFile(
        join(workspacePath, "src/services", file),
        state === "legacy" || (state === "one-legacy" && index === 2)
          ? legacyService(`createCustomer${String.fromCharCode(65 + index)}`)
          : replacementService(`createCustomer${String.fromCharCode(65 + index)}`),
      )),
      writeFile(join(workspacePath, "tests/migration.test.ts"), migrationTestSource()),
      writeFile(join(workspacePath, "README.md"), "fixture\n"),
    ]);
    return await run(workspacePath);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

function plan(workspacePath: string, changedFiles: string[] = []) {
  return buildWorkPlanFromSnapshot({
    prompt: MIGRATION_PROMPT,
    mode: "execute",
    workspace: { root: workspacePath, name: "fixture" },
    git: { changedFiles, stagedFiles: [], untrackedFiles: [] },
    targetToolchain: toolchain(workspacePath),
    scripts: [{ name: "test", command: "bun test tests/migration.test.ts", signal: "test" }],
  });
}

async function verify(
  workPlan: ReturnType<typeof plan>,
  workspacePath: string,
  runId: string,
) {
  const evidence = await scheduleObjectiveVerification({
    workPlan,
    workspacePath,
    workspaceId: "fixture-workspace",
    runId,
  });
  assert.ok(evidence);
  return evidence;
}

function finish(
  workPlan: ReturnType<typeof plan>,
  toolExecutions: ToolExecutionRecord[],
  content: string,
) {
  const stages = deriveWorkStages({
    workPlan,
    events: [],
    toolExecutions,
    privacyBlocked: false,
    evidenceAttached: true,
    noPatchNeeded: false,
  });
  return finalizeWorkRun({
    workPlan,
    stages,
    toolExecutions,
    content,
    evidenceAttached: true,
    synthesisStatus: "valid",
  });
}

async function runFocusedTests(workspacePath: string): Promise<ToolExecutionRecord> {
  await execFileAsync("bun", ["test", "tests/migration.test.ts"], { cwd: workspacePath });
  const command = "bun test tests/migration.test.ts";
  const evidence: NormalizedToolEvidence = {
    toolName: "run_tests",
    outcome: "completed",
    summary: "Focused migration tests passed.",
    changedFiles: [],
    validationStatus: "passed",
    validationExecutionId: "focused-tests-execution",
    validationRequirementId: "test",
  };
  return { toolName: "run_tests", args: { command }, output: "Focused tests passed.", evidence };
}

function mutation(relativePath: string): ToolExecutionRecord {
  return {
    toolName: "file_editor",
    args: { path: relativePath },
    output: `Edited ${relativePath}.`,
    evidence: {
      toolName: "file_editor",
      outcome: "completed",
      summary: `Edited ${relativePath}.`,
      changedFiles: [{
        path: relativePath,
        operation: "modified",
        backupCreated: true,
        impactAnalysis: "full",
      }],
    },
  };
}

async function migrateRuntimeServices(workspacePath: string) {
  const files = ["customer-a.ts", "customer-b.ts", "customer-c.ts"];
  await Promise.all(files.map(async (file) => {
    const absolutePath = join(workspacePath, "src/services", file);
    const source = await readFile(absolutePath, "utf8");
    await writeFile(
      absolutePath,
      source
        .replace("createCustomer(email: string): unknown", "customers: { create(input: { email: string }): unknown }")
        .replace("client.createCustomer(email)", "client.customers.create({ email })"),
    );
  }));
  return files.map((file) => `src/services/${file}`);
}

function legacyService(functionName: string) {
  return `export function ${functionName}(client: { createCustomer(email: string): unknown }, email: string) {\n  return client.createCustomer(email);\n}\n`;
}

function replacementService(functionName: string) {
  return `export function ${functionName}(client: { customers: { create(input: { email: string }): unknown } }, email: string) {\n  return client.customers.create({ email });\n}\n`;
}

function migrationTestSource() {
  return `import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("runtime services use the customer collection API", () => {
  const directory = join(import.meta.dir, "../src/services");
  const sources = readdirSync(directory).map((file) => readFileSync(join(directory, file), "utf8"));
  for (const source of sources) {
    assert.match(source, /client\\.customers\\.create\\(/);
    assert.doesNotMatch(source, /client\\.createCustomer\\(/);
  }
});
`;
}

function toolchain(workspacePath: string): RepositoryToolchainProfile {
  const unavailable = { command: null, source: null, guarantee: null } as const;
  return {
    packagePath: workspacePath,
    manager: "bun",
    managerSource: "fixture",
    status: "resolved",
    commands: {
      test: {
        command: "bun test tests/migration.test.ts",
        source: "script",
        guarantee: "local_only_no_install",
      },
      typecheck: unavailable,
      lint: unavailable,
      build: unavailable,
    },
    typecheck: unavailable,
  };
}
