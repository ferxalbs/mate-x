import type { ToolEvent, ToolEventType } from "../../../contracts/chat";

type PublicToolProgress = Pick<
  ToolEvent,
  "detail" | "label" | "segmentKind" | "status" | "type" | "visibility"
>;

const READ_TOOLS = /^(?:read|read_many|pwd|ls|tree|du|file_metadata)$/;
const SEARCH_TOOLS = /^(?:rg|find|glob|ast_grep|repo_graph|git_forensics)$/;
const EDIT_TOOLS = /(?:file_editor|auto_patch|mutation|patch|edit)/;
const VALIDATION_TOOLS =
  /(?:run_tests|sandbox_run|eslint_scan|semgrep_scan|audit|scan|revalidator|validation|fuzzer|prober|trace|dependency_check|cve)/;

export function createPublicToolProgress(toolName: string): PublicToolProgress {
  const type = classifyPublicToolType(toolName);
  return {
    detail: "",
    label: publicToolLabel(type),
    segmentKind: "tool",
    status: "active",
    type,
    visibility: "public",
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

function publicToolLabel(type: ToolEventType): string {
  switch (type) {
    case "read":
      return "Reading files";
    case "search":
      return "Searching repository";
    case "edit":
      return "Editing files";
    case "validation":
      return "Running validation";
    default:
      return "Running workspace action";
  }
}
