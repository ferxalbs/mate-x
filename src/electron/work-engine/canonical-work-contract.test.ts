import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, test } from "bun:test";

import type {
  NormalizedToolEvidence,
  ToolExecutionRecord,
} from "../../contracts/execution";
import type { ToolEvent } from "../../contracts/chat";
import type { ValidationContract } from "../../contracts/work-objective";
import type { RepositoryToolchainProfile } from "../repository-toolchain";
import { authorizeValidationInvocation } from "../validation-authority";
import { resolveToolAuthorization } from "../capability-resolver";
import { createDefaultWorkspaceTrustContract } from "../workspace-trust";
import { GitService } from "../git-service";
import { buildWorkPlanFromSnapshot } from "./work-engine-core";
import { deriveWorkStages } from "./stages";
import { finalizeWorkRun } from "./finalizer";
import { evaluateValidationGate } from "./validation-gate";
import { buildEvidencePack } from "../evidence-pack";

const ACME_PROMPT = `Migrate every Acme SDK v2 customer API.

Replace client.createCustomer(email) with client.customers.create({ email }) in all runtime service files.

Do not modify tests unless required.

After editing:
- search for remaining createCustomer calls
- run focused tests
- run typecheck
- report files changed and validation results`;

const fixtureRoot = resolve(process.cwd(), "qa/fixtures/canonical-work/acme-demo");

function toolchain(options: {
  test?: string | null;
  typecheck?: string | null;
  lint?: string | null;
  build?: string | null;
  status?: RepositoryToolchainProfile["status"];
} = {}): RepositoryToolchainProfile {
  const commands = {
    test: command(options.test ?? "bun test"),
    typecheck: command(options.typecheck ?? null),
    lint: command(options.lint ?? null),
    build: command(options.build ?? null),
  };
  const status = options.status ?? (commands.typecheck.command ? "resolved" : "unavailable");
  return {
    packagePath: fixtureRoot,
    manager: "bun",
    managerSource: "fixture",
    status,
    cause: status === "ambiguous" ? "TOOLCHAIN_AMBIGUOUS" : status === "unavailable" ? "TYPECHECK_UNAVAILABLE" : undefined,
    commands,
    typecheck: commands.typecheck,
  };
}

function command(value: string | null): RepositoryToolchainProfile["commands"]["test"] {
  return {
    command: value,
    source: value ? "script" : null,
    guarantee: value ? "local_only_no_install" : null,
  };
}

function proposal(criteria: Array<{
  id: string;
  criterion: string;
  trigger: "after_mutation" | "primary_failed" | "high_risk_change" | "validation_is_objective";
  signal: "test" | "typecheck" | "lint" | "build";
  obligation: "required" | "recommended" | "fallback";
}>, stateAssertions: Array<{
  id: string;
  kind: "must_exist" | "must_not_exist";
  expression: string;
  scope?: string;
}> = []) {
  return {
    primaryObjective: "Structured repository objective",
    requestedRepositoryState: ["The requested repository state"],
    explicitConstraints: [],
    acceptanceCriteria: ["Repository evidence proves the requested state."],
    conditionalAcceptanceCriteria: criteria,
    evidenceRequirements: ["Repository tool evidence"],
    stateAssertions,
    validationIsPrimaryObjective: criteria.some((item) => item.trigger === "validation_is_objective"),
  };
}

function planFor(input: {
  prompt: string;
  targetToolchain?: RepositoryToolchainProfile;
  objectiveProposal?: unknown;
  initialMatches?: Array<{ file: string; line: number; text: string }>;
  mode?: "execute" | "analyze" | "quality" | "security_review";
  changedFiles?: string[];
}) {
  return buildWorkPlanFromSnapshot({
    prompt: input.prompt,
    mode: input.mode ?? "execute",
    workspace: { root: fixtureRoot, name: "acme-demo" },
    git: {
      changedFiles: input.changedFiles ?? [],
      stagedFiles: [],
      untrackedFiles: [],
    },
    targetToolchain: input.targetToolchain ?? toolchain(),
    scripts: [
      { name: "test", command: "bun test", signal: "test" },
      ...(input.targetToolchain?.commands.build.command
        ? [{ name: "build", command: input.targetToolchain.commands.build.command, signal: "build" as const }]
        : []),
    ],
    objectiveProposal: input.objectiveProposal,
    initialInspection: { matches: input.initialMatches },
  });
}

function validation(
  signal: "test" | "typecheck" | "lint" | "build",
  status: "passed" | "failed" | "blocked" = "passed",
  command = signal === "test" ? "bun test" : `bun run ${signal}`,
): ToolExecutionRecord {
  const evidence: NormalizedToolEvidence = {
    toolName: "run_tests",
    outcome: status === "blocked" ? "blocked" : status === "failed" ? "failed" : "completed",
    summary: `${signal} ${status}`,
    changedFiles: [],
    validationStatus: status,
    validationExecutionId: status === "passed" ? `${signal}-execution` : undefined,
    validationRequirementId: signal,
    validationCause: status === "blocked" ? "TYPECHECK_UNAVAILABLE" : undefined,
  };
  return {
    toolName: "run_tests",
    args: { command },
    output: `${signal} ${status}`,
    evidence,
  };
}

function mutation(path: string): ToolExecutionRecord {
  return {
    toolName: "file_editor",
    args: { path },
    output: `Edited ${path}.`,
    evidence: {
      toolName: "file_editor",
      outcome: "completed",
      summary: `Edited ${path}.`,
      changedFiles: [{
        path,
        operation: "modified",
        backupCreated: true,
        impactAnalysis: "full",
      }],
    },
  };
}

function search(query: string, output: string, parsedOutput?: Record<string, unknown>): ToolExecutionRecord {
  return { toolName: "rg", args: { query, path: "src/services" }, output, parsedOutput };
}

function planValidation(): ToolExecutionRecord {
  return { toolName: "plan_validation", args: {}, output: "Validation plan compiled." };
}

function finish(
  workPlan: ReturnType<typeof planFor>,
  toolExecutions: ToolExecutionRecord[],
  content = "Repository work completed.",
) {
  const stages = deriveWorkStages({
    workPlan,
    events: [],
    toolExecutions,
    privacyBlocked: false,
    evidenceAttached: true,
    noPatchNeeded: false,
  });
  const result = finalizeWorkRun({
    workPlan,
    stages,
    toolExecutions,
    content,
    evidenceAttached: true,
    synthesisStatus: "valid",
  });
  return { stages, result };
}

function item(contract: ValidationContract | undefined, signal: string) {
  return contract?.items.find((candidate) => candidate.signal === signal);
}

describe("canonical Work objective and validation contract", () => {
  test("Scenario 1: the Acme no-op is already_satisfied, not blocked", () => {
    const workPlan = planFor({
      prompt: ACME_PROMPT,
      targetToolchain: toolchain(),
      initialMatches: [{
        file: "src/services/customer-a.ts",
        line: 2,
        text: "return client.customers.create({ email });",
      }],
    });
    const { stages, result } = finish(workPlan, [
      search("createCustomer", "No matches found."),
      validation("test"),
    ], "Search completed. Focused tests passed. No files required changes.");
    const gate = evaluateValidationGate(workPlan, [
      search("createCustomer", "No matches found."),
      validation("test"),
    ], "No files required changes.");

    assert.equal(workPlan.intent, "patch");
    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "already_satisfied");
    assert.deepEqual(result.evidence.changedFiles, []);
    assert.equal(workPlan.objectiveContract?.actualDelta.targetState, "satisfied");
    assert.deepEqual(workPlan.objectiveContract?.actualDelta.changedFiles, []);
    assert.equal(result.evidence.validation.status, "not_required");
    assert.equal(item(result.evidence.validation.contract, "test")?.applicability, "not_applicable");
    assert.equal(item(result.evidence.validation.contract, "test")?.evidence.status, "passed");
    assert.equal(item(result.evidence.validation.contract, "typecheck")?.applicability, "not_applicable");
    assert.equal(item(result.evidence.validation.contract, "typecheck")?.availability, "unavailable");
    assert.equal(item(workPlan.validationContract, "typecheck")?.applicability, "not_applicable");
    assert.equal(stages.find((stage) => stage.id === "patch_attempted")?.status, "skipped");
    assert.equal(gate.allowed, true);
    assert.match(result.content, /Focused tests passed/i);
    assert.match(result.content, /not applicable/i);
  });

  test("Scenario 1 Evidence Pack keeps the canonical no-op completion", async () => {
    const workPlan = planFor({
      prompt: ACME_PROMPT,
      targetToolchain: toolchain(),
      initialMatches: [{
        file: "src/services/customer-a.ts",
        line: 2,
        text: "return client.customers.create({ email });",
      }],
    });
    const toolExecutions = [
      search("createCustomer", "No matches found."),
      validation("test"),
    ];
    const events: ToolEvent[] = [
      {
        id: "search",
        label: "Search completed",
        detail: "No remaining runtime createCustomer calls.",
        status: "done",
        type: "search",
      },
      {
        id: "tests",
        label: "Focused tests passed",
        detail: "bun test",
        status: "done",
        type: "validation",
      },
    ];
    const evidencePack = await buildEvidencePack({
      workspacePath: fixtureRoot,
      events,
      content: "Already satisfied; no files required changes. Focused tests passed.",
      toolExecutions,
      workPlan,
      initialStatusLines: (await new GitService(fixtureRoot).getStatusSafe())?.files.map((file) =>
        `${file.index}${file.working_dir} ${file.path}`,
      ) ?? [],
    });

    assert.equal(evidencePack.status, "complete");
    assert.equal(evidencePack.filesModified?.length ?? 0, 0);
  });

  test("Scenario 2: a real migration is partial and preserves the changed file", () => {
    const workPlan = planFor({ prompt: ACME_PROMPT, targetToolchain: toolchain() });
    const { result } = finish(workPlan, [
      mutation("src/services/customer.ts"),
      planValidation(),
      search("createCustomer", "No matches found."),
      search("client.customers.create", "src/services/customer.ts:2: return client.customers.create({ email });"),
      validation("test"),
    ], "Migrated the runtime service and focused tests passed.");

    assert.equal(result.terminalState, "partial");
    assert.equal(result.completionKind, "changed_unverified");
    assert.deepEqual(result.evidence.changedFiles.map((file) => file.path), ["src/services/customer.ts"]);
    assert.deepEqual(workPlan.objectiveContract?.actualDelta.changedFiles, ["src/services/customer.ts"]);
    assert.equal(result.evidence.validation.status, "not_run");
    assert.equal(result.evidence.validation.cause, "TYPECHECK_UNAVAILABLE");
    assert.match(result.summary, /typecheck/i);
  });

  test("Scenario 3: typecheck-only validation is blocked when unavailable", () => {
    const workPlan = planFor({
      prompt: "Run the repository typecheck and report the result.",
      targetToolchain: toolchain(),
    });
    const { result } = finish(workPlan, [], "The requested validation could not run.");

    assert.equal(workPlan.objectiveContract?.validationIsPrimaryObjective, true);
    assert.equal(item(workPlan.validationContract, "typecheck")?.trigger, "validation_is_objective");
    assert.equal(item(workPlan.validationContract, "typecheck")?.applicability, "applicable");
    assert.equal(result.terminalState, "blocked");
    assert.equal(result.completionKind, "blocked");
    assert.equal(result.evidence.validation.cause, "TYPECHECK_UNAVAILABLE");
  });

  test("Scenario 4: unavailable recommended lint warns without blocking", () => {
    const workPlan = planFor({
      prompt: "Update the customer service.",
      targetToolchain: toolchain(),
      objectiveProposal: proposal([
        { id: "tests", criterion: "focused tests", trigger: "after_mutation", signal: "test", obligation: "required" },
        { id: "lint", criterion: "lint", trigger: "after_mutation", signal: "lint", obligation: "recommended" },
      ]),
    });
    const { result } = finish(workPlan, [mutation("src/services/customer.ts"), planValidation(), validation("test")]);

    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "changed_verified");
    assert.equal(item(result.evidence.validation.contract, "lint")?.availability, "unavailable");
    assert.equal(item(result.evidence.validation.contract, "lint")?.applicability, "applicable");
    assert.ok(result.warnings.some((warning) => /recommended lint.*unavailable/i.test(warning)));
  });

  test("Scenario 5: a fallback configured for primary failure stays not_applicable after a pass", () => {
    const workPlan = planFor({
      prompt: "Update the customer service.",
      targetToolchain: toolchain({ build: "bun run build" }),
      objectiveProposal: proposal([
        { id: "tests", criterion: "focused tests", trigger: "after_mutation", signal: "test", obligation: "required" },
        { id: "fallback-build", criterion: "fallback build", trigger: "primary_failed", signal: "build", obligation: "fallback" },
      ]),
    });
    const { result } = finish(workPlan, [mutation("src/services/customer.ts"), planValidation(), validation("test")]);

    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "changed_verified");
    assert.equal(item(result.evidence.validation.contract, "build")?.applicability, "not_applicable");
  });

  test("Scenario 6: a high-risk fallback activates and waits for proof", () => {
    const workPlan = planFor({
      prompt: "Update the authorization contract and run focused tests.",
      targetToolchain: toolchain({ build: "bun run build" }),
      objectiveProposal: proposal([
        { id: "tests", criterion: "focused tests", trigger: "after_mutation", signal: "test", obligation: "required" },
        { id: "high-risk-build", criterion: "high-risk fallback build", trigger: "high_risk_change", signal: "build", obligation: "fallback" },
      ]),
    });
    const incomplete = finish(workPlan, [mutation("src/contracts/authorization.ts"), planValidation(), validation("test")]);
    assert.equal(incomplete.result.terminalState, "partial");
    assert.equal(item(incomplete.result.evidence.validation.contract, "build")?.applicability, "applicable");

    const complete = finish(workPlan, [
      mutation("src/contracts/authorization.ts"),
      planValidation(),
      validation("test"),
      validation("build"),
    ]);
    assert.equal(complete.result.terminalState, "completed");
    assert.equal(complete.result.completionKind, "changed_verified");
  });

  test("Scenario 7: review is inspection with read-only evidence", () => {
    const workPlan = planFor({
      prompt: "Review this diff and do not modify anything. Report evidence-backed findings.",
      mode: "analyze",
      targetToolchain: toolchain(),
    });
    const { result } = finish(workPlan, [{ toolName: "read", args: { path: "src/services/customer-a.ts" }, output: "read-only source evidence" }]);

    assert.equal(workPlan.objectiveContract?.strategy, "inspection");
    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "inspection_completed");
    assert.equal(result.evidence.changedFiles.length, 0);
    assert.equal(result.evidence.validation.status, "not_required");
  });

  test("explicit no-modification constraints become canonical read-only strategy", () => {
    const workPlan = planFor({
      prompt: "Fix the customer migration, but do not modify files.",
      targetToolchain: toolchain(),
    });
    const decision = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "src/services/customer.ts" },
      behaviorMode: "execute",
      workStrategy: workPlan.objectiveContract?.strategy,
      workspacePolicy: createDefaultWorkspaceTrustContract("workspace", "Fixture", {
        packageManager: "bun",
        detectedScripts: ["test"],
      }),
    });

    assert.equal(workPlan.objectiveContract?.mutationPermission, "read_only");
    assert.equal(workPlan.objectiveContract?.strategy, "inspection");
    assert.equal(decision.decision, "blocked");
  });

  test("Scenario 8: planning is read-only and does not turn planned checks into proof", () => {
    const workPlan = planFor({
      prompt: "Create an implementation plan for fixing the customer migration. Do not modify files.",
      mode: "quality",
      targetToolchain: toolchain(),
    });
    const { result } = finish(workPlan, [{ toolName: "read", args: { path: "src/services/customer-a.ts" }, output: "source inspected" }], "Plan: update the runtime service and then run tests.");

    assert.equal(workPlan.objectiveContract?.strategy, "planning");
    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "inspection_completed");
    assert.equal(result.evidence.validation.status, "not_required");
    assert.equal(result.evidence.validation.executionIds?.length ?? 0, 0);
  });

  test("planning intent is canonical even when the legacy mode adapter is Execute", () => {
    const workPlan = planFor({
      prompt: "Create an implementation plan for fixing the customer migration. Do not modify files.",
      targetToolchain: toolchain(),
    });
    const { result } = finish(workPlan, [{
      toolName: "read",
      args: { path: "src/services/customer-a.ts" },
      output: "source inspected",
    }]);

    assert.equal(workPlan.objectiveContract?.strategy, "planning");
    assert.equal(result.completionKind, "inspection_completed");
    assert.equal(result.evidence.changedFiles.length, 0);
  });

  test("Scenario 9: a resolved test capability remains usable without typecheck", () => {
    const workPlan = planFor({
      prompt: "Run focused tests and report the result.",
      targetToolchain: toolchain(),
    });
    const { result } = finish(workPlan, [validation("test")], "Focused tests passed.");

    assert.equal(workPlan.validationContract?.items.length, 1);
    assert.equal(item(workPlan.validationContract, "test")?.availability, "resolved");
    assert.equal(item(workPlan.validationContract, "typecheck"), undefined);
    assert.equal(result.terminalState, "completed");
    assert.equal(result.completionKind, "validation_completed");
  });

  test("Scenario 10: current repository authority rejects a stale persisted typecheck", async () => {
    const stalePlan = {
      id: "stale-plan",
      objective: "Run typecheck",
      changedFiles: ["src/services/customer.ts"],
      impactedFiles: [],
      riskLevel: "low" as const,
      primary: {
        command: "bun run typecheck",
        availability: "resolved" as const,
        requirementId: "typecheck" as const,
        reason: "historical",
        estimatedCost: "cheap" as const,
        expectedSignal: "historical",
      },
      fallback: {
        command: null,
        availability: "unresolved" as const,
        requirementId: "typecheck" as const,
        reason: "none",
        estimatedCost: "cheap" as const,
        expectedSignal: "none",
      },
      fallbackTrigger: "never",
      recommendations: [],
      comments: [],
      executionState: {
        primary: "not_run" as const,
        fallback: "not_run" as const,
        persistence: "not_verified" as const,
        blockingInstruction: "historical",
      },
      createdAt: new Date().toISOString(),
    };
    const decision = await authorizeValidationInvocation({
      command: "bun run typecheck",
      workspacePath: fixtureRoot,
      validationPlan: stalePlan,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.cause, "TYPECHECK_UNAVAILABLE");
  });

  test("Scenario 11: provider prose does not change canonical outcome", () => {
    const workPlan = planFor({
      prompt: "Run focused tests and report the result.",
      targetToolchain: toolchain(),
    });
    const first = finish(workPlan, [validation("test")], "Everything is perfect and ready.");
    const second = finish(workPlan, [validation("test")], "The provider says this is blocked.");

    assert.equal(first.result.terminalState, second.result.terminalState);
    assert.equal(first.result.completionKind, second.result.completionKind);
    assert.deepEqual(
      first.result.evidence.validation.contract?.items.map((candidate) => [candidate.applicability, candidate.evidence.status]),
      second.result.evidence.validation.contract?.items.map((candidate) => [candidate.applicability, candidate.evidence.status]),
    );
  });

  test("Scenario 12: workspace authorization adapters remain deterministic", () => {
    const policy = createDefaultWorkspaceTrustContract("workspace", "Fixture", {
      packageManager: "bun",
      detectedScripts: ["test"],
    });
    const readOnly = { ...policy, writeAccess: "read-only" as const };
    const approval = { ...policy, writeAccess: "approval-required" as const };
    const workspace = { ...policy, writeAccess: "workspace" as const };

    assert.equal(authorizeTool("review", readOnly).decision, "blocked");
    assert.equal(authorizeTool("execute", approval).decision, "needs_approval");
    assert.equal(authorizeTool("execute", workspace).decision, "allowed");
  });
});

function authorizeTool(
  behaviorMode: "review" | "execute",
  workspacePolicy: ReturnType<typeof createDefaultWorkspaceTrustContract>,
) {
  return resolveToolAuthorization({
    toolName: "file_editor",
    args: { path: "src/services/customer.ts" },
    behaviorMode,
    workspacePolicy,
  });
}
