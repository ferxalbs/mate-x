import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { DEFAULT_APP_SETTINGS } from "../contracts/settings";
import type { BehaviorMode } from "../contracts/behavior-mode";
import type { WorkspaceWriteAccess } from "../contracts/workspace";
import { ToolService } from "./tool-service";
import type { Tool } from "./tool-types";
import { createDefaultWorkspaceTrustContract } from "./workspace-trust";

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
});
