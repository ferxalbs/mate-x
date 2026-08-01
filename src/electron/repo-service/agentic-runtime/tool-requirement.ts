import type {
  ToolExecutionPolicy,
} from "../../../contracts/agent-run-trace";
import type { BehaviorMode } from "../../../contracts/behavior-mode";

const FALLBACK_DISCOVERY_TOOLS = new Set([
  "glob",
  "find",
  "rg",
  "grep",
  "ls",
  "read_file",
  "read_many_files",
  "repo_search",
]);

const MUTATION_TOOLS = new Set([
  "file_editor",
  "auto_patch",
  "dependency_guard",
]);

const VALIDATION_TOOLS = new Set([
  "run_tests",
  "sandbox_run",
  "browser_prober",
]);

export function resolveToolExecutionPolicy(
  toolName: string,
  mode: BehaviorMode,
): ToolExecutionPolicy {
  if (FALLBACK_DISCOVERY_TOOLS.has(toolName)) {
    return {
      requirement: "fallback",
      failureDisposition: "continue",
    };
  }
  if (MUTATION_TOOLS.has(toolName)) {
    return {
      requirement: "required",
      failureDisposition: "stop_run",
    };
  }
  if (VALIDATION_TOOLS.has(toolName)) {
    return {
      requirement: mode === "execute" ? "required" : "optional",
      failureDisposition: mode === "execute" ? "stop_phase" : "continue",
    };
  }
  return {
    requirement: "required",
    failureDisposition: "stop_phase",
  };
}
