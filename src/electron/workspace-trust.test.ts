import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  createDefaultWorkspaceTrustContract,
  canQueryDomain,
  evaluateTrustForToolCall,
  normalizeWorkspaceTrustContract,
  TRUST_CONTRACT_SCHEMA_VERSION,
  type PersistedWorkspaceTrustContract,
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

test("legacy unrestricted JSON migrates once to scoped changes", () => {
  const current = createDefaultWorkspaceTrustContract("legacy-workspace", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  const legacy = JSON.parse(JSON.stringify({
    ...current,
    version: 1,
    autonomy: "unrestricted",
  })) as PersistedWorkspaceTrustContract;

  const migrated = normalizeWorkspaceTrustContract(legacy);
  const normalizedAgain = normalizeWorkspaceTrustContract(migrated);

  assert.equal(migrated.autonomy, "trusted-patch");
  assert.equal(migrated.version, TRUST_CONTRACT_SCHEMA_VERSION);
  assert.deepEqual(normalizedAgain, migrated);
});

test("migrated legacy contracts still enforce paths, commands, domains, and blocked actions", () => {
  const current = createDefaultWorkspaceTrustContract("legacy-policy", "Repo", {
    packageManager: "bun",
    hasPackageJson: true,
  });
  const contract = normalizeWorkspaceTrustContract({
    ...current,
    autonomy: "unrestricted",
  });

  assert.match(
    evaluateTrustForToolCall({
      toolName: "file_editor",
      args: { path: ".env" },
      contract,
    }) ?? "",
    /forbidden path/,
  );
  assert.match(
    evaluateTrustForToolCall({
      toolName: "sandbox_run",
      args: { command: "curl https://example.com" },
      contract,
    }) ?? "",
    /blocks command/,
  );
  assert.match(
    evaluateTrustForToolCall({
      toolName: "sandbox_run",
      args: { command: "rm src/obsolete.ts" },
      contract,
    }) ?? "",
    /prohibited/,
  );
  assert.equal(canQueryDomain(contract, "example.com"), false);
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
