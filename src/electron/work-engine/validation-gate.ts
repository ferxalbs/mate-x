import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";

const UNSUPPORTED_DONE_RE = /\b(fixed|ready|works|no warnings|merge-ready|merge ready|done)\b/i;

/**
 * Matches agent conclusions that mean "there is nothing to validate".
 * Text may only soft-warn when the mutation ledger is empty.
 * NES-5.1: mutation ledger ⇒ no text validation waive.
 */
const NO_VALIDATION_NEEDED_RE =
  /\b(no changes?(?:\s+(?:detected|to\s+review|found))?|nothing\s+to\s+(?:validate|review|check)|no\s+(?:patch|code\s+change)|patch\s+not\s+needed|read[\s-]?only|clean\s+working\s+(?:tree|directory)|0\s+(?:insertions?|deletions?)|no\s+(?:uncommitted|unstaged)\s+changes?)\b/i;

/** Tool names that indicate repository mutation occurred. */
const MUTATION_TOOL_NAMES = new Set([
  "auto_patch",
  "file_editor",
  "apply_patch",
  "write_file",
  "str_replace",
  "search_replace",
  "patch",
  "edit_file",
]);

export interface ValidationGateResult {
  allowed: boolean;
  warnings: string[];
}

export function mutationOccurredInLedger(
  toolExecutions: ToolExecutionRecord[],
): boolean {
  return toolExecutions.some((execution) => {
    if (MUTATION_TOOL_NAMES.has(execution.toolName)) return true;
    if (execution.toolName.includes("patch")) return true;
    const status = String((execution as { status?: string }).status ?? "");
    if (status === "patch_attempted" || status === "mutated") return true;
    const output = String(execution.output ?? "");
    if (/\bpatch_attempted\b/i.test(output)) return true;
    return false;
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

  if (!workPlan.validationPlan.required) {
    return { allowed: true, warnings: [] };
  }

  const strictNoTextWaive = options?.strictNoTextWaive ?? true;

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

  const mutated = mutationOccurredInLedger(toolExecutions);
  // Text waive only when no mutation occurred; never after mutation (NES-5.1).
  const textClaimsNoValidation = NO_VALIDATION_NEEDED_RE.test(finalContent);
  void strictNoTextWaive;

  // When strict (default): text may soft-warn only if mutation ledger empty;
  // if mutation occurred, text cannot suppress hard blocker.
  const allowTextWaive = !mutated && textClaimsNoValidation;

  const hardBlockers: string[] = [];
  if (!ranValidation && !allowTextWaive) {
    hardBlockers.push(
      mutated
        ? "Validation required: mutation ledger shows repository changes; model prose cannot waive validation."
        : "Validation required by WorkPlan but no validation tool result exists.",
    );
  }
  if (!ranFallback) hardBlockers.push("High-risk WorkPlan requires fallback validation evidence.");

  const softWarnings: string[] = [];
  if (!persisted) softWarnings.push("Validation result was not verified as persisted.");
  if (!ranValidation && allowTextWaive) {
    softWarnings.push("Validation skipped: no mutation ledger entries and agent concluded nothing to validate.");
  }
  if (mutated && textClaimsNoValidation && !ranValidation) {
    softWarnings.push("Ignored model claim of no validation needed because mutation tools ran.");
  }

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
