import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { buildEvidencePack, type ToolExecutionRecord } from "../evidence-pack";
import { resolveToolAuthorization } from "../capability-resolver";
import { InMemoryEngineeringRepository } from "../engineering/in-memory-repository";
import {
  buildExecutionEvidence,
  resolveExecutionTerminalState,
} from "../work-engine/execution-evidence";
import { validationPlanner } from "../validation-planner";
import { buildWorkPlanFromSnapshot } from "../work-engine/work-engine-core";
import { finalizeWorkRun } from "../work-engine/finalizer";
import { resolveToolExecutionPolicy } from "../repo-service/agentic-runtime/tool-requirement";
import type { WorkPlan } from "../work-engine/types";
import type { WorkStage } from "../work-engine/stages";
import {
  createDefaultWorkspaceTrustContract,
  evaluateTrustForToolCall,
} from "../workspace-trust";
import { projectRunEventToToolEvent } from "../../store/chat-store";
import {
  getActivitySummary,
  getGroupName,
  getRunningActivityLabel,
  toLocalDiagnosticEvent,
  toPublicExecutionEvent,
} from "../../features/desktop-shell/components/agent-execution-trace";
import { normalizeToolEvent } from "../../contracts/chat";
import { createPublicToolProgress } from "../repo-service/agentic-runtime/public-tool-progress";
import { AgentExecutionSession } from "./agent-execution-session";

function mutation(path = "src/service.ts"): ToolExecutionRecord {
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

describe("trace and terminal truth regression", () => {
  test("preserves safe agent checkpoints as visible public progress", () => {
    const repository = new InMemoryEngineeringRepository();
    repository.ensureSchema();
    const session = new AgentExecutionSession(
      "run-public-progress",
      "execute",
      null,
      null,
      repository,
    );
    session.captureLegacyEvents([{
      id: "pass-2-response",
      label: "Agent pass 2 response",
      detail: "Syntax is fixed. Next I am locating tests and validating the changes.",
      status: "completed",
      segmentKind: "intermediate_response",
      type: "result",
      visibility: "public",
    }]);

    const checkpoint = session.getEvents().at(-1);
    assert.equal(checkpoint?.kind, "provider.completed");
    assert.equal(checkpoint?.visibility, "public");

    const projected = projectRunEventToToolEvent(checkpoint!);
    assert.equal(projected.segmentKind, "intermediate_response");
    assert.match(projected.detail ?? "", /Next I am locating tests/);
  });

  test("projects useful local diagnostics without raw file content", () => {
    const repository = new InMemoryEngineeringRepository();
    repository.ensureSchema();
    const session = new AgentExecutionSession(
      "run-local-diagnostic",
      "execute",
      null,
      null,
      repository,
    );
    const delta = session.record({
      kind: "mutation.committed",
      phase: "execution",
      visibility: "local_diagnostic",
      payload: {
        toolClass: "file_editor",
        relativePath: "src/services/user-service.ts",
        durationMs: 17,
        verifier: "script-delimiter-parser",
        afterHash: "abc123",
      },
    });

    const projected = projectRunEventToToolEvent(delta.events[0]);
    assert.match(projected.title ?? "", /src\/services\/user-service\.ts/);
    assert.match(projected.detail ?? "", /Verifier: script-delimiter-parser/);
    assert.doesNotMatch(projected.detail ?? "", /file content/i);
  });

  test("allows repository reads beyond a legacy write allowlist", () => {
    const contract = createDefaultWorkspaceTrustContract("workspace", "Repo");
    contract.allowedPaths = ["src"];

    assert.equal(
      evaluateTrustForToolCall({
        toolName: "read",
        args: { path: "tests/customer.test.ts" },
        contract,
      }),
      null,
    );
    assert.match(
      evaluateTrustForToolCall({
        toolName: "file_editor",
        args: { path: "tests/customer.test.ts" },
        contract,
      }) ?? "",
      /outside allowed paths/,
    );
    assert.match(
      evaluateTrustForToolCall({
        toolName: "read",
        args: { path: ".env" },
        contract,
      }) ?? "",
      /forbidden path/,
    );
    assert.equal(
      evaluateTrustForToolCall({
        toolName: "run_tests",
        args: {
          scope: "specific-path",
          specificPath:
            "tests/checkout.test.ts tests/onboarding.test.ts tests/user.test.ts",
        },
        contract,
      }),
      null,
    );
  });

  test("keeps package-backed validation governed and public status useful", () => {
    const contract = createDefaultWorkspaceTrustContract("workspace", "Repo");
    const commandError = evaluateTrustForToolCall({
      toolName: "sandbox_run",
      args: { command: "bunx", args: ["tsc", "--noEmit"] },
      contract,
    });

    assert.match(commandError ?? "", /package-install/);
    const authorization = resolveToolAuthorization({
      toolName: "sandbox_run",
      args: { command: "bunx", args: ["tsc", "--noEmit"] },
      behaviorMode: "execute",
      workspacePolicy: contract,
    });
    assert.equal(authorization.decision, "needs_approval");
    if (authorization.decision === "needs_approval") {
      assert.match(authorization.summary, /may download a missing tool/i);
    }
    assert.equal(
      getRunningActivityLabel(),
      "Preparing next repository action",
    );
    assert.equal(
      getGroupName([
        {
          id: "read",
          label: "Read 6 relevant files",
          detail: "",
          status: "completed",
          type: "wait",
        },
        {
          id: "search",
          label: "Repository search completed",
          detail: "",
          status: "completed",
          type: "wait",
        },
      ]),
      "Read files, searched",
    );

    const normalized = normalizeToolEvent({
      id: "blocked-validation",
      label: "Typecheck blocked by policy",
      detail: "",
      status: "blocked",
    });
    assert.equal(normalized.type, "validation");
    assert.equal(normalized.title, "Typecheck blocked by policy");
  });

  test("does not surface a corrected editor argument failure as terminal cause", () => {
    const attempts: ToolExecutionRecord[] = [
      {
        toolName: "file_editor",
        args: {
          path: "src/services/user-service.ts",
          operation: "replace_block",
          replacementString: "}",
        },
        output: 'Unexpected argument "replacementString".',
        parsedOutput: { status: "failed", error: "Unexpected argument \"replacementString\"." },
      },
      {
        toolName: "file_editor",
        args: {
          path: "src/services/user-service.ts",
          operation: "replace_block",
          newContent: "}",
        },
        output: JSON.stringify({
          ok: true,
          status: "completed",
          path: "src/services/user-service.ts",
          summary: "Mutation committed and structurally verified.",
        }),
      },
    ];
    const evidence = buildExecutionEvidence({
      workPlan: {
        validationPlan: { required: true },
      } as WorkPlan,
      stages: [],
      toolExecutions: attempts,
      synthesisStatus: "valid",
    });

    assert.equal(evidence.failedSteps.length, 0);
    assert.deepEqual(
      evidence.changedFiles.map((file) => file.path),
      ["src/services/user-service.ts"],
    );
  });

  test("hides orchestration noise and keeps only useful diagnostics", () => {
    assert.equal(toLocalDiagnosticEvent({
      id: "run_evt_internal",
      label: "agent_pass_4",
      title: "agent_pass_4",
      detail: "",
      status: "completed",
      type: "wait",
      segmentKind: "tool",
      visibility: "technical",
    }), false);
    assert.equal(toLocalDiagnosticEvent({
      id: "run_evt_mutation",
      label: "file_editor · src/service.ts",
      title: "file_editor · src/service.ts",
      detail: "",
      status: "completed",
      type: "edit",
      segmentKind: "tool",
      visibility: "technical",
    }), true);
    assert.equal(toPublicExecutionEvent({
      id: "run_evt_created",
      label: "Run created",
      title: "Run created",
      detail: "",
      status: "active",
      type: "result",
      segmentKind: "tool",
      visibility: "public",
    }), null);
  });

  test("validation blocker outranks earlier passing checks", () => {
    assert.equal(
      getActivitySummary([
        {
          id: "passed",
          label: "Tests passed",
          detail: "",
          status: "completed",
          type: "validation",
          visibility: "public",
        },
        {
          id: "blocked",
          label: "Typecheck blocked",
          detail: "",
          status: "blocked",
          type: "validation",
          visibility: "public",
        },
      ]),
      "validation blocked or failed",
    );

    const blockedValidation: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", path: "." },
      output: JSON.stringify({
        status: "blocked",
        error: { code: "FORBIDDEN", message: "Command blocked." },
      }),
    };
    const evidence = buildExecutionEvidence({
      workPlan: { validationPlan: { required: true } } as WorkPlan,
      stages: [],
      toolExecutions: [
        mutation(),
        {
          toolName: "run_tests",
          args: { path: "." },
          output: JSON.stringify({ status: "completed", exitCode: 0 }),
        },
        blockedValidation,
      ],
      synthesisStatus: "valid",
    });
    assert.equal(evidence.validation.status, "blocked");
  });

  test("validation planning stays diagnostic, not fake validation", () => {
    const plan = createPublicToolProgress("plan_validation");
    assert.equal(plan.visibility, "technical");
    assert.equal(plan.type, "command");
    assert.notEqual(plan.label, "Running validation");
    assert.equal(
      createPublicToolProgress("sandbox_run", {
        command: "bun",
        args: ["x", "tsc", "--noEmit"],
      }, "failed").label,
      "Typecheck failed",
    );
  });

  test("never promotes a placeholder or bare exit code zero to validation proof", () => {
    const plan = validationPlanner.createPlan({
      objective: "Validate a TypeScript change.",
      changedFiles: ["src/service.ts"],
      impactedFiles: [],
      packageScripts: {},
      detectedFramework: "typescript",
      previousFailures: [],
    });
    assert.equal(plan.primary.command, null);
    assert.equal(plan.primary.availability, "unresolved");
    assert.equal(plan.primary.unavailableCause, "VALIDATION_COMMAND_UNRESOLVED");

    const evidence = buildExecutionEvidence({
      workPlan: { validationPlan: { required: true } } as WorkPlan,
      stages: [],
      toolExecutions: [{
        ...mutation(),
      }, {
        toolName: "run_tests",
        args: { scope: "changed-files" },
        output: JSON.stringify({
          status: "success",
          exitCode: 0,
          validationExecution: {
            executionId: "placeholder-exec",
            command: 'echo "No validation command detected"',
            processStarted: true,
            exitCode: 0,
            requirementId: "validation",
          },
        }),
      }],
      synthesisStatus: "valid",
    });
    assert.equal(evidence.validation.status, "failed");
    assert.deepEqual(evidence.validation.executionIds, []);

    const bareExit = buildExecutionEvidence({
      workPlan: { validationPlan: { required: true } } as WorkPlan,
      stages: [],
      toolExecutions: [{
        ...mutation(),
      }, {
        toolName: "run_tests",
        args: { scope: "changed-files" },
        output: JSON.stringify({ status: "success", exitCode: 0 }),
      }],
      synthesisStatus: "valid",
    });
    assert.equal(bareExit.validation.status, "failed");
    assert.deepEqual(bareExit.validation.executionIds, []);
  });

  test("ties one approved real test to one execution ID", () => {
    const execution: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", args: ["test"] },
      output: JSON.stringify({
        status: "completed",
        validationExecution: {
          executionId: "call-approved-bun-test",
          command: "bun test",
          processStarted: true,
          exitCode: 0,
          requirementId: "test",
        },
      }),
      executionPolicy: { requirement: "required", failureDisposition: "stop_phase" },
    };
    const evidence = buildExecutionEvidence({
      workPlan: {
        validationPlan: {
          required: true,
          requirements: [{ id: "test", command: "bun run test", availability: "resolved" }],
        },
      } as WorkPlan,
      stages: [],
      toolExecutions: [execution],
      synthesisStatus: "valid",
    });
    assert.equal(evidence.validation.status, "passed");
    assert.deepEqual(evidence.validation.executionIds, ["call-approved-bun-test"]);
  });

  test("optional toolchain discovery cannot block passed required validation", () => {
    assert.deepEqual(resolveToolExecutionPolicy("find", "execute"), {
      requirement: "fallback",
      failureDisposition: "continue",
    });
    const workPlan = {
      id: "optional-discovery",
      intent: "validate",
      risk: "low",
      objective: "Run tests.",
      runbook: "validate_only",
      workingSet: { primaryFiles: [], relatedFiles: [], relatedTests: [], changedFiles: [], impactedFiles: [], entrypoints: [], sensitiveSurfaces: [], relevantScripts: [], knownFailures: [] },
      validationPlan: { required: true, primaryCommand: "bun test", fallbackCommand: null, reason: "required", requirements: [{ id: "test", command: "bun test", availability: "resolved" }] },
      privacyPlan: { requireSanitization: false, blockIfP0Unsanitized: false, includeRepoContext: true, includeToolOutput: true, reason: "test" },
      preventivePlan: { enabled: false, riskAreas: [], recommendedControls: [], requiredChecks: [], strictness: "warn", reason: "test" },
      evidencePlan: { required: false, expectedArtifacts: [], requiredClaims: [] },
      stopConditions: [],
    } as WorkPlan;
    const requiredTest: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", args: ["test"] },
      output: JSON.stringify({ status: "completed", validationExecution: { executionId: "test-exec", command: "bun test", processStarted: true, exitCode: 0, requirementId: "test" } }),
      executionPolicy: { requirement: "required", failureDisposition: "stop_phase" },
    };
    const optionalFind: ToolExecutionRecord = {
      toolName: "find",
      args: { name: "tsc", path: "node_modules/.bin" },
      output: JSON.stringify({ status: "blocked", error: { code: "FORBIDDEN", message: "node_modules excluded" } }),
      executionPolicy: { requirement: "fallback", failureDisposition: "continue" },
    };
    const result = finalizeWorkRun({
      workPlan,
      stages: [
        { id: "context_compiled", status: "passed", source: "deterministic", reason: "", relatedToolEventIds: [] },
        { id: "validation_planned", status: "passed", source: "runtime", reason: "", relatedToolEventIds: [] },
        { id: "validation_executed", status: "passed", source: "runtime", reason: "", relatedToolEventIds: [] },
        { id: "failure_memory_checked", status: "passed", source: "runtime", reason: "", relatedToolEventIds: [] },
        { id: "privacy_preflight_passed", status: "passed", source: "deterministic", reason: "", relatedToolEventIds: [] },
      ],
      toolExecutions: [requiredTest, optionalFind],
      content: "Tests passed.",
      evidenceAttached: true,
      synthesisStatus: "valid",
    });
    assert.equal(result.terminalState, "completed");
    assert.equal(result.evidence.validation.status, "passed");
    assert.equal(result.evidence.blockedSteps.length, 0);
  });

  test("reports unavailable required typecheck and prevents completion", () => {
    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run tests and typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [{ name: "test", command: "bun test", signal: "test" }],
    });
    const typecheck = workPlan.validationPlan.requirements?.find((item) => item.id === "typecheck");
    assert.equal(typecheck?.availability, "unresolved");
    assert.equal(typecheck?.unavailableCause, "TYPECHECK_UNAVAILABLE");

    const ambiguousToolchain = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [],
      targetToolchain: {
        packagePath: "/repo",
        manager: null,
        managerSource: "/repo",
        status: "ambiguous",
        cause: "TOOLCHAIN_AMBIGUOUS",
        commands: {
          test: { command: null, source: null, guarantee: null },
          typecheck: { command: null, source: null, guarantee: null },
          lint: { command: null, source: null, guarantee: null },
          build: { command: null, source: null, guarantee: null },
        },
        typecheck: { command: null, source: null, guarantee: null },
      },
    });
    assert.equal(
      ambiguousToolchain.validationPlan.requirements?.find((item) => item.id === "typecheck")?.unavailableCause,
      "TOOLCHAIN_AMBIGUOUS",
    );

    const repositoryAwareResolution = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [],
      targetToolchain: {
        packagePath: "/repo",
        manager: "npm",
        managerSource: "/repo/package-lock.json",
        status: "resolved",
        commands: {
          test: { command: null, source: null, guarantee: null },
          typecheck: {
            command: "npm exec --offline --no -- tsc --noEmit",
            source: "local_toolchain",
            guarantee: "local_only_no_install",
          },
          lint: { command: null, source: null, guarantee: null },
          build: { command: null, source: null, guarantee: null },
        },
        typecheck: {
          command: "npm exec --offline --no -- tsc --noEmit",
          source: "local_toolchain",
          guarantee: "local_only_no_install",
        },
      },
    });
    assert.deepEqual(
      repositoryAwareResolution.validationPlan.requirements?.find((item) => item.id === "typecheck"),
      {
        id: "typecheck",
        command: "npm exec --offline --no -- tsc --noEmit",
        availability: "resolved",
      },
    );

    const evidence = buildExecutionEvidence({
      workPlan,
      stages: [],
      toolExecutions: [mutation(), {
        toolName: "sandbox_run",
        args: { command: "bun", args: ["test"] },
        output: JSON.stringify({ status: "completed", validationExecution: { executionId: "test-only", command: "bun test", processStarted: true, exitCode: 0, requirementId: "test" } }),
      }],
      synthesisStatus: "valid",
    });
    assert.equal(evidence.validation.status, "not_run");
    assert.equal(evidence.validation.cause, "TYPECHECK_UNAVAILABLE");
    assert.equal(resolveExecutionTerminalState({
      workPlan,
      evidence,
      stages: [],
      evidenceAttached: true,
    }), "partial");
    const finalization = finalizeWorkRun({
      workPlan,
      stages: [],
      toolExecutions: [mutation(), {
        toolName: "sandbox_run",
        args: { command: "bun", args: ["test"] },
        output: JSON.stringify({
          status: "completed",
          validationExecution: {
            executionId: "test-only",
            command: "bun test",
            processStarted: true,
            exitCode: 0,
            requirementId: "test",
          },
        }),
      }],
      content: "Tests passed.",
      evidenceAttached: true,
      synthesisStatus: "valid",
    });
    assert.equal(finalization.terminalState, "partial");
    assert.match(finalization.summary, /typecheck is unavailable/i);
  });

  test("approved fallback satisfies unresolved typecheck without stale cause", () => {
    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [],
      targetToolchain: {
        packagePath: "/repo",
        manager: "bun",
        managerSource: "/repo/package.json#packageManager",
        status: "unavailable",
        cause: "TYPECHECK_UNAVAILABLE",
        commands: {
          test: { command: null, source: null, guarantee: null },
          typecheck: { command: null, source: null, guarantee: null },
          lint: { command: null, source: null, guarantee: null },
          build: { command: null, source: null, guarantee: null },
        },
        typecheck: { command: null, source: null, guarantee: null },
      },
    });
    const approvedFallback: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", args: ["x", "tsc", "--noEmit"] },
      output: JSON.stringify({
        status: "completed",
        validationExecution: {
          executionId: "approved-typecheck",
          command: "bun x tsc --noEmit",
          processStarted: true,
          exitCode: 0,
          requirementId: "typecheck",
          authorization: "approved_override",
        },
      }),
    };
    const approvedStages: WorkStage[] = ([
      "context_compiled",
      "files_inspected",
      "patch_attempted",
      "validation_planned",
      "validation_executed",
      "failure_memory_checked",
      "privacy_preflight_passed",
      "evidence_attached",
    ] as WorkStage["id"][]).map((id) => ({
      id,
      status: "passed",
      source: "runtime",
      reason: "test fixture",
      relatedToolEventIds: [],
    }));

    const evidence = buildExecutionEvidence({
      workPlan,
      stages: approvedStages,
      toolExecutions: [mutation(), approvedFallback],
      synthesisStatus: "valid",
    });
    const result = finalizeWorkRun({
      workPlan,
      stages: approvedStages,
      toolExecutions: [mutation(), approvedFallback],
      content: "Typecheck passed.",
      evidenceAttached: true,
      synthesisStatus: "valid",
    });

    assert.equal(evidence.validation.status, "passed");
    assert.equal(evidence.validation.cause, undefined);
    assert.equal(evidence.validation.validationAuthorization, "approved_override");
    assert.equal(result.terminalState, "completed");
    assert.equal(result.evidence.validation.status, "passed");
    assert.equal(result.evidence.validation.validationAuthorization, "approved_override");
  });

  test("unapproved fallback cannot satisfy unresolved typecheck", () => {
    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [],
      targetToolchain: {
        packagePath: "/repo",
        manager: "bun",
        managerSource: "/repo/package.json#packageManager",
        status: "unavailable",
        cause: "TYPECHECK_UNAVAILABLE",
        commands: {
          test: { command: null, source: null, guarantee: null },
          typecheck: { command: null, source: null, guarantee: null },
          lint: { command: null, source: null, guarantee: null },
          build: { command: null, source: null, guarantee: null },
        },
        typecheck: { command: null, source: null, guarantee: null },
      },
    });
    const unapprovedFallback: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "tsc", args: ["--noEmit"] },
      output: JSON.stringify({
        status: "completed",
        validationExecution: {
          executionId: "unapproved-typecheck",
          command: "tsc --noEmit",
          processStarted: true,
          exitCode: 0,
          requirementId: "typecheck",
        },
      }),
    };

    const evidence = buildExecutionEvidence({
      workPlan,
      stages: [],
      toolExecutions: [mutation(), unapprovedFallback],
      synthesisStatus: "valid",
    });

    assert.equal(evidence.validation.status, "not_run");
    assert.equal(evidence.validation.cause, "TYPECHECK_UNAVAILABLE");
  });

  test("Evidence Pack uses the requirement-level validation status", async () => {
    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run tests and typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [{ name: "test", command: "bun test", signal: "test" }],
    });
    const pack = await buildEvidencePack({
      workspacePath: process.cwd(),
      events: [{ id: "response", label: "Response complete", detail: "", status: "completed" }],
      content: "Tests passed.",
      toolExecutions: [mutation(), {
        toolName: "run_tests",
        args: { scope: "changed-files" },
        output: JSON.stringify({
          status: "completed",
          validationExecution: {
            executionId: "test-only-pack",
            command: "bun test",
            processStarted: true,
            exitCode: 0,
            requirementId: "test",
          },
        }),
      }],
      workPlan,
    });

    assert.equal(pack.status, "partial");
  });

  test("approved fallback clears prior unresolved command failure for same requirement", async () => {
    const workPlan = buildWorkPlanFromSnapshot({
      prompt: "Patch service, run typecheck.",
      mode: "execute",
      workspace: { root: "/repo", name: "repo" },
      git: { changedFiles: ["src/service.ts"], stagedFiles: [], untrackedFiles: [] },
      scripts: [],
      targetToolchain: {
        packagePath: "/repo",
        manager: "bun",
        managerSource: "/repo/package.json#packageManager",
        status: "unavailable",
        cause: "TYPECHECK_UNAVAILABLE",
        commands: {
          test: { command: null, source: null, guarantee: null },
          typecheck: { command: null, source: null, guarantee: null },
          lint: { command: null, source: null, guarantee: null },
          build: { command: null, source: null, guarantee: null },
        },
        typecheck: { command: null, source: null, guarantee: null },
      },
    });
    const unresolvedRun: ToolExecutionRecord = {
      toolName: "run_tests",
      args: { scope: "changed-files" },
      output: JSON.stringify({
        ok: false,
        status: "failed",
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "No executable validation command is resolved.",
          details: {
            cause: "TYPECHECK_UNAVAILABLE",
            requirementId: "typecheck",
          },
        },
      }),
    };
    const approvedFallback: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", args: ["x", "tsc", "--noEmit"] },
      output: JSON.stringify({
        status: "completed",
        validationExecution: {
          executionId: "approved-typecheck-retry",
          command: "bun x tsc --noEmit",
          processStarted: true,
          exitCode: 0,
          requirementId: "typecheck",
          authorization: "approved_override",
        },
      }),
    };

    const evidence = buildExecutionEvidence({
      workPlan,
      stages: [],
      toolExecutions: [mutation(), unresolvedRun, approvedFallback],
      synthesisStatus: "valid",
    });

    assert.equal(evidence.validation.status, "passed");
    assert.equal(evidence.failedSteps.length, 0);
    assert.deepEqual(evidence.validation.executionIds, ["approved-typecheck-retry"]);

    const pack = await buildEvidencePack({
      workspacePath: process.cwd(),
      events: [
        {
          id: "stale-validation-error",
          label: "Validation failed",
          detail: "No executable validation command is resolved.",
          status: "error",
          type: "validation",
        },
        { id: "response", label: "Response complete", detail: "", status: "completed" },
      ],
      content: "Typecheck passed.",
      toolExecutions: [mutation(), unresolvedRun, approvedFallback],
      workPlan,
    });
    assert.equal(pack.status, "complete");
    assert.equal(pack.testsRun?.length, 1);
    assert.equal(pack.testsRun?.[0]?.executionId, "approved-typecheck-retry");
    assert.equal(
      pack.verifiedTaskScore?.signals.find((signal) => signal.id === "validation_passed")?.satisfied,
      true,
    );
    assert.doesNotMatch(pack.warnings?.join(" ") ?? "", /unresolved|unavailable/i);
  });

  test("keeps finalizer, ledger projection, UI outcome, and Evidence Pack in parity", async () => {
    const execution: ToolExecutionRecord = {
      toolName: "sandbox_run",
      args: { command: "bun", args: ["test"] },
      output: "Status: PASSED\nExit code: 0",
      parsedOutput: {
        status: "completed",
        summary: "Tests passed.",
        validationExecution: {
          executionId: "parity-validation-exec",
          command: "bun test",
          processStarted: true,
          exitCode: 0,
          requirementId: "test",
        },
      },
    };
    const pack = await buildEvidencePack({
      workspacePath: process.cwd(),
      events: [{ id: "response", label: "Response complete", detail: "", status: "completed" }],
      content: "Tests passed.",
      toolExecutions: [execution],
    });
    assert.equal(pack.status, "complete");
    assert.equal(pack.testsRun?.length, 1);
    assert.equal(pack.testsRun?.[0]?.executionId, "parity-validation-exec");
    assert.equal(pack.testsRun?.[0]?.status, "passed");

    const repository = new InMemoryEngineeringRepository();
    repository.ensureSchema();
    const session = new AgentExecutionSession(
      "run-parity",
      "execute",
      null,
      "parity-validation-exec",
      repository,
    );
    session.complete({
      terminalState: "completed",
      validationState: "passed",
      worktreeHealth: "changed_verified",
      evidence: {
        completedSteps: ["sandbox_run"],
        failedSteps: [],
        blockedSteps: [],
        changedFiles: [],
        validation: { status: "passed", executionIds: ["parity-validation-exec"] },
        synthesis: { status: "valid" },
      },
      summary: "Completed successfully.",
    });
    const terminal = session.getEvents().at(-1)!;
    assert.equal(terminal.executionId, "parity-validation-exec");
    assert.equal('validationState' in terminal.payload ? terminal.payload.validationState : undefined, "passed");
    assert.equal(projectRunEventToToolEvent(terminal).status, "completed");
  });
});
