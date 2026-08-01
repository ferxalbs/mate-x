import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let userDataPath = "";
mock.module("electron", (() => ({
  app: {
    getPath: () => userDataPath,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
})) as any);

const { fileEditorTool } = await import("./file_editor");
const { isStructuredToolFailureOutput } = await import("../tool-result");
const { storeMutationRecoveryRecord } = await import(
  "../run-trace/mutation-recovery-vault"
);
const { reconcileMutationRecoveryVault } = await import(
  "../run-trace/mutation-recovery"
);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorkspace() {
  const workspacePath = await mkdtemp(join(tmpdir(), "matex-editor-test-"));
  userDataPath = await mkdtemp(join(tmpdir(), "matex-user-data-"));
  cleanup.push(workspacePath, userDataPath);
  return workspacePath;
}

const settings = {} as import("../../contracts/settings").AppSettings;

test("reverts the Acme-style duplicated closing brace", async () => {
  const workspacePath = await createWorkspace();
  const source = [
    "import { client } from './client';",
    "",
    "export async function create(email: string) {",
    "  return client.createCustomer(email);",
    "}",
    "",
  ].join("\n");
  await writeFile(join(workspacePath, "service.ts"), source);

  const output = await fileEditorTool.execute(
    {
      path: "service.ts",
      operation: "replace_range",
      startLine: 3,
      endLine: 4,
      expectedContent:
        "export async function create(email: string) {\n  return client.createCustomer(email);",
      newContent:
        "export async function create(email: string) {\n  return client.customers.create({ email });\n}",
    },
    { workspacePath, settings, runId: "run-acme-regression" },
  );

  assert.equal(isStructuredToolFailureOutput(output), true);
  assert.match(output, /invalid edit was reverted/i);
  assert.equal(await readFile(join(workspacePath, "service.ts"), "utf8"), source);
});

test("commits a structurally valid compare-and-swap edit", async () => {
  const workspacePath = await createWorkspace();
  const source = "export const value = 1;\n";
  await writeFile(join(workspacePath, "value.ts"), source);

  const output = await fileEditorTool.execute(
    {
      path: "value.ts",
      operation: "replace_range",
      startLine: 1,
      endLine: 1,
      expectedContent: "export const value = 1;",
      newContent: "export const value = 2;",
    },
    { workspacePath, settings, runId: "run-valid-edit" },
  );

  assert.equal(isStructuredToolFailureOutput(output), false);
  assert.equal(
    await readFile(join(workspacePath, "value.ts"), "utf8"),
    "export const value = 2;\n",
  );
  assert.match(output, /"verified":true/);
});

test("rejects a symlink escape before writing", async () => {
  const workspacePath = await createWorkspace();
  const outsidePath = await mkdtemp(join(tmpdir(), "matex-outside-"));
  cleanup.push(outsidePath);
  await symlink(outsidePath, join(workspacePath, "linked"));

  await assert.rejects(
    () =>
      fileEditorTool.execute(
        {
          path: "linked/escape.ts",
          operation: "create",
          newContent: "export const escaped = true;\n",
        },
        { workspacePath, settings, runId: "run-symlink" },
      ),
    /outside the active workspace/,
  );
});

test("startup recovery reverts only an unchanged agent write", async () => {
  const workspacePath = await createWorkspace();
  const target = join(workspacePath, "recover.ts");
  const beforeContent = "export const value = 1;\n";
  const afterContent = "export const value = 2;\n";
  await writeFile(target, afterContent);
  await storeMutationRecoveryRecord({
    version: 1,
    mutationId: "recover-safe",
    runId: "run-recovery",
    workspacePath,
    relativePath: "recover.ts",
    beforeExists: true,
    beforeContent,
    beforeMode: 0o100644,
    beforeHash: sha256(beforeContent),
    afterHash: sha256(afterContent),
    state: "written",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const result = await reconcileMutationRecoveryVault();

  assert.equal(result.reverted, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(await readFile(target, "utf8"), beforeContent);
});

test("startup recovery never overwrites a later human change", async () => {
  const workspacePath = await createWorkspace();
  const target = join(workspacePath, "conflict.ts");
  const beforeContent = "export const value = 1;\n";
  const agentContent = "export const value = 2;\n";
  const humanContent = "export const value = 3;\n";
  await writeFile(target, humanContent);
  await storeMutationRecoveryRecord({
    version: 1,
    mutationId: "recover-conflict",
    runId: "run-recovery-conflict",
    workspacePath,
    relativePath: "conflict.ts",
    beforeExists: true,
    beforeContent,
    beforeMode: 0o100644,
    beforeHash: sha256(beforeContent),
    afterHash: sha256(agentContent),
    state: "written",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const result = await reconcileMutationRecoveryVault();

  assert.equal(result.reverted, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(await readFile(target, "utf8"), humanContent);
});

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
