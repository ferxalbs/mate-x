import { spawn } from "node:child_process";
import { BrowserWindow } from "electron";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import { killProcessTree, parseDirectCommand } from "./process";

const TEST_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_SUMMARY_CHARS = 120_000;

function appendOutputSummary(current: string, next: string) {
  return `${current}${next}`.slice(-MAX_OUTPUT_SUMMARY_CHARS);
}

function quoteDisplayArg(value: string) {
  return /[\s"'$`|&;<>]/.test(value)
    ? `"${value.replace(/(["\\])/g, "\\$1")}"`
    : value;
}

function parseOptionalArgs(value: string | undefined) {
  if (!value?.trim()) {
    return { args: [] as string[], fallback: "" };
  }

  try {
    return {
      args: parseDirectCommand(`matex ${value}`).cmdArgs,
      fallback: "",
    };
  } catch {
    return {
      args: [] as string[],
      fallback: ` ${value}`,
    };
  }
}

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
      },
      plannedCommand: {
        type: "string",
        enum: ["primary", "fallback"],
        description: "When a validation plan exists, choose the primary or fallback command from that plan."
      }
    },
    required: ["scope"],
  },
  execute: async (args: { scope: string; specificPath?: string; plannedCommand?: "primary" | "fallback" }, context: { workspacePath: string }) => {
    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return JSON.stringify({ error: "No active workspace ID found." });
    }

    const profile = await tursoService.getWorkspaceProfile(activeWorkspaceId);
    const validationPlan = await tursoService.getLatestValidationPlan(activeWorkspaceId);
    if (!validationPlan && (!profile || !profile.testCommand)) {
      return JSON.stringify({
        error: "Validation profile, test command, or validation plan not found. Run detect_workspace_capabilities and plan_validation first."
      });
    }

    const selectedPlanCommand = args.plannedCommand === "fallback"
      ? validationPlan?.fallback
      : validationPlan?.primary;
    const baseCommand = selectedPlanCommand?.command ?? profile?.testCommand;
    const plannedCommandReason = selectedPlanCommand?.reason;
    if (!baseCommand) {
      return JSON.stringify({ error: "No validation command available." });
    }

    const commandArgs: string[] = [];
    let shellFallbackSuffix = "";

    // If a validation plan exists, it is authoritative for command selection.
    if (!validationPlan && args.scope === "specific-path" && args.specificPath) {
      if (/[\n|&;<>`$()]/.test(args.specificPath)) {
        return JSON.stringify({ error: "Invalid characters in specificPath. Shell operators are not allowed." });
      }
      commandArgs.push(args.specificPath);
    } else if (!validationPlan && args.scope === "rerun-failed") {
      // Get the last validation run's failing tests if available
      const runs = await tursoService.getRecentValidationRuns(activeWorkspaceId, 1);
      const failingTests = runs[0]?.failingTests;
      if (failingTests && failingTests.length > 0) {
        // Sanitize failing tests for shell injection (avoid command substitutions)
        const sanitizedTests = failingTests.filter(test => !/[`$]/.test(test));
        if (sanitizedTests.length > 0) {
          if (profile?.testFramework === "vitest" || profile?.testFramework === "jest") {
              commandArgs.push("-t", sanitizedTests.join("|"));
          } else if (profile?.testFramework === "pytest") {
              commandArgs.push(...sanitizedTests);
          }
        }
      }
      // If we don't know how to pass failing tests specifically, just run the command.
    } else if (!validationPlan && args.scope === "changed-files") {
      if (profile?.testFramework === "jest") {
        commandArgs.push("--onlyChanged");
      } else if (profile?.testFramework === "vitest") {
        commandArgs.push("changed");
      }
    }

    // Include flags
    if (!validationPlan && profile?.flags) {
      const parsedFlags = parseOptionalArgs(profile.flags);
      commandArgs.push(...parsedFlags.args);
      shellFallbackSuffix += parsedFlags.fallback;
    }

    const command = [
      baseCommand,
      ...commandArgs.map(quoteDisplayArg),
    ].join(" ") + shellFallbackSuffix;

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
    if (plannedCommandReason) {
      broadcastStream(`Validation plan: ${plannedCommandReason}\n`);
    }

    const priorMatches = await failureMemoryEngine.findSimilarFailures({
      workspaceId: activeWorkspaceId,
      command,
      framework: validationPlan?.detectedFramework ?? profile?.testFramework,
      limit: 1,
    });
    if (priorMatches[0]) {
      broadcastStream(
        `Known similar failure from this workspace: ${priorMatches[0].failure.errorSignature} (${priorMatches[0].failure.occurrenceCount} repeat(s)). Change approach if it repeats.\n`,
      );
    }

    return new Promise((resolve) => {
      let outputSummary = "";
      let timedOut = false;
      let finished = false;

      const isWindows = process.platform === "win32";
      let child;

      try {
        if (profile?.shell || shellFallbackSuffix) {
          child = spawn(command, {
            cwd: context.workspacePath,
            shell: profile?.shell || (isWindows ? "cmd.exe" : "/bin/sh"),
            env: { ...process.env, FORCE_COLOR: "0" },
            detached: !isWindows,
            windowsHide: true,
          });
        } else {
          const parsedCommand = parseDirectCommand(baseCommand);
          child = spawn(parsedCommand.cmd, [...parsedCommand.cmdArgs, ...commandArgs], {
            cwd: context.workspacePath,
            shell: isWindows,
            env: { ...process.env, FORCE_COLOR: "0" },
            detached: !isWindows,
            windowsHide: true,
          });
        }
      } catch (error) {
        resolve(JSON.stringify({ error: (error as Error).message }));
        return;
      }

      child.stdout.on("data", (data) => {
        const str = data.toString();
        outputSummary = appendOutputSummary(outputSummary, str);
        broadcastStream(str);
      });

      child.stderr.on("data", (data) => {
        const str = data.toString();
        outputSummary = appendOutputSummary(outputSummary, str);
        broadcastStream(str);
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        broadcastStream(`\n--- Tests timed out after ${TEST_RUN_TIMEOUT_MS / 1000} seconds ---\n`);
        killProcessTree(child.pid);
      }, TEST_RUN_TIMEOUT_MS);

      child.on("error", (error) => {
        if (finished) {
          return;
        }

        outputSummary = appendOutputSummary(outputSummary, `\n${error.message}`);
      });

      child.on("close", async (code) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
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
          status: code === 0 && !timedOut ? "success" : "failed",
          outputSummary: outputSummary.slice(0, 5000), // Summarize if too long
          failingTests: failingTests.slice(0, 20), // Limit to avoid large db entries
          validationPlan: validationPlan ?? undefined,
        };

        const savedRun = await tursoService.addValidationRun(runResult);
        const failureMemory = code !== 0
          ? await failureMemoryEngine.recordFailure({
              workspaceId: activeWorkspaceId,
              command,
              exitCode: code ?? undefined,
              framework: validationPlan?.detectedFramework ?? profile?.testFramework,
              failingTests: runResult.failingTests,
              output: outputSummary,
              affectedFiles: validationPlan?.changedFiles,
            })
          : priorMatches[0]
            ? await failureMemoryEngine.recordResolution({
                workspaceId: activeWorkspaceId,
                failureId: priorMatches[0].failure.id,
                retryFixed: true,
                attemptedFix: "Validation retry exited 0.",
              })
            : undefined;
        const persistedRun = await tursoService.getValidationRun(savedRun.id);
        const plannedCommand = validationPlan ? args.plannedCommand ?? "primary" : undefined;
        const fallbackRequired = Boolean(
          validationPlan &&
          plannedCommand === "primary" &&
          validationPlan.riskLevel === "high" &&
          validationPlan.primary.command !== validationPlan.fallback.command,
        );
        const validationPersistence = {
          validationRunId: savedRun.id,
          planPersistedWithRun: Boolean(
            validationPlan &&
            persistedRun?.validationPlan?.id === validationPlan.id,
          ),
          planId: validationPlan?.id,
          persistedPlanId: persistedRun?.validationPlan?.id,
        };

        resolve(JSON.stringify({
          status: runResult.status,
          exitCode: runResult.exitCode,
          validationRunId: savedRun.id,
          validationPersistence,
          nextRequiredAction: fallbackRequired
            ? {
                tool: "run_tests",
                arguments: {
                  scope: args.scope,
                  plannedCommand: "fallback",
                },
                reason: validationPlan?.fallbackTrigger,
              }
            : undefined,
          summary: timedOut
            ? `Test run timed out after ${TEST_RUN_TIMEOUT_MS / 1000} seconds. Saved to run ID ${savedRun.id}.`
            : `Test run finished with code ${code}. Saved to run ID ${savedRun.id}.`,
          validationPlan: validationPlan ?? undefined,
          plannedCommand,
          failingTests: runResult.failingTests,
          failureMemory,
          warning: failureMemory && failureMemory.occurrenceCount > 1 && code !== 0
            ? "Same failure repeated in this workspace. Warn user and change approach before retrying."
            : undefined,
        }, null, 2));
      });

      child.on("error", (error) => {
         clearTimeout(timeout);
         const errorMessage = `Failed to start process: ${error.message}`;
         broadcastStream(`\n${errorMessage}\n`);
         resolve(JSON.stringify({ error: errorMessage }));
      });
    });
  },
};
