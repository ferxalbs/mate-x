import type { WorkIntent, WorkRisk, WorkRunbook } from "./types";

export function resolveWorkRunbook(intent: WorkIntent, _risk: WorkRisk): WorkRunbook {
  switch (intent) {
    case "answer":
      return "answer_from_context";
    case "inspect":
      return "inspect_explain";
    case "review_changes":
      return "review_classify_summarize";
    case "patch":
      return "patch_test_verify";
    case "validate":
      return "validate_only";
    case "security_review":
      return "audit_reproduce_remediate";
    case "trace_issue":
      return "trace_source_to_sink";
    case "generate_evidence":
      return "evidence_only";
    default:
      return "answer_from_context";
  }
}

export function runbookRequiresValidation(
  runbook: WorkRunbook,
  _risk: WorkRisk,
  _changedFiles: string[] = [],
) {
  // patch_test_verify and validate_only always require validation.
  if (runbook === "patch_test_verify" || runbook === "validate_only") return true;
  // review_classify_summarize is read-only. It classifies current diff risk; it does not patch or validate.
  if (runbook === "review_classify_summarize") return false;
  return false;
}

export function runbookRequiresEvidence(
  runbook: WorkRunbook,
  _changedFiles: string[] = [],
) {
  // Evidence-heavy runbooks always require it regardless of file count.
  if (
    [
      "patch_test_verify",
      "audit_reproduce_remediate",
      "trace_source_to_sink",
      "validate_only",
      "evidence_only",
    ].includes(runbook)
  ) {
    return true;
  }
  // Read-only review evidence is the working set/tool trace, not an Evidence Pack artifact.
  if (runbook === "review_classify_summarize") return false;
  return false;
}

export function runbookStopConditions(runbook: WorkRunbook) {
  const common = [
    "Stop before broad repo exploration when working set evidence is enough.",
    "Stop before cloud send when Privacy Sentinel blocks unsanitized P0 context.",
  ];
  if (runbook === "patch_test_verify") {
    return [
      ...common,
      "Do not claim fixed/ready/works unless validation runtime evidence exists.",
      "For high-risk patch, run fallback validation when planner requires it.",
    ];
  }
  if (runbook === "audit_reproduce_remediate" || runbook === "trace_source_to_sink") {
    return [
      ...common,
      "Do not call a candidate a vulnerability without source, path, sink, mitigation, exploitability, and file evidence.",
    ];
  }
  if (runbook === "evidence_only") {
    return [...common, "Do not invent evidence; package only runtime records."];
  }
  return common;
}
