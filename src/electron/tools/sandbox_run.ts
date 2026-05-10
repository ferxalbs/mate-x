import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { powerSaveBlocker } from "electron";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";

const ALLOWED_TIMEOUT_SECONDS = [30, 45, 60, 120, 240] as const;
const ALLOWED_OUTPUT_CHARS = [1000, 4000, 8000, 16000] as const;
const LONG_RUNNING_TIMEOUT_SECONDS = 60;
const DEFAULT_EXECUTION_MODE = "direct";
const IGNORED_COPY_NAMES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);
type PowerSaveBlockerType = "prevent-app-suspension" | "prevent-display-sleep";
type SandboxExecutionMode = "direct" | "isolated-copy";
type SandboxStatus =
  | "PASSED"
  | "FAILED"
  | "TIMED_OUT"
  | "START_FAILED"
  | "TERMINATED";

export function parseSandboxCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of command) {
    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (!quote && /[|&;<>`$]/.test(char)) {
      throw new Error(
        "Shell operators are not supported. Provide a direct command and arguments only.",
      );
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unclosed quote in command.");
  }

  if (current) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error("Command is required.");
  }

  return {
    cmd: tokens[0],
    cmdArgs: tokens.slice(1),
  };
}

function resolveAllowedNumber<const T extends readonly number[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(Number(value) as T[number])
    ? (Number(value) as T[number])
    : fallback;
}

function resolvePort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535
    ? String(port)
    : "4000";
}

function resolveNodeEnv(value: unknown) {
  return value === "development" || value === "production" || value === "test"
    ? value
    : "test";
}

function appendOutput(current: string, next: string, maxOutputChars: number) {
  if (current.length >= maxOutputChars) return current;
  return `${current}${next}`.slice(0, maxOutputChars);
}

function resolveKeepAwake(value: unknown, timeoutSeconds: number) {
  return typeof value === "boolean"
    ? value
    : timeoutSeconds >= LONG_RUNNING_TIMEOUT_SECONDS;
}

function resolvePowerSaveBlockerType(value: unknown): PowerSaveBlockerType {
  return value === "prevent-display-sleep"
    ? "prevent-display-sleep"
    : "prevent-app-suspension";
}

function resolveExecutionMode(value: unknown): SandboxExecutionMode {
  return value === "isolated-copy" ? "isolated-copy" : DEFAULT_EXECUTION_MODE;
}

function startPowerSaveBlocker(
  keepAwake: boolean,
  type: PowerSaveBlockerType,
) {
  if (!keepAwake) {
    return undefined;
  }

  try {
    return powerSaveBlocker.start(type);
  } catch {
    return undefined;
  }
}

function stopPowerSaveBlocker(id: number | undefined) {
  if (typeof id !== "number") {
    return;
  }

  try {
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id);
    }
  } catch {
    // Best-effort only. Sandbox result should not fail because power blocker cleanup failed.
  }
}

function killProcessTree(childPid: number | undefined) {
  if (typeof childPid !== "number") {
    return;
  }

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(childPid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }

    process.kill(-childPid, "SIGKILL");
  } catch {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Process already exited or platform refused signal.
    }
  }
}

export function buildSandboxReport(input: {
  status: SandboxStatus;
  executionMode?: SandboxExecutionMode;
  cleanupStatus?: string;
  output: string;
  timeoutSeconds: number;
  port: string;
  nodeEnv: string;
  keepAwake: boolean;
  powerBlockerId?: number;
  powerSaveBlockerType: PowerSaveBlockerType;
  startedAt: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  pid?: number;
}) {
  const durationMs = Date.now() - input.startedAt;
  const exitLine =
    typeof input.exitCode === "number"
      ? `Exit code: ${input.exitCode}`
      : `Signal: ${input.signal ?? "none"}`;

  return [
    "Sandbox Report: Execution completed.",
    `Status: ${input.status}`,
    `Execution mode: ${input.executionMode ?? DEFAULT_EXECUTION_MODE}`,
    input.cleanupStatus ? `Cleanup: ${input.cleanupStatus}` : undefined,
    exitLine,
    `PID: ${input.pid ?? "unknown"}`,
    `Duration ms: ${durationMs}`,
    `Timeout seconds: ${input.timeoutSeconds}`,
    `PORT: ${input.port}`,
    `NODE_ENV: ${input.nodeEnv}`,
    `Keep awake: ${input.keepAwake}`,
    `Power save blocker: ${typeof input.powerBlockerId === "number" ? input.powerSaveBlockerType : "not_active"}`,
    `Output:\n${input.output}`,
  ].filter(Boolean).join("\n");
}

function persistSandboxOutcomeSoon(input: Parameters<typeof persistSandboxOutcome>[0]) {
  void persistSandboxOutcome(input).catch(() => undefined);
}

export async function prepareSandboxWorkspace(input: {
  executionMode: SandboxExecutionMode;
  workspacePath: string;
}) {
  if (input.executionMode === "direct") {
    return {
      runPath: input.workspacePath,
      cleanup: async () => "not_required",
    };
  }

  const runPath = await mkdtemp(join(tmpdir(), "mate-x-sandbox-"));
  await cp(input.workspacePath, runPath, {
    recursive: true,
    filter: (source) => {
      const name = source.split(/[\\/]/).pop() ?? "";
      return (
        !IGNORED_COPY_NAMES.has(name) &&
        !name.endsWith(".log") &&
        !name.endsWith(".map")
      );
    },
  });

  return {
    runPath,
    cleanup: async () => {
      await rm(runPath, { force: true, recursive: true });
      return "removed_isolated_copy";
    },
  };
}

export const sandboxRunnerTool: Tool = {
  name: "sandbox_run",
  description:
    "Runs a direct command in the real workspace as a configurable, time-bounded child process for validation or diagnostics. The agent may choose timeoutSeconds from 30, 45, 60, 120, or 240, and can use Electron powerSaveBlocker keepAwake settings for long or interactive runs. It sets test-like environment variables by default, but it is not a disposable filesystem sandbox: file writes, package-manager mutations, lockfile updates, and generated artifacts can affect the real project when policy allows the command.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The direct command to run in the real workspace, without shell operators (e.g., 'bun run start' or 'node server.js'). Package-manager mutation commands require policy approval because they can modify the project.",
      },
      timeoutSeconds: {
        type: "number",
        enum: [...ALLOWED_TIMEOUT_SECONDS],
        description:
          "Process timeout. Use 30 for quick checks, 45/60 for normal tests, 120/240 for slow builds or integration checks that would otherwise freeze or be killed early.",
      },
      maxOutputChars: {
        type: "number",
        enum: [...ALLOWED_OUTPUT_CHARS],
        description:
          "Maximum combined stdout/stderr characters captured in the report.",
      },
      port: {
        type: "number",
        description:
          "PORT value for commands that start local servers. Must be 1024-65535. Defaults to 4000.",
      },
      nodeEnv: {
        type: "string",
        enum: ["test", "development", "production"],
        description:
          "NODE_ENV for the child process. Defaults to test for validation isolation.",
      },
      keepAwake: {
        type: "boolean",
        description:
          "Use Electron powerSaveBlocker during the run. Defaults to true for timeoutSeconds >= 60 and false for shorter runs.",
      },
      powerSaveBlockerType: {
        type: "string",
        enum: ["prevent-app-suspension", "prevent-display-sleep"],
        description:
          "Electron powerSaveBlocker mode when keepAwake is active. Use prevent-app-suspension for normal long tests; prevent-display-sleep for interactive/browser scenarios that must keep the display awake.",
      },
      executionMode: {
        type: "string",
        enum: ["direct", "isolated-copy"],
        description:
          "Workspace execution mode. direct runs in the real workspace. isolated-copy runs in a temporary copy that excludes node_modules, .git, build outputs, logs, maps, and coverage, then removes it after the run.",
      },
    },
    required: ["command"],
  },
  async execute(args, { workspacePath }) {
    const { command } = args;

    if (!command) return "Error: Command is required.";

    let cmd: string;
    let cmdArgs: string[];

    try {
      ({ cmd, cmdArgs } = parseSandboxCommand(command));
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : "Invalid command."}`;
    }

    const timeoutSeconds = resolveAllowedNumber(
      args.timeoutSeconds,
      ALLOWED_TIMEOUT_SECONDS,
      30,
    );
    const maxOutputChars = resolveAllowedNumber(
      args.maxOutputChars,
      ALLOWED_OUTPUT_CHARS,
      4000,
    );
    const port = resolvePort(args.port);
    const nodeEnv = resolveNodeEnv(args.nodeEnv);
    const keepAwake = resolveKeepAwake(args.keepAwake, timeoutSeconds);
    const executionMode = resolveExecutionMode(args.executionMode);
    const powerSaveBlockerType = resolvePowerSaveBlockerType(
      args.powerSaveBlockerType,
    );

    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    const profile = activeWorkspaceId
      ? await tursoService.getWorkspaceProfile(activeWorkspaceId)
      : null;
    const priorMatches = activeWorkspaceId
      ? await failureMemoryEngine.findSimilarFailures({
          workspaceId: activeWorkspaceId,
          command,
          framework: profile?.testFramework,
          limit: 1,
        })
      : [];

    const priorWarning = priorMatches[0]
      ? [
          "Known similar failure from this workspace:",
          `- Command: ${priorMatches[0].failure.command}`,
          `- Error signature: ${priorMatches[0].failure.errorSignature}`,
          `- Occurrence count: ${priorMatches[0].failure.occurrenceCount}`,
          "Warning: similar failure exists; avoid repeating this command unless the approach changed.",
          "",
        ].join("\n")
      : "";

    let preparedWorkspace: Awaited<ReturnType<typeof prepareSandboxWorkspace>>;
    try {
      preparedWorkspace = await prepareSandboxWorkspace({
        executionMode,
        workspacePath,
      });
    } catch (error) {
      return buildSandboxReport({
        status: "START_FAILED",
        executionMode,
        cleanupStatus: "not_started",
        output: error instanceof Error ? error.message : "Failed to prepare sandbox workspace.",
        timeoutSeconds,
        port,
        nodeEnv,
        keepAwake,
        powerSaveBlockerType,
        startedAt: Date.now(),
        exitCode: 1,
      });
    }

    return new Promise((resolve) => {
      let output = "";
      let finished = false;
      let timedOut = false;
      const startedAt = Date.now();
      const powerBlockerId = startPowerSaveBlocker(
        keepAwake,
        powerSaveBlockerType,
      );

      const child = spawn(cmd, cmdArgs, {
        cwd: preparedWorkspace.runPath,
        env: { ...process.env, PORT: port, NODE_ENV: nodeEnv },
        detached: process.platform !== "win32",
        windowsHide: true,
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output = appendOutput(output, text, maxOutputChars);
      });

      child.stderr.on("data", (data) => {
        const err = data.toString();
        output = appendOutput(output, `\\n[STDERR] ${err}`, maxOutputChars);
      });

      const finish = async (
        reportInput: Omit<
          Parameters<typeof buildSandboxReport>[0],
          "cleanupStatus"
        >,
        exitCode?: number,
      ) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        stopPowerSaveBlocker(powerBlockerId);
        let cleanupStatus: string;
        try {
          cleanupStatus = await preparedWorkspace.cleanup();
        } catch (error) {
          cleanupStatus = `failed: ${error instanceof Error ? error.message : "unknown"}`;
        }

        if (activeWorkspaceId) {
          persistSandboxOutcomeSoon({
              workspaceId: activeWorkspaceId,
              command,
              exitCode,
              framework: profile?.testFramework,
              output,
              priorFailureId: priorMatches[0]?.failure.id,
          });
        }

        resolve(`${priorWarning}${buildSandboxReport({
          ...reportInput,
          cleanupStatus,
        })}`);
      };

      child.on("error", (error) => {
        output = appendOutput(output, `\n[ERROR] ${error.message}`, maxOutputChars);
        void finish(
          {
            status: "START_FAILED",
            executionMode,
            output: error.message,
            timeoutSeconds,
            port,
            nodeEnv,
            keepAwake,
            powerBlockerId,
            powerSaveBlockerType,
            startedAt,
            exitCode: 1,
            pid: child.pid,
          },
          1,
        );
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
        void finish(
          {
            status: "TIMED_OUT",
            executionMode,
            output: `${output}\n\nThe sandbox terminated the process tree after ${timeoutSeconds} seconds.`,
            timeoutSeconds,
            port,
            nodeEnv,
            keepAwake,
            powerBlockerId,
            powerSaveBlockerType,
            startedAt,
            exitCode: 124,
            pid: child.pid,
          },
          124,
        );
      }, timeoutSeconds * 1000);

      child.on("close", (code, signal) => {
        if (timedOut) {
          return;
        }

        const status: SandboxStatus =
          code === 0 ? "PASSED" : signal ? "TERMINATED" : "FAILED";

        void finish(
          {
            status,
            executionMode,
            output,
            timeoutSeconds,
            port,
            nodeEnv,
            keepAwake,
            powerBlockerId,
            powerSaveBlockerType,
            startedAt,
            exitCode: code,
            signal,
            pid: child.pid,
          },
          code ?? undefined,
        );
      });
    });
  },
};

async function persistSandboxOutcome(input: {
  workspaceId: string;
  command: string;
  exitCode?: number;
  framework?: string;
  output: string;
  priorFailureId?: string;
}) {
  if (input.exitCode === 0) {
    return input.priorFailureId
      ? failureMemoryEngine.recordResolution({
          workspaceId: input.workspaceId,
          failureId: input.priorFailureId,
          retryFixed: true,
          attemptedFix: "sandbox_run exited 0.",
        })
      : undefined;
  }

  return failureMemoryEngine.recordFailure({
    workspaceId: input.workspaceId,
    command: input.command,
    exitCode: input.exitCode,
    framework: input.framework,
    output: input.output,
    attemptedFix: input.priorFailureId
      ? "Repeated via sandbox_run after prior similar failure."
      : undefined,
    retryFixed: false,
  });
}
