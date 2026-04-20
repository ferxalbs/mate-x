import { spawn } from "node:child_process";
import { BrowserWindow } from "electron";

import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";

export const runTestsTool: Tool = {
  name: "run_tests",
  description:
    "Runs tests in the workspace based on the resolved validation profile. It streams output to the UI and returns a structured JSON summary. Supported scopes: changed-files, specific path, full-suite, rerun-failed.",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["full-suite", "changed-files", "rerun-failed", "specific-path"],
        description: "The scope of the tests to run."
      },
      specificPath: {
        type: "string",
        description: "The specific file or directory to test, if scope is specific-path."
      }
    },
    required: ["scope"],
  },
  execute: async (args: { scope: string; specificPath?: string }, context: { workspacePath: string }) => {
    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return JSON.stringify({ error: "No active workspace ID found." });
    }

    const profile = await tursoService.getWorkspaceProfile(activeWorkspaceId);
    if (!profile || !profile.testCommand) {
      return JSON.stringify({
        error: "Validation profile or test command not found. Run detect_workspace_capabilities first."
      });
    }

    let command = profile.testCommand;

    // Minimal heuristic appending of scope paths/flags
    if (args.scope === "specific-path" && args.specificPath) {
      if (/[\n|&;<>`$()]/.test(args.specificPath)) {
        return JSON.stringify({ error: "Invalid characters in specificPath. Shell operators are not allowed." });
      }
      command += ` "${args.specificPath.replace(/"/g, '\\"')}"`;
    } else if (args.scope === "rerun-failed") {
      // Get the last validation run's failing tests if available
      const runs = await tursoService.getRecentValidationRuns(activeWorkspaceId, 1);
      const failingTests = runs[0]?.failingTests;
      if (failingTests && failingTests.length > 0) {
        // Sanitize failing tests for shell injection (avoid command substitutions)
        const sanitizedTests = failingTests.filter(test => !/[`$]/.test(test));
        if (sanitizedTests.length > 0) {
          if (profile.testFramework === "vitest" || profile.testFramework === "jest") {
              // Quote and escape appropriately for safety
              command += ` -t "${sanitizedTests.join('|').replace(/"/g, '\\"')}"`;
          } else if (profile.testFramework === "pytest") {
              command += ` ${sanitizedTests.map(test => `"${test.replace(/"/g, '\\"')}"`).join(' ')}`;
          }
        }
      }
      // If we don't know how to pass failing tests specifically, just run the command.
    } else if (args.scope === "changed-files") {
      if (profile.testFramework === "jest") {
        command += " --onlyChanged";
      } else if (profile.testFramework === "vitest") {
        command += " changed";
      }
    }

    // Include flags
    if (profile.flags) {
      command += ` ${profile.flags}`;
    }

    // Attempt to broadcast stream chunk to UI
    const broadcastStream = (chunk: string) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("test-stream-chunk", {
             workspaceId: activeWorkspaceId,
             timestamp: Date.now(),
             chunk,
          });
        }
      });
    };

    broadcastStream(`\n--- Starting tests: ${command} ---\n`);

    return new Promise((resolve) => {
      let outputSummary = "";

      // Determine shell based on profile or platform defaults
      const isWindows = process.platform === "win32";
      const shellToUse = profile.shell || (isWindows ? "cmd.exe" : "/bin/sh");

      const child = spawn(command, {
        cwd: context.workspacePath,
        shell: shellToUse,
        env: { ...process.env, FORCE_COLOR: "0" } // Request no color for simpler output parsing
      });

      child.stdout.on("data", (data) => {
        const str = data.toString();
        outputSummary += str;
        broadcastStream(str);
      });

      child.stderr.on("data", (data) => {
        const str = data.toString();
        outputSummary += str;
        broadcastStream(str);
      });

      child.on("close", async (code) => {
        broadcastStream(`\n--- Tests completed with exit code ${code} ---\n`);

        // Simple heuristic to extract failing tests
        const failingTests: string[] = [];
        if (code !== 0) {
          const lines = outputSummary.split('\n');
          for (const line of lines) {
             if (line.includes("FAIL") || line.includes("FAILED")) {
               failingTests.push(line.trim());
             }
          }
        }

        const runResult = {
          workspaceId: activeWorkspaceId,
          command,
          scope: args.scope,
          exitCode: code ?? undefined,
          status: code === 0 ? "success" : "failed",
          outputSummary: outputSummary.slice(0, 5000), // Summarize if too long
          failingTests: failingTests.slice(0, 20) // Limit to avoid large db entries
        };

        const savedRun = await tursoService.addValidationRun(runResult);

        resolve(JSON.stringify({
          status: runResult.status,
          exitCode: runResult.exitCode,
          summary: `Test run finished with code ${code}. Saved to run ID ${savedRun.id}.`,
          failingTests: runResult.failingTests,
        }, null, 2));
      });

      child.on("error", (error) => {
         const errorMessage = `Failed to start process: ${error.message}`;
         broadcastStream(`\n${errorMessage}\n`);
         resolve(JSON.stringify({ error: errorMessage }));
      });
    });
  },
};
