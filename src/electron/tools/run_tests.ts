import { spawn } from "node:child_process";
import { BrowserWindow } from "electron";

import { failureMemoryEngine } from "../failure-memory-engine";
import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import {
  buildToolProcessEnv,
  killProcessTree,
  parseDirectCommand,
  resolveToolCommand,
  spawnAbortable,
} from "./process";
import { failTool } from "../tool-result";
import { createId } from "../../lib/id";
import {
  authorizeValidationInvocation,
} from "../validation-authority";
import {
  isExecutableValidationCommand,
  validationRequirementForCommand,
} from "../validation-command";

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
  execute: async (
    args: { scope: string; specificPath?: string; plannedCommand?: "primary" | "fallback" },
    context: { workspacePath: string; signal?: AbortSignal; approvedPolicyStopId?: string },
  ) => {
    if (context.signal?.aborted) {
      return failTool("run_tests", "run_tests cancelled before start.", "CANCELLED");
    }

    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return failTool("run_tests", "No active workspace ID found.", "MISSING_RESOURCE");
    }

    const profile = await tursoService.getWorkspaceProfile(activeWorkspaceId);
    const validationPlan = await tursoService.getLatestValidationPlan(activeWorkspaceId);
    if (!validationPlan) {
      return failTool(
        "run_tests",
        "No current validation plan is available for this workspace.",
        "DEPENDENCY_UNAVAILABLE",
        {
          retryable: false,
          recommendedNextAction: "Run plan_validation and execute only its exact resolved command.",
          details: { cause: "VALIDATION_COMMAND_UNRESOLVED" },
        },
      );
    }

    const selectedPlanCommand = args.plannedCommand === "fallback"
      ? validationPlan.fallback
      : validationPlan.primary;
    const baseCommand = selectedPlanCommand?.command;
    const plannedCommandReason = selectedPlanCommand?.reason;
    if (selectedPlanCommand.availability === "unresolved") {
      const cause = selectedPlanCommand?.unavailableCause ??
        "VALIDATION_COMMAND_UNRESOLVED";
      return failTool(
        "run_tests",
        "No executable validation command is resolved for this requirement.",
        "DEPENDENCY_UNAVAILABLE",
        {
          retryable: false,
          recommendedNextAction:
            cause === "TOOLCHAIN_AMBIGUOUS"
              ? "Resolve conflicting target-repository package manager metadata, then re-plan validation."
              : cause === "TYPECHECK_UNAVAILABLE"
              ? "Add a repository typecheck script or dependency, then re-plan validation."
              : "Detect workspace validation capabilities and create a new validation plan.",
          details: {
            cause,
            requirementId: selectedPlanCommand?.requirementId ?? "validation",
            planId: validationPlan.id,
          },
        },
      );
    }
    if (!isExecutableValidationCommand(baseCommand)) {
      return failTool("run_tests", "Validation command is not executable.", "DEPENDENCY_UNAVAILABLE", {
        retryable: false,
        details: { cause: "VALIDATION_COMMAND_UNRESOLVED" },
      });
    }
    const executableBaseCommand = baseCommand;

    const validationExecutionId = createId("validation-exec");
    const inferredRequirementId = validationRequirementForCommand(executableBaseCommand);
    const requirementId = inferredRequirementId === "validation"
      ? selectedPlanCommand?.requirementId ?? inferredRequirementId
      : inferredRequirementId;

    const validationAuthority = await authorizeValidationInvocation({
      command: executableBaseCommand,
      workspacePath: context.workspacePath,
      validationPlan,
      approvedPolicyStopId: context.approvedPolicyStopId,
    });
    if (!validationAuthority.allowed) {
      return failTool(
        "run_tests",
        validationAuthority.reason ?? "Validation command is not authorized by the current target repository.",
        "DEPENDENCY_UNAVAILABLE",
        {
          retryable: false,
          recommendedNextAction: validationAuthority.recommendedNextAction,
          details: {
            cause: validationAuthority.cause ?? "VALIDATION_COMMAND_UNRESOLVED",
            requirementId,
            requestedCommand: executableBaseCommand,
            planId: validationPlan.id,
            planMatch: validationAuthority.planMatch,
            targetToolchainStatus: validationAuthority.targetToolchain?.status,
          },
        },
      );
    }

    const commandArgs: string[] = [];
    const shellFallbackSuffix = "";

    // If a validation plan exists, it is authoritative for command selection.
    const command = [
      executableBaseCommand,
      ...commandArgs.map(quoteDisplayArg),
    ].join(" ") + shellFallbackSuffix;
    const processEnv = buildToolProcessEnv({ FORCE_COLOR: "0" });
    let resolvedDirectCommand: Awaited<ReturnType<typeof resolveToolCommand>> | undefined;
    if (!profile?.shell && !shellFallbackSuffix) {
      try {
        const parsedCommand = parseDirectCommand(executableBaseCommand);
        resolvedDirectCommand = await resolveToolCommand({
          cmd: parsedCommand.cmd,
          args: parsedCommand.cmdArgs,
          env: processEnv,
        });
      } catch (error) {
        return failTool(
          "run_tests",
          error instanceof Error ? error.message : "Validation command could not be resolved.",
          "EXECUTION_ERROR",
        );
      }
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
      let processStarted = false;

      const isWindows = process.platform === "win32";
      let child;

      try {
        if (profile?.shell || shellFallbackSuffix) {
          // Shell mode: still honor abort via listener after spawn.
          child = spawn(command, {
            cwd: context.workspacePath,
            shell: profile?.shell || (isWindows ? "cmd.exe" : "/bin/sh"),
            env: processEnv,
            detached: !isWindows,
            windowsHide: true,
          });
        } else {
          if (!resolvedDirectCommand) {
            throw new Error("Validation command resolution is missing.");
          }
          child = spawnAbortable(resolvedDirectCommand.executable, [...resolvedDirectCommand.args, ...commandArgs], {
            cwd: context.workspacePath,
            env: processEnv,
            signal: context.signal,
            detached: !isWindows,
            windowsHide: true,
          });
        }
        processStarted = true;
      } catch (error) {
        if ((error as Error)?.name === "AbortError" || context.signal?.aborted) {
          resolve(failTool("run_tests", "run_tests cancelled before process start.", "CANCELLED"));
          return;
        }
        resolve(failTool("run_tests", (error as Error).message, "EXECUTION_ERROR"));
        return;
      }

      const onAbort = () => {
        killProcessTree(child.pid);
      };
      context.signal?.addEventListener("abort", onAbort, { once: true });

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

        finished = true;
        clearTimeout(timeout);
        context.signal?.removeEventListener("abort", onAbort);
        outputSummary = appendOutputSummary(outputSummary, `\n${error.message}`);
        const errorMessage = `Failed to start process: ${error.message}`;
        broadcastStream(`\n${errorMessage}\n`);
        resolve(failTool("run_tests", errorMessage, "EXECUTION_ERROR"));
      });

      const persistRun = async (code: number | null) => {
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
          command,
          processStarted,
          executionId: validationExecutionId,
          requirementId,
          validationRunId: savedRun.id,
          validationExecution: {
            executionId: validationExecutionId,
            validationRunId: savedRun.id,
            command,
            processStarted,
            exitCode: runResult.exitCode,
            requirementId,
            planId: validationPlan?.id,
            ...(validationAuthority.authorization === "approved_override"
              ? { authorization: "approved_override" }
              : {}),
          },
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
      };

      child.on("close", async (code) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
        context.signal?.removeEventListener("abort", onAbort);

        if (context.signal?.aborted) {
          broadcastStream(`\n--- Tests cancelled via AbortSignal ---\n`);
          resolve(
            failTool("run_tests", "run_tests cancelled during execution.", "CANCELLED", {
              mayHavePartialEffects: true,
            }),
          );
          return;
        }

        broadcastStream(`\n--- Tests completed with exit code ${code} ---\n`);
        await persistRun(code);
      });
    });
  },
};
