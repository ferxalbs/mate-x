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
    const recentRuns = await tursoService.getRecentValidationRuns(activeWorkspaceId, 20);

    const runPlan = run?.validationPlan;
    const planPersisted = Boolean(latestPlan);
    const runPersisted = Boolean(run);
    const runIncludesPlan = Boolean(runPlan);
    const planMatchesRun = Boolean(
      latestPlan &&
      runPlan &&
      latestPlan.id === runPlan.id,
    );
    const runsForLatestPlan = latestPlan
      ? recentRuns.filter((recentRun) => recentRun.validationPlan?.id === latestPlan.id)
      : [];
    const primaryRun = latestPlan
      ? runsForLatestPlan.find((recentRun) => recentRun.command === latestPlan.primary.command)
      : undefined;
    const fallbackRun = latestPlan
      ? runsForLatestPlan.find((recentRun) => recentRun.command === latestPlan.fallback.command)
      : undefined;
    const fallbackRequired = Boolean(
      latestPlan &&
      latestPlan.riskLevel === "high" &&
      latestPlan.primary.command !== latestPlan.fallback.command,
    );
    const requiredFallbackSatisfied = !fallbackRequired || Boolean(fallbackRun);
    const verified =
      planPersisted &&
      runPersisted &&
      runIncludesPlan &&
      planMatchesRun &&
      Boolean(primaryRun) &&
      requiredFallbackSatisfied;

    return JSON.stringify({
      planPersisted,
      runPersisted,
      runIncludesPlan,
      planMatchesRun,
      fallbackRequired,
      requiredFallbackSatisfied,
      latestPlanId: latestPlan?.id,
      runId: run?.id,
      runCommand: run?.command,
      runStatus: run?.status,
      runPlanId: runPlan?.id,
      primaryRunId: primaryRun?.id,
      fallbackRunId: fallbackRun?.id,
      verdict: verified
        ? "verified"
        : "incomplete",
      recommendation: verified
        ? "Persistence and required validation stages verified from database records."
        : "Do not claim validation complete until the latest plan, primary run, and required fallback run are all present with matching plan IDs.",
    }, null, 2);
  },
};
