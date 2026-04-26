import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";

export const validationPersistenceTool: Tool = {
  name: "verify_validation_persistence",
  description:
    "Verifies whether the latest validation plan is persisted and whether validation runs saved that plan. Use after plan_validation and run_tests before claiming persistence.",
  parameters: {
    type: "object",
    properties: {
      runId: {
        type: "string",
        description: "Optional validation run ID returned by run_tests. If omitted, checks the most recent validation run.",
      },
    },
  },
  execute: async (args: { runId?: string }) => {
    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return JSON.stringify({ error: "No active workspace ID found." });
    }

    const latestPlan = await tursoService.getLatestValidationPlan(activeWorkspaceId);
    const run = args.runId
      ? await tursoService.getValidationRun(args.runId)
      : (await tursoService.getRecentValidationRuns(activeWorkspaceId, 1))[0] ?? null;

    const runPlan = run?.validationPlan;
    const planPersisted = Boolean(latestPlan);
    const runPersisted = Boolean(run);
    const runIncludesPlan = Boolean(runPlan);
    const planMatchesRun = Boolean(
      latestPlan &&
      runPlan &&
      latestPlan.id === runPlan.id,
    );

    return JSON.stringify({
      planPersisted,
      runPersisted,
      runIncludesPlan,
      planMatchesRun,
      latestPlanId: latestPlan?.id,
      runId: run?.id,
      runCommand: run?.command,
      runStatus: run?.status,
      runPlanId: runPlan?.id,
      verdict: planPersisted && runPersisted && runIncludesPlan && planMatchesRun
        ? "verified"
        : "incomplete",
      recommendation: planPersisted && runPersisted && runIncludesPlan && planMatchesRun
        ? "Persistence verified from database records."
        : "Do not claim validation plan persistence as proven until latest plan and validation run contain matching plan IDs.",
    }, null, 2);
  },
};
