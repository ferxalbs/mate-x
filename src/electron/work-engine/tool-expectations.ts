import type { WorkRunbook } from "./types";

export interface ToolExpectation {
  tools: string[];
  required: boolean;
  reason: string;
}

/**
 * Core read/search tools always available so the agent can ground answers
 * without the full ~61-tool catalog.
 */
export const CORE_AGENT_TOOLS = [
  "rg",
  "read",
  "read_many",
  "repo_graph",
  "git_diag",
  "glob",
  "ls",
  "pwd",
  "find_similar_failures",
] as const;

/** Historical alias → canonical tool.name used in model definitions. */
const TOOL_NAME_ALIASES: Record<string, string> = {
  git: "git_diag",
  secrets: "secret_scan",
  metadata: "file_metadata",
  audit: "security_audit",
  deps: "dependency_check",
  network: "network_map",
  sql: "sql_audit",
  env_safety: "env_audit",
  container: "container_audit",
  flow: "flow_trace",
  entropy: "entropy_scan",
  auth: "auth_audit",
  report: "security_report",
  pdf_report: "pdf_security_report",
  validation_plan: "plan_validation",
  validation_persistence: "verify_validation_persistence",
  validation_profile: "detect_workspace_capabilities",
};

export function canonicalizeToolName(name: string): string {
  const trimmed = name.trim();
  return TOOL_NAME_ALIASES[trimmed] ?? trimmed;
}

export function getToolExpectations(runbook: WorkRunbook): ToolExpectation[] {
  switch (runbook) {
    case "answer_from_context":
      return [];
    case "inspect_explain":
      return [
        {
          tools: ["read", "repo_graph", "read_many"],
          required: false,
          reason: "Expected when supplied context is insufficient.",
        },
      ];
    case "review_classify_summarize":
      return [
        {
          tools: ["git_diag", "repo_graph"],
          required: true,
          reason: "Review must use changed files and graph impact.",
        },
        {
          tools: ["plan_validation"],
          required: false,
          reason: "Validation planning is optional unless risk is elevated.",
        },
      ];
    case "patch_test_verify":
      return [
        {
          tools: ["read", "read_many", "repo_graph"],
          required: true,
          reason: "Patch requires file context.",
        },
        {
          tools: ["file_editor", "mutation"],
          required: true,
          reason: "Patch runbook requires edit tool unless no patch needed.",
        },
        {
          tools: ["plan_validation"],
          required: true,
          reason: "Patch runbook requires validation plan.",
        },
        {
          tools: ["run_tests", "sandbox_run"],
          required: true,
          reason: "Patch runbook requires validation execution or blocked reason.",
        },
        {
          tools: ["verify_validation_persistence"],
          required: true,
          reason: "Patch runbook requires persisted validation result.",
        },
        {
          tools: ["evidence_pack"],
          required: false,
          reason: "Evidence Pack should use runtime records.",
        },
      ];
    case "audit_reproduce_remediate":
      return [
        {
          tools: ["attack_surface_scan", "security_path_trace"],
          required: true,
          reason: "Security review requires surface scan or trace.",
        },
        {
          tools: ["candidate_revalidator"],
          required: true,
          reason: "Security claims need revalidation.",
        },
        {
          tools: ["run_tests", "sandbox_run"],
          required: false,
          reason: "Reproduction or static proof required for vulnerability wording.",
        },
        {
          tools: ["file_editor", "mutation"],
          required: false,
          reason: "Patch when requested or clear.",
        },
        {
          tools: ["evidence_pack"],
          required: false,
          reason: "Evidence Pack should use runtime records.",
        },
      ];
    case "scan_contain_report":
      return [
        {
          tools: ["attack_surface_scan", "secret_scan", "security_audit"],
          required: true,
          reason: "Scan runbook needs surface and secret triage.",
        },
        {
          tools: ["security_report", "pdf_security_report", "evidence_pack"],
          required: false,
          reason: "Reporting tools optional after scan.",
        },
      ];
    case "trace_source_to_sink":
      return [
        {
          tools: ["security_path_trace"],
          required: true,
          reason: "Trace runbook requires source-to-sink trace.",
        },
        {
          tools: ["evidence_pack"],
          required: false,
          reason: "Evidence Pack recommended.",
        },
      ];
    case "validate_only":
      return [
        {
          tools: ["plan_validation"],
          required: true,
          reason: "Validation-only run needs validation plan.",
        },
        {
          tools: ["run_tests", "sandbox_run"],
          required: true,
          reason: "Validation-only run needs executed command.",
        },
        {
          tools: ["verify_validation_persistence"],
          required: true,
          reason: "Validation result must be persisted.",
        },
      ];
    case "evidence_only":
      return [
        {
          tools: ["evidence_pack"],
          required: true,
          reason: "Evidence-only run can package existing runtime evidence only.",
        },
      ];
    default:
      return [];
  }
}

/**
 * Extra tools granted per runbook beyond CORE_AGENT_TOOLS.
 * Kept intentionally tight so model requests stay small and selection accurate.
 */
function getRunbookExtraTools(runbook: WorkRunbook): string[] {
  switch (runbook) {
    case "answer_from_context":
      return [];
    case "inspect_explain":
      return ["find", "file_metadata", "json_probe"];
    case "review_classify_summarize":
      return ["plan_validation", "find", "file_metadata"];
    case "patch_test_verify":
      return [
        "file_editor",
        "mutation",
        "auto_patch",
        "plan_validation",
        "run_tests",
        "sandbox_run",
        "verify_validation_persistence",
        "detect_workspace_capabilities",
        "record_failure",
        "record_resolution",
        "evidence_pack",
      ];
    case "validate_only":
      return [
        "plan_validation",
        "run_tests",
        "sandbox_run",
        "verify_validation_persistence",
        "detect_workspace_capabilities",
        "record_failure",
        "record_resolution",
      ];
    case "audit_reproduce_remediate":
      return [
        "attack_surface_scan",
        "security_path_trace",
        "candidate_revalidator",
        "secret_scan",
        "flow_trace",
        "source_map_analyzer",
        "security_audit",
        "ast_grep",
        "deep_analysis_pipeline",
        "file_editor",
        "mutation",
        "plan_validation",
        "run_tests",
        "sandbox_run",
        "verify_validation_persistence",
        "record_failure",
        "record_resolution",
        "evidence_pack",
        "browser_prober",
        "http_prober",
        "container_audit",
        "cve_audit",
        "redos_analyzer",
        "semgrep_scan",
        "eslint_scan",
      ];
    case "scan_contain_report":
      return [
        "attack_surface_scan",
        "secret_scan",
        "security_audit",
        "dependency_check",
        "package_audit",
        "cve_audit",
        "entropy_scan",
        "env_audit",
        "network_map",
        "sql_audit",
        "auth_audit",
        "container_audit",
        "source_map_analyzer",
        "deep_analysis_pipeline",
        "security_report",
        "pdf_security_report",
        "evidence_pack",
      ];
    case "trace_source_to_sink":
      return [
        "security_path_trace",
        "flow_trace",
        "ast_grep",
        "candidate_revalidator",
        "evidence_pack",
      ];
    case "evidence_only":
      return ["evidence_pack"];
    default:
      return [];
  }
}

export type AgentPathKind = "full" | "verify_only" | "chat_help" | string | undefined;

/**
 * Resolve the canonical tool names advertised to the model for a run.
 * Returns null when the full catalog should be used (unknown/broad path).
 */
export function getAgentToolAllowlist(
  runbook: WorkRunbook,
  pathKind?: AgentPathKind,
): string[] | null {
  // chat_help: minimal tools; prefer answer from context.
  if (pathKind === "chat_help") {
    return uniqueCanonical([...CORE_AGENT_TOOLS]);
  }

  // verify_only: validation-focused set regardless of runbook drift.
  if (pathKind === "verify_only") {
    return uniqueCanonical([
      ...CORE_AGENT_TOOLS,
      ...getRunbookExtraTools("validate_only"),
    ]);
  }

  if (pathKind !== undefined && pathKind !== "full") {
    return null;
  }

  const extras = getRunbookExtraTools(runbook);
  const fromExpectations = getToolExpectations(runbook).flatMap((item) => item.tools);
  return uniqueCanonical([...CORE_AGENT_TOOLS, ...extras, ...fromExpectations]);
}

function uniqueCanonical(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const canonical = canonicalizeToolName(name);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
