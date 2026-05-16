import type { WorkRunbook } from "./types";

export interface ToolExpectation {
  tools: string[];
  required: boolean;
  reason: string;
}

export function getToolExpectations(runbook: WorkRunbook): ToolExpectation[] {
  switch (runbook) {
    case "answer_from_context":
      return [];
    case "inspect_explain":
      return [
        { tools: ["read", "repo_graph", "read_many"], required: false, reason: "Expected when supplied context is insufficient." },
      ];
    case "review_classify_summarize":
      return [
        { tools: ["git", "repo_graph"], required: true, reason: "Review must use changed files and graph impact." },
        { tools: ["plan_validation"], required: false, reason: "Validation planning is optional unless risk is elevated." },
      ];
    case "patch_test_verify":
      return [
        { tools: ["read", "read_many", "repo_graph"], required: true, reason: "Patch requires file context." },
        { tools: ["file_editor", "mutation"], required: true, reason: "Patch runbook requires edit tool unless no patch needed." },
        { tools: ["plan_validation"], required: true, reason: "Patch runbook requires validation plan." },
        { tools: ["run_tests", "sandbox_run"], required: true, reason: "Patch runbook requires validation execution or blocked reason." },
        { tools: ["verify_validation_persistence"], required: true, reason: "Patch runbook requires persisted validation result." },
        { tools: ["evidence_pack"], required: false, reason: "Evidence Pack should use runtime records." },
      ];
    case "audit_reproduce_remediate":
      return [
        { tools: ["attack_surface_scan", "security_path_trace"], required: true, reason: "Security review requires surface scan or trace." },
        { tools: ["candidate_revalidator"], required: true, reason: "Security claims need revalidation." },
        { tools: ["run_tests", "sandbox_run"], required: false, reason: "Reproduction or static proof required for vulnerability wording." },
        { tools: ["file_editor", "mutation"], required: false, reason: "Patch when requested or clear." },
        { tools: ["evidence_pack"], required: false, reason: "Evidence Pack should use runtime records." },
      ];
    case "trace_source_to_sink":
      return [
        { tools: ["security_path_trace"], required: true, reason: "Trace runbook requires source-to-sink trace." },
        { tools: ["evidence_pack"], required: false, reason: "Evidence Pack recommended." },
      ];
    case "validate_only":
      return [
        { tools: ["plan_validation"], required: true, reason: "Validation-only run needs validation plan." },
        { tools: ["run_tests", "sandbox_run"], required: true, reason: "Validation-only run needs executed command." },
        { tools: ["verify_validation_persistence"], required: true, reason: "Validation result must be persisted." },
      ];
    case "evidence_only":
      return [
        { tools: ["evidence_pack"], required: true, reason: "Evidence-only run can package existing runtime evidence only." },
      ];
    default:
      return [];
  }
}
