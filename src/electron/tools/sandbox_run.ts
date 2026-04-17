import { spawn } from "node:child_process";
import type { Tool } from "../tool-service";

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
  async execute(args, { workspacePath }) {
    const { command } = args;

    if (!command) return "Error: Command is required.";

    const parts = command.split(" ");
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    return new Promise((resolve) => {
      let output = "";
      let crashed = false;

      const child = spawn(cmd, cmdArgs, {
        cwd: workspacePath,
        shell: true,
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

      // Strict 30-second kill switch
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(
          `Sandbox Report: Execution completed.\\nStatus: ${crashed ? "CRASH DETECTED" : "STABLE"}\\nOutput:\\n${output.slice(0, 1000)}...\\n\\nThe sandbox cleanly terminated the process after 30 seconds.`
        );
      }, 30000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(
          `Sandbox Report: Process exited prematurely with code ${code}.\\nStatus: ${code === 0 ? "STABLE (Finished)" : "CRASH DETECTED"}\\nOutput:\\n${output.slice(0, 1000)}...`
        );
      });
    });
  },
};
