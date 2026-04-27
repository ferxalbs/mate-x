import { spawn } from "node:child_process";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";

function parseCommand(command: string) {
  if (/[|&;<>`$()]/.test(command)) {
    throw new Error(
      "Shell operators are not supported. Provide a direct command and arguments only.",
    );
  }

  const tokens =
    command.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) =>
      token.replace(/^['"]|['"]$/g, ""),
    ) ?? [];

  if (tokens.length === 0) {
    throw new Error("Command is required.");
  }

  return {
    cmd: tokens[0],
    cmdArgs: tokens.slice(1),
  };
}

export const sandboxRunnerTool: Tool = {
  name: "sandbox_run",
  description:
    "Runs a direct command in the real workspace as a time-bounded child process for validation or diagnostics. It sets test-like environment variables and kills long-running processes after 30 seconds, but it is not a disposable filesystem sandbox: file writes, package-manager mutations, lockfile updates, and generated artifacts can affect the real project when policy allows the command.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The direct command to run in the real workspace, without shell operators (e.g., 'bun run start' or 'node server.js'). Package-manager mutation commands require policy approval because they can modify the project.",
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
        env: { ...process.env, PORT: "4000", NODE_ENV: "test" }, // Isolate ports
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        // Capture initial startup text to prove it's running
        if (output.length < 500) output += text;
      });

      child.stderr.on("data", (data) => {
        const err = data.toString();
        output += `\\n[STDERR] ${err}`;
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
        output += `\n[ERROR] ${error.message}`;
        finish(
          `Sandbox Report: Failed to start process.\nStatus: CRASH DETECTED\nOutput:\n${error.message}`,
          1,
        );
      });

      // Strict 30-second kill switch
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(
          `Sandbox Report: Execution completed.\\nStatus: ${crashed ? "CRASH DETECTED" : "STABLE"}\\nOutput:\\n${output.slice(0, 1000)}...\\n\\nThe sandbox cleanly terminated the process after 30 seconds.`,
          crashed ? 1 : 0,
        );
      }, 30000);

      child.on("close", (code) => {
        finish(
          `Sandbox Report: Process exited prematurely with code ${code}.\\nStatus: ${code === 0 ? "STABLE (Finished)" : "CRASH DETECTED"}\\nOutput:\\n${output.slice(0, 1000)}...`,
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
