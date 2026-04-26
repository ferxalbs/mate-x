import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import { validationPlanner } from "../validation-planner";

export const validationPlanTool: Tool = {
  name: "plan_validation",
  description:
    "Creates and persists the smallest useful validation plan for a task using changed files, RepoGraph impact, package scripts, detected framework, and previous failures. Use this before choosing validation commands.",
  parameters: {
    type: "object",
    properties: {
      objective: {
        type: "string",
        description: "The task objective or bug/fix being validated.",
      },
      changedFiles: {
        type: "array",
        items: { type: "string" },
        description: "Files changed by the current task.",
      },
      impactedFiles: {
        type: "array",
        items: { type: "string" },
        description: "Files returned by RepoGraph impact analysis.",
      },
      packageScripts: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Package scripts, keyed by script name.",
      },
      detectedFramework: {
        type: "string",
        description: "Detected framework or test runner.",
      },
    },
    required: ["objective", "changedFiles", "impactedFiles", "packageScripts"],
  },
  execute: async (
    args: {
      objective: string;
      changedFiles: string[];
      impactedFiles: string[];
      packageScripts: Record<string, string>;
      detectedFramework?: string;
    },
  ) => {
    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return JSON.stringify({ error: "No active workspace ID found." });
    }

    const [profile, previousFailures] = await Promise.all([
      tursoService.getWorkspaceProfile(activeWorkspaceId),
      tursoService.getRecentValidationRuns(activeWorkspaceId, 5),
    ]);

    const plan = validationPlanner.createPlan({
      objective: args.objective,
      changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles : [],
      impactedFiles: Array.isArray(args.impactedFiles) ? args.impactedFiles : [],
      packageScripts: args.packageScripts ?? {},
      detectedFramework: args.detectedFramework,
      previousFailures,
      profile,
    });

    await tursoService.setLatestValidationPlan(activeWorkspaceId, plan);

    return JSON.stringify(plan, null, 2);
  },
};
