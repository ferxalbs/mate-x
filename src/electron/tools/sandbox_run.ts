import { spawn } from "node:child_process";
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
  async execute(args, { workspacePath, settings }) {
    const { command } = args;

    if (!command) return "Error: Command is required.";

    let cmd: string;
    let cmdArgs: string[];

    try {
      ({ cmd, cmdArgs } = parseCommand(command));
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : "Invalid command."}`;
    }

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

      const finish = (report: string) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        resolve(report);
      };

      child.on("error", (error) => {
        finish(
          `Sandbox Report: Failed to start process.\nStatus: CRASH DETECTED\nOutput:\n${error.message}`,
        );
      });

      // Strict 30-second kill switch
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(
          `Sandbox Report: Execution completed.\\nStatus: ${crashed ? "CRASH DETECTED" : "STABLE"}\\nOutput:\\n${output.slice(0, 1000)}...\\n\\nThe sandbox cleanly terminated the process after 30 seconds.`,
        );
      }, 30000);

      child.on("close", (code) => {
        finish(
          `Sandbox Report: Process exited prematurely with code ${code}.\\nStatus: ${code === 0 ? "STABLE (Finished)" : "CRASH DETECTED"}\\nOutput:\\n${output.slice(0, 1000)}...`,
        );
      });
    });
  },
};
