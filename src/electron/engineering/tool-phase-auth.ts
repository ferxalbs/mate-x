/**
 * Tool authorization by EngineeringTask.status (control-plane authority).
 * Pre-approval: inspect/search/read only. No mutation, mutating shell, commit, push, ship proof.
 */

import type { EngineeringTaskStatus } from "../../contracts/engineering-task";
import type { AutonomyPolicy } from "../../contracts/behavior-mode";
import { isPreApprovalStatus } from "../../contracts/engineering-phase-result";

const MUTATION_TOOL_NAMES = new Set([
  "auto_patch",
  "file_editor",
  "apply_patch",
  "write_file",
  "str_replace",
  "search_replace",
  "patch",
  "edit_file",
  "mutation",
]);

const MUTATING_SHELL_TOOLS = new Set(["sandbox_run", "run_tests"]);

const SHIP_PROOF_TOOLS = new Set(["evidence_pack", "issue_ship_proof", "ship_proof"]);

const GIT_WRITE_TOOLS = new Set(["git_commit", "git_push", "commit", "push"]);

export type ToolPhaseAuthDecision =
  | { allowed: true }
  | { allowed: false; code: "ERR_APPROVAL_REQUIRED"; message: string };

export function isMutationToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (MUTATION_TOOL_NAMES.has(toolName) || MUTATION_TOOL_NAMES.has(lower)) {
    return true;
  }
  return (
    lower.includes("patch") ||
    lower.includes("file_editor") ||
    lower.includes("write_file") ||
    lower.includes("search_replace") ||
    lower.includes("str_replace")
  );
}

export function authorizeToolForEngineeringStatus(
  toolName: string,
  status: EngineeringTaskStatus | null | undefined,
  args?: Record<string, unknown>,
  autonomyPolicy: AutonomyPolicy = { id: "guided_approval" },
): ToolPhaseAuthDecision {
  const isMutation = isMutationToolName(toolName);
  const isGitWrite = GIT_WRITE_TOOLS.has(toolName) || GIT_WRITE_TOOLS.has(toolName.toLowerCase());
  const command = String(args?.command ?? args?.script ?? "").toLowerCase();
  if (isGitWrite) {
    return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Git write tool "${toolName}" always requires explicit authorization.` };
  }
  if (/\bgit\s+(commit|push|reset|rebase|branch\s+-[dD])\b/.test(command)) {
    return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Git write command always requires explicit authorization: ${command.slice(0, 120)}` };
  }
  if (autonomyPolicy.id === "review_read_only" && (isMutation || MUTATING_SHELL_TOOLS.has(toolName))) {
    return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Review mode is read-only and rejects ${toolName}.` };
  }
  const preApproval = Boolean(status && isPreApprovalStatus(status));
  if (autonomyPolicy.id === "guided_approval" && preApproval && isMutation) {
    return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Guided mode needs approval before editing the repository.` };
  }
  if (autonomyPolicy.id === "custom") {
    if (preApproval && isMutation && autonomyPolicy.custom?.askBeforeEdits) {
      return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Custom policy needs approval before editing the repository.` };
    }
    if (preApproval && MUTATING_SHELL_TOOLS.has(toolName) && autonomyPolicy.custom?.askBeforeCommands) {
      return { allowed: false, code: "ERR_APPROVAL_REQUIRED", message: `Custom policy needs approval before running commands.` };
    }
  }
  if (autonomyPolicy.id === "auto_scoped" && (isMutation || MUTATING_SHELL_TOOLS.has(toolName))) {
    return { allowed: true };
  }
  if (!status || !isPreApprovalStatus(status)) {
    return { allowed: true };
  }

  if (isMutation) {
    return {
      allowed: false,
      code: "ERR_APPROVAL_REQUIRED",
      message: `Tool "${toolName}" mutates the repository and is forbidden while EngineeringTask is ${status}. Approve the plan before execution.`,
    };
  }

  if (SHIP_PROOF_TOOLS.has(toolName) || SHIP_PROOF_TOOLS.has(toolName.toLowerCase())) {
    return {
      allowed: false,
      code: "ERR_APPROVAL_REQUIRED",
      message: `Ship Proof / final evidence tool "${toolName}" is forbidden before execution completes (status=${status}).`,
    };
  }

  if (MUTATING_SHELL_TOOLS.has(toolName)) {
    // Validation tools during pre-approval are not final gates; block to keep planning pure.
    return {
      allowed: false,
      code: "ERR_APPROVAL_REQUIRED",
      message: `Tool "${toolName}" may execute mutating or validation shell work and is forbidden while status is ${status}.`,
    };
  }

  // sandbox / shell args that look like git write
  if (args) {
    if (
      /\bgit\s+(commit|push|add|reset|checkout|merge|rebase)\b/.test(command) ||
      /\brm\s+-rf\b/.test(command)
    ) {
      return {
        allowed: false,
        code: "ERR_APPROVAL_REQUIRED",
        message: `Command blocked before approval: ${command.slice(0, 120)}`,
      };
    }
  }

  return { allowed: true };
}
