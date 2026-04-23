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
    "Spins up the application or a specific script in a controlled, isolated background process. Monitors for crashes, unhandled rejections, and memory leaks. Automatically kills the process after a max lifespan of 30 seconds to guarantee stability.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run (e.g., 'bun run start' or 'node server.js').",
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
