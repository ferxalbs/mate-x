import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_APP_SETTINGS } from "../../contracts/settings";
import { createDefaultWorkspaceTrustContract } from "../workspace-trust";
import { isStructuredToolFailureOutput } from "../tool-result";
import { globTool } from "./glob";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("treats an optional missing search root as not_found, not I/O failure", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "matex-glob-test-"));
  cleanup.push(workspacePath);
  const trustContract = createDefaultWorkspaceTrustContract("workspace", "Repo");

  const output = await globTool.execute(
    { pattern: "**/*.test.ts", path: "tests" },
    { workspacePath, settings: DEFAULT_APP_SETTINGS, trustContract },
  );

  assert.equal(isStructuredToolFailureOutput(output), false);
  assert.match(output, /"discoveryStatus":"not_found"/);
});

test("intersects requested scope with legacy scoped allowlists", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "matex-glob-scope-"));
  cleanup.push(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(join(workspacePath, "src", "value.ts"), "export const value = 1;\n");
  const trustContract = createDefaultWorkspaceTrustContract("workspace", "Repo");
  trustContract.allowedPaths = ["src", "README.md"];

  const output = await globTool.execute(
    { pattern: "**/*.ts", path: "." },
    { workspacePath, settings: DEFAULT_APP_SETTINGS, trustContract },
  );

  assert.equal(isStructuredToolFailureOutput(output), false);
  assert.match(output, /src\/value\.ts/);
  assert.doesNotMatch(output, /glob failed/);
});

