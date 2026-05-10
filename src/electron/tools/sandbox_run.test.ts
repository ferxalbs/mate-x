import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import {
  buildSandboxReport,
  isPackageManagerMutationCommand,
  parseSandboxCommand,
  prepareSandboxWorkspace,
  resolveSandboxExecutionMode,
} from "./sandbox_run";

describe("sandbox_run command parsing", () => {
  it("parses a direct command with quoted args", () => {
    assert.deepEqual(parseSandboxCommand('bun run test "src/foo bar.test.ts"'), {
      cmd: "bun",
      cmdArgs: ["run", "test", "src/foo bar.test.ts"],
    });
  });

  it("rejects shell operators", () => {
    assert.throws(
      () => parseSandboxCommand("bun test && rm -rf dist"),
      /Shell operators are not supported/,
    );
  });

  it("rejects empty commands", () => {
    assert.throws(() => parseSandboxCommand("   "), /Command is required/);
  });
});

describe("sandbox_run command risk detection", () => {
  it("detects package-manager mutations", () => {
    assert.equal(isPackageManagerMutationCommand("bun add lodash"), true);
    assert.equal(isPackageManagerMutationCommand("npm install react"), true);
    assert.equal(isPackageManagerMutationCommand("pnpm test"), false);
  });

  it("defaults package mutations to isolated-copy unless caller explicitly selects direct", () => {
    assert.equal(
      resolveSandboxExecutionMode({
        command: "bun add lodash",
        requestedMode: undefined,
      }),
      "isolated-copy",
    );
    assert.equal(
      resolveSandboxExecutionMode({
        command: "bun add lodash",
        requestedMode: "direct",
      }),
      "direct",
    );
  });
});

describe("sandbox_run reporting", () => {
  it("keeps stderr text out of status classification", () => {
    const report = buildSandboxReport({
      status: "PASSED",
      output: "\n[STDERR] warning: error text from tool",
      timeoutSeconds: 30,
      port: "4000",
      nodeEnv: "test",
      keepAwake: false,
      powerSaveBlockerType: "prevent-app-suspension",
      startedAt: Date.now(),
      exitCode: 0,
      pid: 123,
    });

    assert.match(report, /Status: PASSED/);
    assert.match(report, /Exit code: 0/);
    assert.match(report, /\[STDERR\] warning: error text from tool/);
  });

  it("reports timeout with stable diagnostics", () => {
    const report = buildSandboxReport({
      status: "TIMED_OUT",
      output: "stalled",
      timeoutSeconds: 30,
      port: "4000",
      nodeEnv: "test",
      keepAwake: false,
      powerSaveBlockerType: "prevent-app-suspension",
      startedAt: Date.now(),
      exitCode: 124,
      pid: 123,
    });

    assert.match(report, /Status: TIMED_OUT/);
    assert.match(report, /PID: 123/);
    assert.match(report, /Duration ms: \d+/);
  });
});

describe("sandbox_run isolated workspace", () => {
  it("runs from a temporary copy without mutating the original workspace", async () => {
    const workspacePath = join(tmpdir(), `mate-x-source-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });
    await writeFile(join(workspacePath, "file.txt"), "original");

    const prepared = await prepareSandboxWorkspace({
      executionMode: "isolated-copy",
      workspacePath,
    });
    await writeFile(join(prepared.runPath, "file.txt"), "mutated");

    assert.equal(await readFile(join(workspacePath, "file.txt"), "utf8"), "original");
    assert.equal(await prepared.cleanup(), "removed_isolated_copy");
    await assert.rejects(() => stat(prepared.runPath));
    await rm(workspacePath, { force: true, recursive: true });
  });

  it("skips heavy generated directories while copying", async () => {
    const workspacePath = join(tmpdir(), `mate-x-source-${Date.now()}`);
    await mkdir(join(workspacePath, "node_modules"), { recursive: true });
    await mkdir(join(workspacePath, ".git"), { recursive: true });
    await writeFile(join(workspacePath, "node_modules", "dep.js"), "dep");
    await writeFile(join(workspacePath, ".git", "HEAD"), "ref");
    await writeFile(join(workspacePath, "app.ts"), "app");

    const prepared = await prepareSandboxWorkspace({
      executionMode: "isolated-copy",
      workspacePath,
    });

    assert.equal(await readFile(join(prepared.runPath, "app.ts"), "utf8"), "app");
    await assert.rejects(() => stat(join(prepared.runPath, "node_modules")));
    await assert.rejects(() => stat(join(prepared.runPath, ".git")));
    await prepared.cleanup();
    await rm(workspacePath, { force: true, recursive: true });
  });
});
