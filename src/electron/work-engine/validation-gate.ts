import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";
import {
  normalizeToolExecution,
  reconcileToolEvidence,
  resolveRequiredValidationStatus,
} from "./execution-evidence";
import { resolveObjectiveEvidence } from "./objective-compiler";
import { activeContractForWorkPlan, hasHighRiskChange, requiredApplicableItems } from "../validation-contract";

const UNSUPPORTED_DONE_RE = /\b(fixed|ready|works|no warnings|merge-ready|merge ready|done)\b/i;

/**
 * Matches confidence wording so an incomplete canonical contract produces a
 * visible warning. This never decides applicability or waives validation.
 */
export interface ValidationGateResult {
  allowed: boolean;
  warnings: string[];
}

export function mutationOccurredInLedger(
  toolExecutions: ToolExecutionRecord[],
): boolean {
  return toolExecutions.some((execution) => {
    const evidence = normalizeToolExecution(execution);
    return evidence.outcome === "completed" && evidence.changedFiles.length > 0;
  });
}

export function evaluateValidationGate(
  workPlan: WorkPlan,
  toolExecutions: ToolExecutionRecord[],
  finalContent: string,
  options?: { strictNoTextWaive?: boolean; planningPhase?: boolean },
): ValidationGateResult {
  // Final validation gates run only during validating/completed — not planning.
  if (options?.planningPhase) {
    return {
      allowed: true,
      warnings: [
        "Validation evidence is not_applicable_for_phase during planning (pre-approval).",
      ],
    };
  }

  const validationAttempts = toolExecutions.filter((execution) =>
    ["run_tests", "sandbox_run"].includes(execution.toolName),
  );
  const normalizedValidation = reconcileToolEvidence(toolExecutions);
  const objectiveResolution = workPlan.objectiveContract
    ? resolveObjectiveEvidence(
        workPlan.objectiveContract,
        toolExecutions.map((execution) => ({
          toolName: execution.toolName,
          args: execution.args ?? {},
          output: execution.output,
          parsedOutput: execution.parsedOutput,
        })),
        { matches: workPlan.objectiveInspectionMatches ?? [] },
      )
    : { state: "unknown" as const, evidenceIds: [], summary: "Historical WorkPlan has no objective evidence contract." };
  const objectiveState = objectiveResolution.state === "unknown" && workPlan.objectiveContract?.objectiveAlreadySatisfied
    ? "satisfied" as const
    : objectiveResolution.state;
  const mutated = mutationOccurredInLedger(toolExecutions);
  const activeContract = activeContractForWorkPlan(workPlan, {
    phase: "final",
    actualMutation: mutated,
    objectiveAlreadySatisfied: objectiveState === "satisfied" && !mutated,
    validationIsPrimaryObjective: workPlan.objectiveContract?.validationIsPrimaryObjective ?? false,
    highRiskChange: mutated && (workPlan.risk === "high" || hasHighRiskChange(normalizedValidation.flatMap((item) => item.changedFiles.map((file) => file.path)))),
    primaryStatus: primaryValidationStatus(normalizedValidation),
    evidence: normalizedValidation,
  });
  const applicableRequired = requiredApplicableItems(activeContract);
  if (applicableRequired.length === 0) {
    return {
      allowed: true,
      warnings: objectiveState === "satisfied" && !mutated
        ? ["Post-mutation validation is not applicable because no mutation was required."]
        : [],
    };
  }

  const strictNoTextWaive = options?.strictNoTextWaive ?? true;
  void strictNoTextWaive;
  const requiredValidationStatus = resolveRequiredValidationStatus(
    workPlan,
    normalizedValidation,
    activeContract,
  );
  const ranValidation = requiredValidationStatus === "passed" ||
    (requiredValidationStatus === null && validationAttempts.some(
      (execution) => normalizeToolExecution(execution).validationStatus === "passed",
    ));
  const persisted = toolExecutions.some(
    (execution) => execution.toolName === "verify_validation_persistence",
  );
  const fallbackItems = activeContract.items.filter(
    (item) => item.obligation === "fallback" && item.applicability === "applicable",
  );
  const ranFallback = fallbackItems.every((item) => item.evidence.status === "passed");

  const hardBlockers: string[] = [];
  if (!ranValidation) {
    hardBlockers.push(
      mutated
        ? "Validation required: mutation ledger shows repository changes; model prose cannot waive validation."
        : validationAttempts.length > 0
          ? "Validation required by WorkPlan but no valid typed execution proof exists."
          : "Validation required by WorkPlan but no validation tool result exists.",
    );
  }
  if (!ranFallback) hardBlockers.push("High-risk WorkPlan requires fallback validation evidence.");

  const softWarnings: string[] = [];
  if (!persisted) softWarnings.push("Validation result was not verified as persisted.");
  if (!ranValidation && !mutated) {
    softWarnings.push("Validation remains incomplete for the applicable objective; repository evidence did not show a mutation-triggered exemption.");
  }

  const warnings = [...hardBlockers, ...softWarnings];
  const blocked = hardBlockers.length > 0;

  if (blocked && UNSUPPORTED_DONE_RE.test(finalContent)) {
    warnings.push("Final confidence wording must be downgraded; runtime evidence is incomplete.");
  }

  return { allowed: !blocked, warnings };
}

function primaryValidationStatus(
  evidence: ReturnType<typeof reconcileToolEvidence>,
): "passed" | "failed" | "inconclusive" | undefined {
  if (evidence.some((item) => item.validationStatus === "failed" || item.validationStatus === "blocked")) return "failed";
  if (evidence.some((item) => item.validationStatus === "passed")) return "passed";
  if (evidence.some((item) => item.validationStatus === "pending" || item.validationStatus === "running")) return "inconclusive";
  return undefined;
}

export function appendValidationGateWarning(content: string, gate: ValidationGateResult) {
  if (gate.allowed) return content;
  return `${content.trim()}\n\nWarnings:\n${gate.warnings.map((warning) => `- ${warning}`).join("\n")}`;
}
