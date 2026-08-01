import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import type { ToolExecutionRecord } from "../evidence-pack";
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
  toLocalDiagnosticEvent,
  toPublicExecutionEvent,
} from "../../features/desktop-shell/components/agent-execution-trace";
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
