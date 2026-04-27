import { spawn } from "node:child_process";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";

const ALLOWED_TIMEOUT_SECONDS = [30, 45, 60, 120, 240] as const;
const ALLOWED_OUTPUT_CHARS = [1000, 4000, 8000, 16000] as const;

function parseCommand(command: string) {
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

export const sandboxRunnerTool: Tool = {
  name: "sandbox_run",
  description:
    "Runs a direct command in the real workspace as a configurable, time-bounded child process for validation or diagnostics. The agent may choose timeoutSeconds from 30, 45, 60, 120, or 240. It sets test-like environment variables by default, but it is not a disposable filesystem sandbox: file writes, package-manager mutations, lockfile updates, and generated artifacts can affect the real project when policy allows the command.",
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
    },
    required: ["command"],
  },
  async execute(args, { workspacePath }) {
    const { command } = args;

    if (!command) return "Error: Command is required.";

    let cmd: string;
    let cmdArgs: string[];

    try {
      ({ cmd, cmdArgs } = parseCommand(command));
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

    return new Promise((resolve) => {
      let output = "";
      let crashed = false;
      let finished = false;

      const child = spawn(cmd, cmdArgs, {
        cwd: workspacePath,
        env: { ...process.env, PORT: port, NODE_ENV: nodeEnv },
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output = appendOutput(output, text, maxOutputChars);
      });

      child.stderr.on("data", (data) => {
        const err = data.toString();
        output = appendOutput(output, `\\n[STDERR] ${err}`, maxOutputChars);
        if (err.toLowerCase().includes("error") || err.toLowerCase().includes("trace")) {
          crashed = true;
        }
      });

      const finish = async (report: string, exitCode?: number) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        const failureMemory = activeWorkspaceId
          ? await persistSandboxOutcome({
              workspaceId: activeWorkspaceId,
              command,
              exitCode,
              framework: profile?.testFramework,
              output,
              priorFailureId: priorMatches[0]?.failure.id,
            })
          : undefined;

        const memoryReport = failureMemory
          ? [
              "",
              "Failure Memory:",
              `- ID: ${failureMemory.id}`,
              `- Error signature: ${failureMemory.errorSignature}`,
              `- Occurrence count: ${failureMemory.occurrenceCount}`,
              failureMemory.occurrenceCount > 1
                ? "- Warning: same failure repeated. Change approach before retrying."
                : undefined,
            ].filter(Boolean).join("\n")
          : "";

        resolve(`${priorWarning}${report}${memoryReport}`);
      };

      child.on("error", (error) => {
        output = appendOutput(output, `\n[ERROR] ${error.message}`, maxOutputChars);
        finish(
          `Sandbox Report: Failed to start process.\nStatus: CRASH DETECTED\nOutput:\n${error.message}`,
          1,
        );
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(
          [
            "Sandbox Report: Execution completed.",
            `Status: ${crashed ? "CRASH DETECTED" : "STABLE"}`,
            `Timeout seconds: ${timeoutSeconds}`,
            `PORT: ${port}`,
            `NODE_ENV: ${nodeEnv}`,
            `Output:\n${output}`,
            "",
            `The sandbox cleanly terminated the process after ${timeoutSeconds} seconds.`,
          ].join("\\n"),
          crashed ? 1 : 0,
        );
      }, timeoutSeconds * 1000);

      child.on("close", (code) => {
        finish(
          [
            `Sandbox Report: Process exited with code ${code}.`,
            `Status: ${code === 0 ? "STABLE (Finished)" : "CRASH DETECTED"}`,
            `Timeout seconds: ${timeoutSeconds}`,
            `PORT: ${port}`,
            `NODE_ENV: ${nodeEnv}`,
            `Output:\n${output}`,
          ].join("\\n"),
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
