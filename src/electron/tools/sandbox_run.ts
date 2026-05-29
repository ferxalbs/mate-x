import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { powerSaveBlocker } from "electron";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import { buildToolProcessEnv, killProcessTree, parseDirectCommand } from "./process";

const ALLOWED_TIMEOUT_SECONDS = [30, 45, 60, 120, 240] as const;
const ALLOWED_OUTPUT_CHARS = [1000, 4000, 8000, 16000] as const;
const LONG_RUNNING_TIMEOUT_SECONDS = 60;
const DEFAULT_EXECUTION_MODE = "isolated-copy";
const MAX_ISOLATED_COPY_BYTES = 500 * 1024 * 1024;
const MAX_ISOLATED_COPY_FILES = 50_000;
const IGNORED_COPY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".venv",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);
const IGNORED_COPY_SUFFIXES = [".log", ".map"];
const sandboxRunQueues = new Map<string, Promise<void>>();
type PowerSaveBlockerType = "prevent-app-suspension" | "prevent-display-sleep";
type SandboxExecutionMode = "direct" | "isolated-copy";
type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn";
type SandboxStatus =
  | "PASSED"
  | "FAILED"
  | "TIMED_OUT"
  | "START_FAILED"
  | "TERMINATED";

export function parseSandboxCommand(command: string) {
  return parseDirectCommand(command);
}

async function isExecutableFile(path: string) {
  try {
    await access(path, constants.X_OK);
    const pathStat = await stat(path);
    return pathStat.isFile();
  } catch {
    return false;
  }
}

function pathEnvEntries(env: NodeJS.ProcessEnv) {
  return (env.PATH ?? env.Path ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean);
}

function executableNames(command: string) {
  if (process.platform !== "win32") {
    return [command];
  }

  if (/\.(exe|cmd|bat)$/i.test(command)) {
    return [command];
  }

  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

async function lookupExecutableOnPath(command: string, env: NodeJS.ProcessEnv) {
  if (command.includes("/") || command.includes("\\")) {
    return await isExecutableFile(command) ? command : undefined;
  }

  for (const entry of pathEnvEntries(env)) {
    for (const executableName of executableNames(command)) {
      const candidate = join(entry, executableName);
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

async function lookupBunExecutableOnPath(env: NodeJS.ProcessEnv) {
  for (const entry of pathEnvEntries(env)) {
    if (entry.split(/[\\/]/).slice(-2).join("/") === "node_modules/.bin") {
      continue;
    }

    const candidate = join(entry, process.platform === "win32" ? "bun.exe" : "bun");
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function packageManagerForCommand(command: string): PackageManagerName | undefined {
  const name = basename(command).replace(/\.(cmd|exe|bat)$/i, "");
  return name === "bun" || name === "npm" || name === "pnpm" || name === "yarn"
    ? name
    : undefined;
}

function isBunProcessPath(path: string | undefined) {
  return path ? basename(path).toLowerCase().startsWith("bun") : false;
}

export async function resolveSandboxExecutable(input: {
  cmd: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const packageManager = packageManagerForCommand(input.cmd);

  if (packageManager === "bun") {
    const bunInstall = env.BUN_INSTALL;
    const bunInstallCandidate = bunInstall
      ? join(bunInstall, "bin", process.platform === "win32" ? "bun.exe" : "bun")
      : undefined;
    if (bunInstallCandidate && await isExecutableFile(bunInstallCandidate)) {
      return { executable: bunInstallCandidate, packageManager };
    }

    const pathCandidate = await lookupBunExecutableOnPath(env);
    if (pathCandidate) {
      return { executable: pathCandidate, packageManager };
    }

    if (isBunProcessPath(process.execPath) && await isExecutableFile(process.execPath)) {
      return { executable: process.execPath, packageManager };
    }
  }

  const executable = await lookupExecutableOnPath(input.cmd, env);
  return {
    executable: executable ?? input.cmd,
    packageManager,
  };
}

function resolveSandboxCommand(input: { command: unknown; args: unknown }) {
  if (typeof input.command !== "string" || input.command.trim() === "") {
    throw new Error("Command is required.");
  }

  if (Array.isArray(input.args)) {
    if (/[|&;<>`$]/.test(input.command) || /\s/.test(input.command.trim())) {
      throw new Error(
        "When args is provided, command must be only the executable name or path.",
      );
    }

    return {
      cmd: input.command.trim(),
      cmdArgs: input.args.map((arg) => String(arg)),
    };
  }

  return parseSandboxCommand(input.command);
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

function formatStartFailure(error: Error, command: string) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return `${error.message}\nExecutable not found. Use an installed binary on PATH, or pass command plus args explicitly.`;
  }
  if (code === "ENOEXEC") {
    return `${error.message}\nExecutable format invalid. Use a real executable with a shebang, or run the interpreter directly with args.`;
  }
  return `${error.message}\nCommand was parsed as direct exec: ${command}`;
}

export function isPackageManagerMutationCommand(command: string) {
  return /\b(bun|npm|pnpm|yarn)\s+(add|install|i|update|upgrade|remove|uninstall)\b/i.test(
    command,
  );
}

export function resolveSandboxExecutionMode(input: {
  command: string;
  requestedMode: unknown;
}) {
  if (
    input.requestedMode === undefined &&
    isPackageManagerMutationCommand(input.command)
  ) {
    return "isolated-copy";
  }

  return resolveExecutionMode(input.requestedMode);
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

async function acquireSandboxRunSlot(workspacePath: string) {
  const previousRun = sandboxRunQueues.get(workspacePath) ?? Promise.resolve();
  let releaseCurrentRun: () => void = () => undefined;
  const currentRun = new Promise<void>((resolve) => {
    releaseCurrentRun = resolve;
  });
  const queuedRun = previousRun.catch((): undefined => undefined).then(() => currentRun);

  sandboxRunQueues.set(workspacePath, queuedRun);
  await previousRun.catch((): undefined => undefined);

  let released = false;
  return () => {
    if (released) {
      return;
    }

    released = true;
    releaseCurrentRun();
    void queuedRun.finally(() => {
      if (sandboxRunQueues.get(workspacePath) === queuedRun) {
        sandboxRunQueues.delete(workspacePath);
      }
    });
  };
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
  prepareDurationMs?: number;
  cleanupDurationMs?: number;
  copiedFileCount?: number;
  copiedBytes?: number;
  resolvedExecutable?: string;
  args?: string[];
  cwd?: string;
  timedOut?: boolean;
  spawnErrorCode?: string;
  packageManager?: PackageManagerName;
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
    input.packageManager ? `Package manager: ${input.packageManager}` : undefined,
    input.resolvedExecutable ? `Resolved executable: ${input.resolvedExecutable}` : undefined,
    input.args ? `Args: ${JSON.stringify(input.args)}` : undefined,
    input.cwd ? `CWD: ${input.cwd}` : undefined,
    `Timed out: ${input.timedOut ?? input.status === "TIMED_OUT"}`,
    input.spawnErrorCode ? `Spawn error code: ${input.spawnErrorCode}` : undefined,
    input.cleanupStatus ? `Cleanup: ${input.cleanupStatus}` : undefined,
    exitLine,
    `PID: ${input.pid ?? "unknown"}`,
    `Duration ms: ${durationMs}`,
    `Timeout seconds: ${input.timeoutSeconds}`,
    `PORT: ${input.port}`,
    `NODE_ENV: ${input.nodeEnv}`,
    `Keep awake: ${input.keepAwake}`,
    `Power save blocker: ${typeof input.powerBlockerId === "number" ? input.powerSaveBlockerType : "not_active"}`,
    typeof input.prepareDurationMs === "number"
      ? `Prepare duration ms: ${input.prepareDurationMs}`
      : undefined,
    typeof input.cleanupDurationMs === "number"
      ? `Cleanup duration ms: ${input.cleanupDurationMs}`
      : undefined,
    typeof input.copiedFileCount === "number"
      ? `Copied files: ${input.copiedFileCount}`
      : undefined,
    typeof input.copiedBytes === "number"
      ? `Copied bytes: ${input.copiedBytes}`
      : undefined,
    `Output:\n${input.output}`,
  ].filter(Boolean).join("\n");
}

function persistSandboxOutcomeSoon(input: Parameters<typeof persistSandboxOutcome>[0]) {
  void persistSandboxOutcome(input).catch((): undefined => undefined);
}

function commandMatchesPlannedValidation(
  command: string,
  validationPlan: Awaited<ReturnType<typeof tursoService.getLatestValidationPlan>>,
) {
  const normalizedCommand = command.trim();
  if (!validationPlan) {
    return undefined;
  }

  if (normalizedCommand === validationPlan.primary.command.trim()) {
    return "primary" as const;
  }

  if (normalizedCommand === validationPlan.fallback.command.trim()) {
    return "fallback" as const;
  }

  return undefined;
}

export async function prepareSandboxWorkspace(input: {
  executionMode: SandboxExecutionMode;
  workspacePath: string;
}) {
  if (input.executionMode === "direct") {
    return {
      runPath: input.workspacePath,
      prepareDurationMs: 0,
      copiedFileCount: 0,
      copiedBytes: 0,
      cleanup: async () => ({ status: "not_required", durationMs: 0 }),
    };
  }

  const prepareStartedAt = Date.now();
  const runPath = await mkdtemp(join(tmpdir(), "mate-x-sandbox-"));
  let copiedFileCount = 0;
  let copiedBytes = 0;

  const copyEntries = async (sourceDir: string) => {
    const entries = await readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      if (
        IGNORED_COPY_NAMES.has(entry.name) ||
        IGNORED_COPY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
      ) {
        continue;
      }

      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(runPath, relative(input.workspacePath, sourcePath));

      if (entry.isDirectory()) {
        await copyEntries(sourcePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const sourceStat = await stat(sourcePath);
      const nextFileCount = copiedFileCount + 1;
      const nextByteCount = copiedBytes + sourceStat.size;
      if (
        nextFileCount > MAX_ISOLATED_COPY_FILES ||
        nextByteCount > MAX_ISOLATED_COPY_BYTES
      ) {
        throw new Error(
          [
            "Isolated copy budget exceeded.",
            `Copied files: ${copiedFileCount}/${MAX_ISOLATED_COPY_FILES}.`,
            `Copied bytes: ${copiedBytes}/${MAX_ISOLATED_COPY_BYTES}.`,
            "Request explicit policy approval for executionMode direct or narrow the workspace before retrying.",
          ].join(" "),
        );
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      copiedFileCount = nextFileCount;
      copiedBytes = nextByteCount;
    }
  };

  try {
    await copyEntries(input.workspacePath);
  } catch (error) {
    await rm(runPath, { force: true, recursive: true });
    throw error;
  }

  const prepareDurationMs = Date.now() - prepareStartedAt;

  return {
    runPath,
    prepareDurationMs,
    copiedFileCount,
    copiedBytes,
    cleanup: async () => {
      const cleanupStartedAt = Date.now();
      await rm(runPath, { force: true, recursive: true });
      return {
        status: "removed_isolated_copy",
        durationMs: Date.now() - cleanupStartedAt,
      };
    },
  };
}

export const sandboxRunnerTool: Tool = {
  name: "sandbox_run",
  description:
    "Runs a configurable, time-bounded child process for validation or diagnostics. Defaults to executionMode isolated-copy, which runs in a temporary workspace copy and removes it afterward. executionMode direct runs in the real workspace and requires policy approval because file writes, package-manager mutations, lockfile updates, and generated artifacts can affect the real project.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Direct executable command, optionally with simple whitespace-separated args. Shell operators are rejected. Prefer command plus args for precision.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional explicit argv list. When provided, command must be only the executable name or path, e.g. command 'bun', args ['run', 'typecheck'].",
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
      ({ cmd, cmdArgs } = resolveSandboxCommand({
        command,
        args: args.args,
      }));
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
    const executionMode = resolveSandboxExecutionMode({
      command,
      requestedMode: args.executionMode,
    });
    const powerSaveBlockerType = resolvePowerSaveBlockerType(
      args.powerSaveBlockerType,
    );
    const childEnv = buildToolProcessEnv({ PORT: port, NODE_ENV: nodeEnv });
    const resolvedCommand = await resolveSandboxExecutable({
      cmd,
      env: childEnv,
    });

    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    const profile = activeWorkspaceId
      ? await tursoService.getWorkspaceProfile(activeWorkspaceId)
      : null;
    const validationPlan = activeWorkspaceId
      ? await tursoService.getLatestValidationPlan(activeWorkspaceId)
      : null;
    const plannedValidationCommand = commandMatchesPlannedValidation(
      command,
      validationPlan,
    );
    const priorMatches = activeWorkspaceId
      ? await failureMemoryEngine.findSimilarFailures({
          workspaceId: activeWorkspaceId,
          command,
          framework: validationPlan?.detectedFramework ?? profile?.testFramework,
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

    const releaseSandboxRunSlot = await acquireSandboxRunSlot(workspacePath);
    let preparedWorkspace: Awaited<ReturnType<typeof prepareSandboxWorkspace>>;
    try {
      preparedWorkspace = await prepareSandboxWorkspace({
        executionMode,
        workspacePath,
      });
    } catch (error) {
      releaseSandboxRunSlot();
      return buildSandboxReport({
        status: "START_FAILED",
        executionMode,
        cleanupStatus: "not_started",
        prepareDurationMs: 0,
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
      const timerRef: { current?: NodeJS.Timeout } = {};
      const startedAt = Date.now();
      const powerBlockerId = startPowerSaveBlocker(
        keepAwake,
        powerSaveBlockerType,
      );

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
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        stopPowerSaveBlocker(powerBlockerId);
        let cleanupStatus: string;
        let cleanupDurationMs = 0;
        try {
          const cleanup = await preparedWorkspace.cleanup();
          cleanupStatus = cleanup.status;
          cleanupDurationMs = cleanup.durationMs;
        } catch (error) {
          cleanupStatus = `failed: ${error instanceof Error ? error.message : "unknown"}`;
        }
        releaseSandboxRunSlot();

        if (activeWorkspaceId) {
          if (plannedValidationCommand) {
            await tursoService.addValidationRun({
              workspaceId: activeWorkspaceId,
              command: command.trim(),
              scope: `sandbox_run:${plannedValidationCommand}`,
              exitCode,
              status: exitCode === 0 ? "success" : "failed",
              outputSummary: output.slice(0, 5000),
              failingTests: exitCode === 0 ? [] : [output.slice(0, 500)],
              validationPlan: validationPlan ?? undefined,
            });
          }

          persistSandboxOutcomeSoon({
              workspaceId: activeWorkspaceId,
              command,
              exitCode,
              framework: validationPlan?.detectedFramework ?? profile?.testFramework,
              output,
              priorFailureId: priorMatches[0]?.failure.id,
          });
        }

        resolve(`${priorWarning}${buildSandboxReport({
          ...reportInput,
          cleanupStatus,
          cleanupDurationMs,
          prepareDurationMs: preparedWorkspace.prepareDurationMs,
          copiedFileCount: preparedWorkspace.copiedFileCount,
          copiedBytes: preparedWorkspace.copiedBytes,
        })}`);
      };

      const finishStartFailure = (error: Error, pid?: number) => {
        const failure = formatStartFailure(error, command);
        const spawnErrorCode = (error as NodeJS.ErrnoException).code;
        output = appendOutput(output, `\n[ERROR] ${failure}`, maxOutputChars);
        void finish(
          {
            status: "START_FAILED",
            executionMode,
            output: failure,
            timeoutSeconds,
            port,
            nodeEnv,
            keepAwake,
            powerBlockerId,
            powerSaveBlockerType,
            startedAt,
            exitCode: 1,
            pid,
            resolvedExecutable: resolvedCommand.executable,
            args: cmdArgs,
            cwd: preparedWorkspace.runPath,
            timedOut: false,
            spawnErrorCode,
            packageManager: resolvedCommand.packageManager,
          },
          1,
        );
      };

      let childStarted = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(resolvedCommand.executable, cmdArgs, {
          cwd: preparedWorkspace.runPath,
          env: childEnv,
          detached: process.platform !== "win32",
          windowsHide: true,
        });
      } catch (error) {
        finishStartFailure(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      child.stdout?.on("data", (data) => {
        const text = data.toString();
        output = appendOutput(output, text, maxOutputChars);
      });

      child.stderr?.on("data", (data) => {
        const err = data.toString();
        output = appendOutput(output, `\\n[STDERR] ${err}`, maxOutputChars);
      });

      child.on("error", (error) => {
        finishStartFailure(error, child.pid);
      });

      child.on("spawn", () => {
        childStarted = true;
      });

      timerRef.current = setTimeout(() => {
        timedOut = true;
        if (childStarted) {
          killProcessTree(child.pid);
        }
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
            resolvedExecutable: resolvedCommand.executable,
            args: cmdArgs,
            cwd: preparedWorkspace.runPath,
            timedOut: true,
            packageManager: resolvedCommand.packageManager,
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
            resolvedExecutable: resolvedCommand.executable,
            args: cmdArgs,
            cwd: preparedWorkspace.runPath,
            timedOut: false,
            packageManager: resolvedCommand.packageManager,
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
