import assert from "node:assert/strict";
import { test } from "bun:test";

import type { RepoSnapshot } from "../workspace";
import { compareWorkspaceInventoryPaths } from "../workspace-inventory";
import {
  assessRepositoryOverviewCoverage,
  buildRepositoryOverviewToolCalls,
  collectRepositoryOverviewEvidence,
  selectRepositoryOverviewReadPaths,
} from "./repository-overview";

const snapshot = {
  workspace: { id: "fixture", name: "fixture", path: "/tmp/fixture", branch: "main", stack: [] },
  trustContract: { workspaceId: "fixture", trustState: "trusted", allowedPaths: ["."], allowedCommands: [], allowedDomains: [], writeAccess: false },
  files: [
    "package.json",
    "README.md",
    "docs/architecture.md",
    "src/main.ts",
    "src/app.ts",
    "src/services/user-service.ts",
    "src/services/order-service.ts",
    "tests/app.test.ts",
    "scripts/reset.ts",
  ],
  packageJson: "{}",
  statusLines: [],
  promptMatches: [],
} as unknown as RepoSnapshot;

test("repository overview selects only a bounded high-signal read set", () => {
  const paths = selectRepositoryOverviewReadPaths(snapshot);
  assert.deepEqual(paths.slice(0, 3), ["package.json", "README.md", "docs/architecture.md"]);
  assert.ok(paths.includes("src/main.ts"));
  assert.ok(paths.length <= 10);
  assert.equal(paths.some((path) => path.startsWith("tests/")), false);
});

test("repository inventory ordering is deterministic and signal-first", () => {
  const unordered = [
    "src/zeta.ts",
    "packages/worker/package.json",
    "README.md",
    "src/main.ts",
    "package.json",
    "docs/architecture.md",
  ];
  assert.deepEqual(unordered.sort(compareWorkspaceInventoryPaths), [
    "package.json",
    "README.md",
    "docs/architecture.md",
    "packages/worker/package.json",
    "src/main.ts",
    "src/zeta.ts",
  ]);
});

test("repository overview uses one batched read and one scoped search", async () => {
  const calls = buildRepositoryOverviewToolCalls(snapshot);
  assert.deepEqual(calls.map((call) => call.name), ["read_many", "rg"]);
  assert.deepEqual(JSON.parse(calls[1]!.arguments!).paths, ["src"]);

  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const collecting = collectRepositoryOverviewEvidence({
    snapshot,
    execute: async (call) => {
      started.push(call.name);
      if (started.length === 2) release();
      await gate;
      return {
        toolCallId: call.id,
        content: call.name === "read_many"
          ? "### package.json\n{}\n\n### README.md\nFixture\n\n### src/main.ts\nmain()"
          : "src/main.ts:1:1:main()",
        toolExecution: { toolName: call.name, args: {}, output: "ok", success: true },
      } as never;
    },
  });

  await Promise.resolve();
  assert.deepEqual(started, ["read_many", "rg"]);
  const evidence = await collecting;
  assert.equal(evidence.inspectedFileCount, 3);
  assert.deepEqual(evidence.toolExecutions.map((execution) => execution.toolName), ["read_many", "rg"]);
  assert.equal(evidence.evidenceBatchCount, 1);
  assert.equal(evidence.coverage.sufficient, true);
});

test("repository overview performs at most one read-only expansion when evidence is insufficient", async () => {
  const sparseSnapshot = {
    ...snapshot,
    files: ["notes.txt", "source/bootstrap.custom"],
  } as RepoSnapshot;
  const calls: string[] = [];
  const evidence = await collectRepositoryOverviewEvidence({
    snapshot: sparseSnapshot,
    execute: async (call) => {
      calls.push(call.name);
      return {
        toolCallId: call.id,
        content: call.name === "rg" ? "No matches found." : "Error: no readable paths.",
        toolExecution: { toolName: call.name, args: {}, output: "", success: true },
      } as never;
    },
  });

  assert.deepEqual(calls, ["read_many", "rg", "read_many", "rg"]);
  assert.equal(evidence.evidenceBatchCount, 2);
  assert.equal(evidence.coverage.sufficient, false);
  assert.match(evidence.modelContext, /avoid confident claims/i);
});

test("repository overview coverage records a deterministic inventory cap", () => {
  const coverage = assessRepositoryOverviewCoverage({
    snapshot: { ...snapshot, files: Array.from({ length: 200 }, (_, index) => `src/file-${index}.ts`) },
    readPaths: ["package.json", "README.md", "src/main.ts"],
    searchContent: "src/main.ts:1:1:main()",
  });
  assert.equal(coverage.sufficient, true);
  assert.equal(coverage.inventoryTruncated, true);
});
