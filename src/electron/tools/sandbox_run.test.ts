import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { buildSandboxReport, parseSandboxCommand } from "./sandbox_run";

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
