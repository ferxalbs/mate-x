import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  createDefaultWorkspaceTrustContract,
  evaluateTrustForToolCall,
  normalizeWorkspaceTrustContract,
} from "./workspace-trust";

test("default trust contract allows reading local evidence artifacts", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-1", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });

  assert.equal(
    evaluateTrustForToolCall({
      toolName: "read",
      args: { path: ".mate-x/evidence/task-1/attestation.intoto.json" },
      contract,
    }),
    null,
  );
});

test("normalization adds evidence read path to existing scoped contracts", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-1", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  contract.allowedPaths = ["src"];

  const normalized = normalizeWorkspaceTrustContract(contract);

  assert.deepEqual(normalized.allowedPaths, ["src", ".mate-x/evidence"]);
});

test("non-JS workspace does not get bun-only command allowlist [NES-2.4]", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-2", "RustRepo", {
    hasPackageJson: false,
    packageManager: null,
  });
  assert.equal(contract.allowedCommands.length, 0);
  assert.ok(!contract.allowedCommands.some((c) => c.includes("bun")));
});

test("scoped trust allows an in-workspace edit and lint but rejects outside writes", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-auto", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  assert.equal(evaluateTrustForToolCall({ toolName: "file_editor", args: { path: "src/lib/id.ts" }, contract }), null);
  assert.equal(evaluateTrustForToolCall({ toolName: "sandbox_run", args: { command: "bun run lint" }, contract }), null);
  assert.match(evaluateTrustForToolCall({ toolName: "file_editor", args: { path: "../outside.ts" }, contract }) ?? "", /blocks/);
});
