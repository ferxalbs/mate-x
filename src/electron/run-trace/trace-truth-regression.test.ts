import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import type { ToolExecutionRecord } from "../evidence-pack";
import { resolveToolAuthorization } from "../capability-resolver";
import { InMemoryEngineeringRepository } from "../engineering/in-memory-repository";
import { buildExecutionEvidence } from "../work-engine/execution-evidence";
import type { WorkPlan } from "../work-engine/types";
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
});
