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

  // Hard blockers: validation tool didn't run at all, or high-risk fallback is missing.
  const hardBlockers: string[] = [];
  if (!ranValidation) hardBlockers.push("Validation required by WorkPlan but no validation tool result exists.");
  if (!ranFallback) hardBlockers.push("High-risk WorkPlan requires fallback validation evidence.");

  // Soft advisories: informational, never block the gate on their own.
  const softWarnings: string[] = [];
  if (!persisted) softWarnings.push("Validation result was not verified as persisted.");

  const warnings = [...hardBlockers, ...softWarnings];
  const blocked = hardBlockers.length > 0;

  if (blocked && UNSUPPORTED_DONE_RE.test(finalContent)) {
    warnings.push("Final confidence wording must be downgraded; runtime evidence is incomplete.");
  }

  return { allowed: !blocked, warnings };
}

export function appendValidationGateWarning(content: string, gate: ValidationGateResult) {
  if (gate.allowed) return content;
  return `${content.trim()}\n\nWarnings:\n${gate.warnings.map((warning) => `- ${warning}`).join("\n")}`;
}
