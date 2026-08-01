import type { ToolEvent, ToolEventType } from "../../../contracts/chat";

type PublicToolProgress = Pick<
  ToolEvent,
  "detail" | "label" | "segmentKind" | "status" | "type" | "visibility"
>;
type PublicToolProgressPhase = "active" | "completed" | "failed";

const READ_TOOLS = /^(?:read|read_many|pwd|ls|tree|du|file_metadata)$/;
const SEARCH_TOOLS = /^(?:rg|find|glob|ast_grep|repo_graph|git_forensics)$/;
const EDIT_TOOLS = /(?:file_editor|auto_patch|mutation|patch|edit)/;
const VALIDATION_TOOLS =
  /^(?:run_tests|sandbox_run|eslint_scan|semgrep_scan|audit|scan|candidate_revalidator|fuzzer|browser_prober|dependency_check|cve_scan)$/;
const INTERNAL_TOOLS =
  /^(?:plan_validation|verify_validation_persistence)$/;

export function createPublicToolProgress(
  toolName: string,
  args: Record<string, unknown> = {},
  phase: PublicToolProgressPhase = "active",
): PublicToolProgress {
  const type = classifyPublicToolType(toolName);
  const visibility = INTERNAL_TOOLS.test(toolName.trim().toLowerCase())
    ? "technical"
    : "public";
  return {
    detail: publicToolDetail(type, args, phase),
    label: publicToolLabel(type, args, phase),
    segmentKind: "tool",
    status:
      phase === "active" ? "active" : phase === "completed" ? "done" : "error",
    type,
    visibility,
  };
}

function classifyPublicToolType(toolName: string): ToolEventType {
  const normalized = toolName.trim().toLowerCase();
  if (READ_TOOLS.test(normalized)) return "read";
  if (SEARCH_TOOLS.test(normalized)) return "search";
  if (EDIT_TOOLS.test(normalized)) return "edit";
  if (VALIDATION_TOOLS.test(normalized)) return "validation";
  return "command";
}

function publicToolLabel(
  type: ToolEventType,
  args: Record<string, unknown>,
  phase: PublicToolProgressPhase,
): string {
  const completed = phase === "completed";
  const failed = phase === "failed";
  switch (type) {
    case "read": {
      const count = countRequestedFiles(args);
      if (count > 1) {
        return `${completed ? "Read" : failed ? "Could not read" : "Reading"} ${count} relevant files`;
      }
      return completed
        ? "Read relevant file"
        : failed
          ? "File read failed"
          : "Reading relevant file";
    }
    case "search":
      return completed
        ? "Repository search completed"
        : failed
          ? "Repository search failed"
          : "Searching repository";
    case "edit":
      return completed
        ? "Updated workspace file"
        : failed
          ? "File update failed"
          : "Editing workspace file";
    case "validation": {
      const target = validationTarget(args);
      return completed
        ? `${target} passed`
        : failed
          ? `${target} failed`
          : `Running ${target.toLowerCase()}`;
    }
    default:
      return completed
        ? "Workspace action completed"
        : failed
          ? "Workspace action failed"
          : "Running workspace action";
  }
}

function publicToolDetail(
  type: ToolEventType,
  args: Record<string, unknown>,
  phase: PublicToolProgressPhase,
): string {
  if (type === "validation" && phase !== "active") {
    return phase === "completed"
      ? "Validation completed successfully."
      : "Validation did not complete successfully.";
  }
  if (type === "edit" && phase === "completed") {
    return "A scoped workspace edit was applied.";
  }
  if (type === "search" && phase === "completed") {
    return "The requested repository search finished.";
  }
  return "";
}

function countRequestedFiles(args: Record<string, unknown>): number {
  for (const key of ["requests", "paths", "files"]) {
    if (Array.isArray(args[key])) return args[key].length;
  }
  return 1;
}

function validationTarget(args: Record<string, unknown>): string {
  const command = [
    args.command,
    args.script,
    ...(Array.isArray(args.args) ? args.args : []),
  ].join(" ").toLowerCase();
  if (command.includes("typecheck") || command.includes("tsc")) return "Typecheck";
  if (command.includes("lint") || command.includes("eslint")) return "Lint";
  if (command.includes("test")) return "Tests";
  if (command.includes("build") || command.includes("package")) return "Build";
  return "Validation";
}
