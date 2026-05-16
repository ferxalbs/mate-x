import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";

const UNSUPPORTED_DONE_RE = /\b(fixed|ready|works|no warnings|merge-ready|merge ready|done)\b/i;

export interface ValidationGateResult {
  allowed: boolean;
  warnings: string[];
}

export function evaluateValidationGate(
  workPlan: WorkPlan,
  toolExecutions: ToolExecutionRecord[],
  finalContent: string,
): ValidationGateResult {
  if (!workPlan.validationPlan.required) {
    return { allowed: true, warnings: [] };
  }

  const ranValidation = toolExecutions.some((execution) =>
    ["run_tests", "sandbox_run"].includes(execution.toolName),
  );
  const persisted = toolExecutions.some(
    (execution) => execution.toolName === "verify_validation_persistence",
  );
  const fallbackRequired =
    workPlan.risk === "high" && Boolean(workPlan.validationPlan.fallbackCommand);
  const ranFallback =
    !fallbackRequired ||
    toolExecutions.some((execution) =>
      String(execution.output).includes(workPlan.validationPlan.fallbackCommand ?? "\u0000"),
    );

  const warnings: string[] = [];
  if (!ranValidation) warnings.push("Validation required by WorkPlan but no validation tool result exists.");
  if (!persisted) warnings.push("Validation result was not verified as persisted.");
  if (!ranFallback) warnings.push("High-risk WorkPlan requires fallback validation evidence.");
  if (warnings.length > 0 && UNSUPPORTED_DONE_RE.test(finalContent)) {
    warnings.push("Final confidence wording must be downgraded; runtime evidence is incomplete.");
  }

  return { allowed: warnings.length === 0, warnings };
}

export function appendValidationGateWarning(content: string, gate: ValidationGateResult) {
  if (gate.allowed) return content;
  return `${content.trim()}\n\nWarnings:\n${gate.warnings.map((warning) => `- ${warning}`).join("\n")}`;
}
