import type { ToolExecutionRecord } from "../evidence-pack";
import { contractForWorkPlan } from "../validation-contract";
import { normalizeValidationCommand } from "../validation-command";
import { normalizeToolEvidence } from "./execution-evidence";
import type { WorkPlan } from "./types";

export interface SupplementalNoOpTest {
  command: string;
  plannedCommand: "primary";
  scope: "full-suite";
}

export function selectSupplementalNoOpTest(
  workPlan: WorkPlan,
  toolExecutions: ToolExecutionRecord[],
): SupplementalNoOpTest | null {
  const verification = workPlan.objectiveVerification;
  if (
    verification?.status !== "satisfied" ||
    verification.coverage !== "complete" ||
    workPlan.objectiveContract?.validationIsPrimaryObjective
  ) {
    return null;
  }

  const evidence = toolExecutions.map((execution) =>
    execution.evidence ?? normalizeToolEvidence(
      execution.toolName,
      execution.args,
      execution.output,
      execution.parsedOutput,
    ),
  );
  if (evidence.some((item) => item.changedFiles.length > 0)) return null;
  if (evidence.some((item) => item.validationRequirementId === "test")) return null;

  const test = contractForWorkPlan(workPlan).items.find((item) =>
    item.signal === "test" &&
    item.obligation === "required" &&
    item.trigger === "after_mutation" &&
    item.commandSource === "explicit_objective" &&
    item.availability === "resolved" &&
    Boolean(item.command),
  );
  if (!test?.command) return null;

  return {
    command: test.command,
    plannedCommand: "primary",
    scope: "full-suite",
  };
}

export function scheduledValidationPlanMatches(
  parsedOutput: unknown,
  expectedCommand: string,
): boolean {
  if (!parsedOutput || typeof parsedOutput !== "object" || Array.isArray(parsedOutput)) {
    return false;
  }
  const primary = (parsedOutput as Record<string, unknown>).primary;
  if (!primary || typeof primary !== "object" || Array.isArray(primary)) return false;
  const command = (primary as Record<string, unknown>).command;
  const availability = (primary as Record<string, unknown>).availability;
  const requirementId = (primary as Record<string, unknown>).requirementId;
  return (
    typeof command === "string" &&
    normalizeValidationCommand(command) === normalizeValidationCommand(expectedCommand) &&
    availability === "resolved" &&
    requirementId === "test"
  );
}
