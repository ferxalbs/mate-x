import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore Bun exposes mock at runtime; installed TS types omit it.
import { describe, mock, test } from "bun:test";

const validationRuns: any[] = [];
let activeWorkspaceId: string | null = null;
let latestValidationPlan: any = null;

(mock as any).module("electron", () => ({
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: () => undefined,
  },
}));

(mock as any).module("../failure-memory-engine", () => ({
  failureMemoryEngine: {
    findSimilarFailures: async () => [],
    recordFailure: async () => undefined,
    recordResolution: async () => undefined,
  },
}));

(mock as any).module("../turso-service", () => ({
  tursoService: {
    getActiveWorkspaceId: async () => activeWorkspaceId,
    getWorkspaceProfile: async () => null,
    getLatestValidationPlan: async () => latestValidationPlan,
    addValidationRun: async (run: any) => {
      const savedRun = { ...run, id: `val-${validationRuns.length + 1}` };
      validationRuns.push(savedRun);
      return savedRun;
    },
  },
}));

const {
  buildSandboxReport,
  isPackageManagerMutationCommand,
  parseSandboxCommand,
  prepareSandboxWorkspace,
  resolveSandboxExecutable,
  resolveSandboxExecutionMode,
  sandboxRunnerTool,
} = await import("./sandbox_run");

describe("sandbox_run command parsing", () => {
  test("parses a direct command with quoted args", () => {
    assert.deepEqual(parseSandboxCommand('bun run test "src/foo bar.test.ts"'), {
      cmd: "bun",
      cmdArgs: ["run", "test", "src/foo bar.test.ts"],
    });
  });

  test("rejects shell operators", () => {
    assert.throws(
      () => parseSandboxCommand("bun test && rm -rf dist"),
      /Shell operators are not supported/,
    );
  });

  test("rejects empty commands", () => {
    assert.throws(() => parseSandboxCommand("   "), /Command is required/);
  });

  test("parses bun validation commands as executable plus args", () => {
    assert.deepEqual(parseSandboxCommand("bun run lint"), {
      cmd: "bun",
      cmdArgs: ["run", "lint"],
    });
  });
});

describe("sandbox_run executable resolution", () => {
  test("prefers a real bun binary over a local node_modules shim", async () => {
    const workspacePath = join(tmpdir(), `mate-x-bun-resolve-${Date.now()}`);
    const localBin = join(workspacePath, "node_modules", ".bin");
    const realBin = join(workspacePath, "real-bin");
    await mkdir(localBin, { recursive: true });
    await mkdir(realBin, { recursive: true });
    const brokenShim = join(localBin, "bun");
    const realBun = join(realBin, "bun");
    await writeFile(brokenShim, "not a native executable");
    await writeFile(realBun, "#!/bin/sh\nexit 0\n");
    await chmod(brokenShim, 0o755);
    await chmod(realBun, 0o755);

    const resolved = await resolveSandboxExecutable({
      cmd: "bun",
      env: {
        PATH: `${localBin}:${realBin}`,
      },
    });

    assert.equal(resolved.executable, realBun);
    assert.equal(resolved.packageManager, "bun");
    await rm(workspacePath, { force: true, recursive: true });
  });
});

describe("sandbox_run command risk detection", () => {
  test("detects package-manager mutations", () => {
    assert.equal(isPackageManagerMutationCommand("bun add lodash"), true);
    assert.equal(isPackageManagerMutationCommand("npm install react"), true);
    assert.equal(isPackageManagerMutationCommand("pnpm test"), false);
  });

  test("defaults commands to isolated-copy unless caller explicitly selects direct", () => {
    assert.equal(
      resolveSandboxExecutionMode({
        command: "pnpm test",
        requestedMode: undefined,
      }),
      "isolated-copy",
    );
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
  test("keeps stderr text out of status classification", () => {
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

  test("reports timeout with stable diagnostics", () => {
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

describe("sandbox_run execution failures", () => {
  test("returns immediately on ENOEXEC and does not timeout", async () => {
    const workspacePath = join(tmpdir(), `mate-x-enoexec-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });
    const badExecutable = join(workspacePath, "bad-exec");
    await writeFile(badExecutable, "not a script");
    await chmod(badExecutable, 0o755);

    const startedAt = Date.now();
    const result = await sandboxRunnerTool.execute(
      { command: badExecutable, timeoutSeconds: 30 },
      { workspacePath } as any,
    );

    assert.equal(Date.now() - startedAt < 2000, true);
    assert.match(result, /Status: START_FAILED/);
    assert.match(result, /Spawn error code: ENOEXEC/);
    assert.match(result, /Timed out: false/);
    assert.doesNotMatch(result, /Status: TIMED_OUT/);
    await rm(workspacePath, { force: true, recursive: true });
  });

  test("returns immediately on ENOENT and does not timeout", async () => {
    const workspacePath = join(tmpdir(), `mate-x-enoent-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });

    const startedAt = Date.now();
    const result = await sandboxRunnerTool.execute(
      { command: "mate-x-missing-command", timeoutSeconds: 30 },
      { workspacePath } as any,
    );

    assert.equal(Date.now() - startedAt < 2000, true);
    assert.match(result, /Status: START_FAILED/);
    assert.match(result, /Spawn error code: ENOENT/);
    assert.match(result, /Timed out: false/);
    assert.doesNotMatch(result, /Status: TIMED_OUT/);
    await rm(workspacePath, { force: true, recursive: true });
  });

  test("runs a successful bun validation command", async () => {
    const workspacePath = join(tmpdir(), `mate-x-bun-success-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });

    const result = await sandboxRunnerTool.execute(
      { command: "bun --version", timeoutSeconds: 30 },
      { workspacePath } as any,
    );

    assert.match(result, /Status: PASSED/);
    assert.match(result, /Package manager: bun/);
    assert.match(result, /Args: \["--version"\]/);
    await rm(workspacePath, { force: true, recursive: true });
  });

  test("persists planned sandbox validation runs", async () => {
    const workspacePath = join(tmpdir(), `mate-x-sandbox-persist-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });
    validationRuns.length = 0;
    activeWorkspaceId = "workspace-test";
    latestValidationPlan = {
      id: "plan-test",
      primary: { command: "bun --version" },
      fallback: { command: "bun --version" },
      riskLevel: "medium",
    };

    const result = await sandboxRunnerTool.execute(
      { command: "bun --version", timeoutSeconds: 30 },
      { workspacePath } as any,
    );

    assert.match(result, /Status: PASSED/);
    assert.equal(validationRuns.length, 1);
    assert.equal(validationRuns[0].workspaceId, "workspace-test");
    assert.equal(validationRuns[0].command, "bun --version");
    assert.equal(validationRuns[0].scope, "sandbox_run:primary");
    assert.equal(validationRuns[0].status, "success");
    assert.equal(validationRuns[0].validationPlan.id, "plan-test");
    activeWorkspaceId = null;
    latestValidationPlan = null;
    await rm(workspacePath, { force: true, recursive: true });
  });
});

describe("sandbox_run isolated workspace", () => {
  test("runs from a temporary copy without mutating the original workspace", async () => {
    const workspacePath = join(tmpdir(), `mate-x-source-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });
    await writeFile(join(workspacePath, "file.txt"), "original");

    const prepared = await prepareSandboxWorkspace({
      executionMode: "isolated-copy",
      workspacePath,
    });
    await writeFile(join(prepared.runPath, "file.txt"), "mutated");

    assert.equal(await readFile(join(workspacePath, "file.txt"), "utf8"), "original");
    const cleanup = await prepared.cleanup();
    assert.equal(cleanup.status, "removed_isolated_copy");
    assert.equal(typeof cleanup.durationMs, "number");
    await assert.rejects(() => stat(prepared.runPath));
    await rm(workspacePath, { force: true, recursive: true });
  });

  test("skips heavy generated directories while copying", async () => {
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
