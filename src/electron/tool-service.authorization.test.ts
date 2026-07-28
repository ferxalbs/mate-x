import assert from "node:assert/strict";
import { describe, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_APP_SETTINGS } from "../contracts/settings";
import type { BehaviorMode } from "../contracts/behavior-mode";
import type { WorkspaceWriteAccess } from "../contracts/workspace";
import { ToolService } from "./tool-service";
import type { Tool } from "./tool-types";
import { createDefaultWorkspaceTrustContract } from "./workspace-trust";
import { policyService } from "./policy-service";
import { createPolicyStopResolutionRequest } from "../contracts/policy";

function workspacePolicy(writeAccess: WorkspaceWriteAccess) {
  const contract = createDefaultWorkspaceTrustContract("workspace", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  contract.writeAccess = writeAccess;
  return contract;
}

function context(behaviorMode: BehaviorMode, writeAccess: WorkspaceWriteAccess) {
  const workspacePolicyValue = workspacePolicy(writeAccess);
  return {
    workspacePath: process.cwd(),
    trustContract: workspacePolicyValue,
    settings: DEFAULT_APP_SETTINGS,
    runId: `run-${behaviorMode}-${writeAccess}`,
    authority: {
      behaviorMode,
      workspacePolicy: workspacePolicyValue,
    },
  };
}

function fakeTool(
  name: string,
  calls: string[],
  classified: boolean,
): Tool {
  return {
    name,
    description: "Authorization boundary test tool.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    ...(classified
      ? {
          meta: {
            categories: ["mutating", "filesystem"],
            hasSideEffects: true,
          },
        }
      : {}),
    execute: async () => {
      calls.push(name);
      return JSON.stringify({ ok: true, status: "completed" });
    },
  };
}

describe("ToolService execution authority", () => {
  test("normal provider invocation is blocked before a Review write", async () => {
    const { executeAgentToolCall } = await import(
      "./repo-service/agentic-runtime/tool-executor"
    );
    const policy = workspacePolicy("workspace");
    const events: Parameters<typeof executeAgentToolCall>[0]["events"] = [];
    const result = await executeAgentToolCall({
      toolCall: {
        id: "provider-review-write",
        name: "file_editor",
        arguments: JSON.stringify({
          path: "README.md",
          operation: "replace_block",
          search: "old",
          replacement: "new",
        }),
      },
      toolIndex: 0,
      iteration: 0,
      snapshot: {
        workspace: {
          id: "workspace",
          path: process.cwd(),
          name: "Repo",
          branch: "main",
          status: "ready",
          stack: [],
          facts: [],
        },
        trustContract: policy,
        files: [],
        packageJson: null,
        statusLines: [],
        promptMatches: [],
      },
      events,
      emitProgress: () => undefined,
      appSettings: DEFAULT_APP_SETTINGS,
      runId: "provider-review",
      behaviorMode: "review",
    });

    assert.equal(result.outcome?.status, "blocked");
    assert.equal(
      result.outcome?.status === "blocked"
        ? result.outcome.blocker.code
        : undefined,
      "MODE_READ_ONLY",
    );
  });

  test("direct calls preserve Review, read-only Execute, and workspace Execute semantics", async () => {
    const calls: string[] = [];
    const service = new ToolService();
    service.registerTool(fakeTool("test_edit_boundary", calls, true));

    const review = await service.callTool(
      "test_edit_boundary",
      { path: "README.md" },
      context("review", "workspace"),
    );
    const readOnly = await service.callTool(
      "test_edit_boundary",
      { path: "README.md" },
      context("execute", "read-only"),
    );
    const allowed = await service.callTool(
      "test_edit_boundary",
      { path: "README.md" },
      context("execute", "workspace"),
    );

    assert.match(review, /MODE_READ_ONLY|Review mode only inspects/i);
    assert.match(readOnly, /Workspace is read-only/i);
    assert.match(allowed, /"ok":true/);
    assert.deepEqual(calls, ["test_edit_boundary"]);
  });

  test("provider file_editor enforces all four write policies through runtime exactly once", async () => {
    mock.module("electron", (() => ({
      app: {
        getPath: () => tmpdir(),
        isPackaged: false,
      },
      safeStorage: {
        decryptString: () => "",
        encryptString: (value: string) => Buffer.from(value),
        isEncryptionAvailable: () => false,
      },
      shell: {
        openExternal: async () => true,
      },
    })) as any);
    const { executeAgentToolCall } = await import(
      "./repo-service/agentic-runtime/tool-executor"
    );
    const scenarios = [
      {
        label: "execute-workspace",
        behaviorMode: "execute",
        writeAccess: "workspace",
        expected: "allowed",
      },
      {
        label: "execute-ask",
        behaviorMode: "execute",
        writeAccess: "approval-required",
        expected: "approval",
      },
      {
        label: "execute-read-only",
        behaviorMode: "execute",
        writeAccess: "read-only",
        expected: "blocked",
      },
      {
        label: "review-workspace",
        behaviorMode: "review",
        writeAccess: "workspace",
        expected: "blocked",
      },
    ] as const;

    for (const scenario of scenarios) {
      const workspacePath = await mkdtemp(
        join(tmpdir(), `mate-x-file-editor-${scenario.label}-`),
      );
      const filePath = join(workspacePath, "README.md");
      const policy = workspacePolicy(scenario.writeAccess);
      const runId = `${scenario.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await writeFile(filePath, "base\n", "utf8");
      policyService.registerRunContext({
        runId,
        workspaceId: policy.workspaceId,
        workspacePath,
        behaviorMode: scenario.behaviorMode,
        resolvePolicy: async () => ({
          workspacePolicy: policy,
          engineeringTaskStatus: "captured",
        }),
      });

      try {
        const execution = executeAgentToolCall({
          toolCall: {
            id: `${scenario.label}-call`,
            name: "file_editor",
            arguments: JSON.stringify({
              path: "README.md",
              operation: "append",
              newContent: "temporary\n",
            }),
          },
          toolIndex: 0,
          iteration: 0,
          snapshot: {
            workspace: {
              id: policy.workspaceId,
              path: workspacePath,
              name: "Repo",
              branch: "main",
              status: "ready",
              stack: [],
              facts: [],
            },
            trustContract: policy,
            files: ["README.md"],
            packageJson: null,
            statusLines: [],
            promptMatches: [],
          },
          events: [],
          emitProgress: () => undefined,
          appSettings: DEFAULT_APP_SETTINGS,
          runId,
          engineeringTaskStatus: "captured",
          behaviorMode: scenario.behaviorMode,
        });

        if (scenario.expected === "approval") {
          const stops = policyService.listStops(runId);
          assert.equal(stops.length, 1);
          assert.equal(stops[0]?.policyId, "WORKSPACE_APPROVAL_REQUIRED");
          assert.equal(stops[0]?.operation.requiredCapability, "workspace.write");
          policyService.resolveStop(
            createPolicyStopResolutionRequest(stops[0]!, "approve_once"),
          );
        }

        const result = await execution;
        const content = await readFile(filePath, "utf8");
        const stops = policyService.listStops(runId);
        const occurrenceCount = content.split("temporary\n").length - 1;
        if (scenario.expected === "allowed") {
          assert.equal(result.outcome, undefined);
          assert.equal(stops.length, 0);
          assert.equal(occurrenceCount, 1, result.content);
        } else if (scenario.expected === "approval") {
          assert.equal(result.outcome, undefined);
          assert.equal(stops.length, 1);
          assert.equal(stops[0]?.status, "completed");
          assert.equal(occurrenceCount, 1, result.content);
        } else {
          assert.equal(result.outcome?.status, "blocked");
          assert.equal(stops.length, 0);
          assert.equal(occurrenceCount, 0);
          if (scenario.behaviorMode === "review") {
            assert.equal(
              result.outcome?.status === "blocked"
                ? result.outcome.blocker.code
                : undefined,
              "MODE_READ_ONLY",
            );
          } else {
            assert.equal(
              result.outcome?.status === "blocked"
                ? result.outcome.blocker.code
                : undefined,
              "WORKSPACE_READ_ONLY",
            );
          }
        }
      } finally {
        policyService.closeRun(runId);
        await rm(workspacePath, { recursive: true, force: true });
      }
    }
  });

  test("manually constructed calls without authority never execute", async () => {
    const calls: string[] = [];
    const service = new ToolService();
    service.registerTool(fakeTool("manual_edit_boundary", calls, true));

    const result = await service.callTool(
      "manual_edit_boundary",
      { path: "README.md" },
      {
        workspacePath: process.cwd(),
        settings: DEFAULT_APP_SETTINGS,
      } as never,
    );

    assert.match(result, /EXECUTION_AUTHORITY_REQUIRED|effective capability context/i);
    assert.deepEqual(calls, []);
  });

  test("unknown operation metadata fails closed before side effects", async () => {
    const calls: string[] = [];
    const service = new ToolService();
    service.registerTool(fakeTool("opaque_operation", calls, false));

    const result = await service.callTool(
      "opaque_operation",
      { path: "README.md" },
      context("execute", "workspace"),
    );

    assert.match(result, /UNCLASSIFIED_OPERATION|metadata is missing/i);
    assert.deepEqual(calls, []);
  });

  test("live provider continuation approves one concrete write and executes it once", async () => {
    const fixture = await approvalFixture("provider-once");
    try {
      const execution = fixture.execute();
      const stop = fixture.openStop();
      policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));
      policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

      await execution;
      assert.equal(await readFile(fixture.countPath, "utf8"), "1");
      assert.equal(await readFile(fixture.filePath, "utf8"), "old\n");
      assert.equal(policyService.listStops(fixture.runId)[0]?.status, "completed");
    } finally {
      fixture.cleanup();
      await rm(fixture.workspacePath, { recursive: true, force: true });
    }
  });

  test("live provider denial and current workspace or Behavior ceilings prevent writes", async () => {
    for (const scenario of ["deny", "read-only", "review"] as const) {
      const fixture = await approvalFixture(`provider-${scenario}`);
      try {
        const execution = fixture.execute();
        const stop = fixture.openStop();
        if (scenario === "read-only") {
          fixture.currentPolicy.writeAccess = "read-only";
        } else if (scenario === "review") {
          policyService.updateRunBehavior(fixture.runId, "review");
        }
        policyService.resolveStop(
          createPolicyStopResolutionRequest(
            stop,
            scenario === "deny" ? "abort" : "approve_once",
          ),
        );

        const result = await execution;
        assert.equal(await readFile(fixture.filePath, "utf8"), "old\n");
        assert.equal(await readFile(fixture.countPath, "utf8").catch(() => "0"), "0");
        assert.match(
          result.content,
          scenario === "deny"
            ? /Action cancelled|APPROVAL_DENIED/i
            : scenario === "read-only"
              ? /read-only|WORKSPACE_READ_ONLY/i
              : /Review mode|MODE_READ_ONLY/i,
        );
      } finally {
        fixture.cleanup();
        await rm(fixture.workspacePath, { recursive: true, force: true });
      }
    }
  });

  test("approved direct ToolService call rejects changed identity and replay before side effects", async () => {
    const calls: string[] = [];
    const service = new ToolService();
    const toolName = `approval_bound_edit_${Date.now()}`;
    service.registerTool(fakeTool(toolName, calls, true));
    const currentPolicy = workspacePolicy("approval-required");
    const runId = `run-bound-${Date.now()}`;
    const workspacePath = process.cwd();
    policyService.registerRunContext({
      runId,
      workspaceId: currentPolicy.workspaceId,
      workspacePath,
      behaviorMode: "execute",
      resolvePolicy: async () => ({ workspacePolicy: currentPolicy }),
    });
    const approvedArgs = { path: "README.md" };
    const stop = policyService.createStop({
      runId,
      workspaceId: currentPolicy.workspaceId,
      workspacePath,
      toolName,
      requiredCapability: "workspace.write",
      operationArgs: approvedArgs,
      severity: "warning",
      policyId: "workspace.approval",
      title: "Approval required",
      explanation: "Approve once.",
      kind: "file_write",
      recommendation: "approve_once",
      availableActions: ["approve_once", "abort"],
    });
    policyService.resolveStop(createPolicyStopResolutionRequest(stop, "approve_once"));

    const mismatch = await service.callTool(
      toolName,
      { path: "README.md", content: "changed" },
      {
        ...context("execute", "approval-required"),
        workspacePath,
        runId,
        authority: {
          behaviorMode: "execute",
          workspacePolicy: currentPolicy,
        },
        approvedPolicyStopId: stop.id,
      },
    );
    assert.match(mismatch, /does not match|operation_mismatch/i);
    assert.deepEqual(calls, []);

    const first = await service.callTool(toolName, approvedArgs, {
      ...context("execute", "approval-required"),
      workspacePath,
      runId,
      authority: {
        behaviorMode: "execute",
        workspacePolicy: currentPolicy,
      },
      approvedPolicyStopId: stop.id,
    });
    const replay = await service.callTool(toolName, approvedArgs, {
      ...context("execute", "approval-required"),
      workspacePath,
      runId,
      authority: {
        behaviorMode: "execute",
        workspacePolicy: currentPolicy,
      },
      approvedPolicyStopId: stop.id,
    });
    assert.match(first, /"ok":true/);
    assert.match(replay, /already consumed|not_approved/i);
    assert.deepEqual(calls, [toolName]);
    policyService.closeRun(runId);
  });
});

async function approvalFixture(label: string) {
  const { executeAgentToolCall } = await import(
    "./repo-service/agentic-runtime/tool-executor"
  );
  const workspacePath = await mkdtemp(join(tmpdir(), `mate-x-${label}-`));
  const filePath = join(workspacePath, "README.md");
  const countPath = join(workspacePath, "count.txt");
  await writeFile(filePath, "old\n", "utf8");
  await writeFile(
    join(workspacePath, "verify.ts"),
    'const path = "count.txt"; const current = Number(await Bun.file(path).text().catch(() => "0")); await Bun.write(path, String(current + 1));\n',
    "utf8",
  );
  const currentPolicy = workspacePolicy("approval-required");
  currentPolicy.allowedCommands.push("bun verify.ts");
  const runId = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  policyService.registerRunContext({
    runId,
    workspaceId: currentPolicy.workspaceId,
    workspacePath,
    behaviorMode: "execute",
    resolvePolicy: async () => ({ workspacePolicy: currentPolicy }),
  });
  const execute = () =>
    executeAgentToolCall({
      toolCall: {
        id: `${label}-call`,
        name: "mutation",
        arguments: JSON.stringify({
          path: "README.md",
          searchString: "old",
          mutationString: "new",
          verificationCommand: "bun verify.ts",
        }),
      },
      toolIndex: 0,
      iteration: 0,
      snapshot: {
        workspace: {
          id: currentPolicy.workspaceId,
          path: workspacePath,
          name: "Repo",
          branch: "main",
          status: "ready",
          stack: [],
          facts: [],
        },
        trustContract: currentPolicy,
        files: ["README.md"],
        packageJson: null,
        statusLines: [],
        promptMatches: [],
      },
      events: [],
      emitProgress: () => undefined,
      appSettings: DEFAULT_APP_SETTINGS,
      runId,
      behaviorMode: "execute",
    });
  return {
    currentPolicy,
    execute,
    countPath,
    filePath,
    openStop: () => {
      const stop = policyService
        .listStops(runId)
        .find((candidate) => candidate.status === "open");
      assert.ok(stop);
      return stop;
    },
    runId,
    workspacePath,
    cleanup: () => policyService.closeRun(runId),
  };
}
