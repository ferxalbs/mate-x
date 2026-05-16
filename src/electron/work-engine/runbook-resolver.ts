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

export function runbookRequiresValidation(runbook: WorkRunbook, risk: WorkRisk) {
  return (
    runbook === "patch_test_verify" ||
    runbook === "validate_only" ||
    (runbook === "review_classify_summarize" && risk !== "low")
  );
}

export function runbookRequiresEvidence(runbook: WorkRunbook) {
  return [
    "patch_test_verify",
    "audit_reproduce_remediate",
    "trace_source_to_sink",
    "validate_only",
    "review_classify_summarize",
    "evidence_only",
  ].includes(runbook);
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
