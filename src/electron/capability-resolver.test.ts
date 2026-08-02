import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  classifyToolCapability,
  resolveAdvertisedToolNames,
  resolveToolAuthorization,
} from "./capability-resolver";
import { createDefaultWorkspaceTrustContract } from "./workspace-trust";

function workspace(writeAccess: "read-only" | "approval-required" | "workspace") {
  const contract = createDefaultWorkspaceTrustContract("workspace", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  contract.writeAccess = writeAccess;
  return contract;
}

describe("capability resolution", () => {
  test("unclassified operations fail closed", () => {
    assert.equal(classifyToolCapability("future_operation"), "unclassified");
    const decision = resolveToolAuthorization({
      toolName: "future_operation",
      args: {},
      behaviorMode: "execute",
      workspacePolicy: workspace("workspace"),
    });

    assert.equal(decision.decision, "blocked");
    if (decision.decision !== "blocked") return;
    assert.equal(decision.outcome.blocker.code, "UNCLASSIFIED_OPERATION");
  });

  test("Review rejects edits structurally without advertising write tools", () => {
    const decision = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "review",
      workspacePolicy: workspace("workspace"),
    });

    assert.equal(decision.decision, "blocked");
    if (decision.decision !== "blocked") return;
    assert.equal(decision.outcome.blocker.code, "MODE_READ_ONLY");
    assert.equal(decision.outcome.blocker.remediation?.type, "change_mode");
    assert.ok(decision.outcome.summary.length < 80);
    assert.doesNotMatch(decision.outcome.summary, /policy|tool|system prompt/i);
    assert.ok(!resolveAdvertisedToolNames("review").includes("file_editor"));
  });

  test("Plan permits inspection but not commands or modifications", () => {
    assert.equal(
      resolveToolAuthorization({
        toolName: "rg",
        args: { pattern: "auth" },
        behaviorMode: "plan",
        workspacePolicy: workspace("workspace"),
      }).decision,
      "allowed",
    );
    assert.equal(
      resolveToolAuthorization({
        toolName: "sandbox_run",
        args: { command: "bun run typecheck" },
        behaviorMode: "plan",
        workspacePolicy: workspace("workspace"),
      }).decision,
      "blocked",
    );
    assert.ok(!resolveAdvertisedToolNames("plan").includes("file_editor"));
  });

  test("canonical Work strategy enforces read-only and validation boundaries", () => {
    const inspectionEdit = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "execute",
      workStrategy: "inspection",
      workspacePolicy: workspace("workspace"),
    });
    const inspectionCommand = resolveToolAuthorization({
      toolName: "sandbox_run",
      args: { command: "git diff" },
      behaviorMode: "execute",
      workStrategy: "inspection",
      workspacePolicy: workspace("workspace"),
    });
    const validationCommand = resolveToolAuthorization({
      toolName: "sandbox_run",
      args: { command: "bun test" },
      behaviorMode: "execute",
      workStrategy: "validation",
      workspacePolicy: workspace("workspace"),
    });
    const validationEdit = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "execute",
      workStrategy: "validation",
      workspacePolicy: workspace("workspace"),
    });

    assert.equal(inspectionEdit.decision, "blocked");
    assert.equal(inspectionCommand.decision, "blocked");
    assert.equal(validationCommand.decision, "allowed");
    assert.equal(validationEdit.decision, "blocked");
    assert.ok(!resolveAdvertisedToolNames("execute", "inspection").includes("sandbox_run"));
    assert.ok(resolveAdvertisedToolNames("execute", "validation").includes("sandbox_run"));
  });

  test("Execute can edit an authorized workspace", () => {
    const decision = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "execute",
      workspacePolicy: workspace("workspace"),
    });
    assert.deepEqual(decision, {
      decision: "allowed",
      capability: "workspace.write",
    });
    assert.ok(resolveAdvertisedToolNames("execute").includes("file_editor"));
  });

  test("workspace denial wins without creating an approval state", () => {
    const decision = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "execute",
      workspacePolicy: workspace("read-only"),
    });
    assert.equal(decision.decision, "blocked");
    if (decision.decision !== "blocked") return;
    assert.equal(decision.outcome.blocker.code, "WORKSPACE_READ_ONLY");
    assert.equal(decision.outcome.summary, "Workspace is read-only.");
  });

  test("an otherwise-authorized write requests one scoped approval", () => {
    const decision = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "README.md" },
      behaviorMode: "execute",
      workspacePolicy: workspace("approval-required"),
    });
    assert.deepEqual(decision, {
      decision: "needs_approval",
      capability: "workspace.write",
      code: "WORKSPACE_APPROVAL_REQUIRED",
      summary: "Approve this repository change once.",
    });
  });

  test("security-sensitive tools and files have a single central approval path", () => {
    const sensitiveTool = resolveToolAuthorization({
      toolName: "mutation",
      args: { path: "src/lib/a.ts" },
      behaviorMode: "execute",
      workspacePolicy: workspace("workspace"),
    });
    assert.equal(classifyToolCapability("mutation"), "sensitive.execute");
    assert.equal(sensitiveTool.decision, "needs_approval");

    const sensitiveFile = resolveToolAuthorization({
      toolName: "file_editor",
      args: { path: "src/electron/runtime.ts" },
      behaviorMode: "execute",
      workspacePolicy: workspace("workspace"),
    });
    assert.equal(sensitiveFile.decision, "needs_approval");
    if (sensitiveFile.decision === "needs_approval") {
      assert.equal(sensitiveFile.code, "HIGH_IMPACT_APPROVAL_REQUIRED");
    }
  });
});
