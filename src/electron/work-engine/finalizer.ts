import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";
import type { WorkStage, WorkStageId } from "./stages";

export type FinalRunVerdict =
  | "success"
  | "partial"
  | "blocked"
  | "failed"
  | "needs_validation"
  | "needs_evidence";

export interface WorkEngineFinalization {
  verdict: FinalRunVerdict;
  content: string;
  warnings: string[];
}

const CLAIM_PATTERNS = [
  /\bfixed\b/gi,
  /\bshould be fixed\b/gi,
  /\blooks good\b/gi,
  /\bsafe to merge\b/gi,
  /\bvalidated\b/gi,
  /\bvalidated by inspection\b/gi,
  /\btests passed\b/gi,
  /\btested\b/gi,
  /\btests appear fine\b/gi,
  /\bsafe\b/gi,
  /\bno issue\b/gi,
  /\bno obvious issue\b/gi,
  /\bresolved\b/gi,
  /\bvulnerability\b/gi,
  /\bmerge-ready\b/gi,
  /\bmerge ready\b/gi,
  /\bcomplete\b/gi,
  /\bproduction-ready\b/gi,
  /\brisk is gone\b/gi,
  /\bverified manually\b/gi,
  /\bpatch is correct\b/gi,
];

const SECURITY_OVERCLAIM_PATTERNS = [
  /\bsecurity issue confirmed\b/gi,
  /\bconfirmed issue\b/gi,
  /\breal vuln\b/gi,
  /\bexploitable\b/gi,
  /\bRCE\b/g,
  /\bSSRF\b/g,
  /\bauth bypass\b/gi,
  /\bsecret leak\b/gi,
  /\bcritical\b/gi,
  /\bhigh severity\b/gi,
  /\bsource-to-sink confirmed\b/gi,
  /\bexploit is possible\b/gi,
];

export function finalizeWorkRun(input: {
  workPlan: WorkPlan;
  stages: WorkStage[];
  toolExecutions: ToolExecutionRecord[];
  content: string;
  evidenceAttached: boolean;
}): WorkEngineFinalization {
  const warnings: string[] = [];
  const missingRequired = requiredStages(input.workPlan, input.stages)
    .filter((stageId) => !stagePassedOrSkipped(input.stages, stageId));
  const failedValidation = stageStatus(input.stages, "validation_executed") === "failed";
  const failedValidationHardBlocker = shouldFailedValidationBlock({
    workPlan: input.workPlan,
    stages: input.stages,
    failedValidation,
  });
  const fallbackMissing = fallbackRequiredButMissing(input.workPlan, input.toolExecutions);
  const blocked = input.stages.some((stage) => stage.status === "blocked");

  if (missingRequired.includes("validation_executed")) {
    warnings.push("Validation evidence missing or blocked; final confidence downgraded.");
  }
  if (missingRequired.includes("evidence_attached")) {
    warnings.push("Evidence status missing; final recommendation cannot be proof-backed.");
  }
  if (fallbackMissing) {
    warnings.push("High-risk fallback validation is required but missing.");
  }
  if (input.workPlan.runbook === "evidence_only" && !input.evidenceAttached) {
    warnings.push("Evidence-only run has no runtime Evidence Pack to package.");
  }
  if (
    securityProofRequired(input.workPlan) &&
    !stagePassedOrSkipped(input.stages, "security_proof_checked") &&
    /\bvulnerability\b/i.test(input.content)
  ) {
    warnings.push("Confirmed vulnerability wording unsupported by security proof stage.");
  }
  if (failedValidation && !failedValidationHardBlocker) {
    warnings.push("Validation command failed but validation was not required for this run.");
  }
  if (failedValidation && /\b(passed|validated|works|complete|ready)\b/i.test(input.content)) {
    warnings.push("Validation failed; unsupported validation success wording was downgraded.");
  }

  const verdict = resolveVerdict({
    missingRequired,
    failedValidationHardBlocker,
    fallbackMissing,
    blocked,
    evidenceRequired: input.workPlan.evidencePlan.required,
    evidenceAttached: input.evidenceAttached,
  });
  const content = rewriteUnsupportedClaims(input.content, input.stages, warnings);

  return { verdict, content: appendHonestStatus(content, verdict, warnings), warnings };
}

function shouldFailedValidationBlock(input: {
  workPlan: WorkPlan;
  stages: WorkStage[];
  failedValidation: boolean;
}) {
  if (!input.failedValidation) return false;
  if (isReadOnlyNoChangeReview(input.workPlan, input.stages)) return false;
  if (input.workPlan.validationPlan.required) return true;
  if (input.workPlan.intent === "validate") return true;
  if (input.workPlan.runbook === "patch_test_verify") return true;
  if (stageStatus(input.stages, "patch_attempted") === "passed") return true;
  if (securityProofRequired(input.workPlan)) return true;
  return false;
}

function isReadOnlyNoChangeReview(workPlan: WorkPlan, stages: WorkStage[]) {
  return (
    workPlan.validationPlan.required === false &&
    workPlan.intent === "review_changes" &&
    workPlan.workingSet.changedFiles.length === 0 &&
    stageStatus(stages, "patch_attempted") === "skipped"
  );
}

function securityProofRequired(workPlan: WorkPlan) {
  return workPlan.runbook === "audit_reproduce_remediate" || workPlan.runbook === "trace_source_to_sink";
}

function requiredStages(workPlan: WorkPlan, stages: WorkStage[]): WorkStageId[] {
  const noPatchNeeded =
    stageStatus(stages, "patch_attempted") === "skipped" &&
    stages.find((stage) => stage.id === "patch_attempted")?.source !== "model_claim" &&
    /no patch (?:was )?needed/i.test(stages.find((stage) => stage.id === "patch_attempted")?.reason ?? "");
  switch (workPlan.runbook) {
    case "patch_test_verify":
      return compactStages([
        "context_compiled",
        "files_inspected",
        "patch_attempted",
        workPlan.validationPlan.required && !noPatchNeeded ? "validation_planned" : null,
        workPlan.validationPlan.required && !noPatchNeeded ? "validation_executed" : null,
        "failure_memory_checked",
        "privacy_preflight_passed",
        "evidence_attached",
      ]);
    case "audit_reproduce_remediate":
      return ["context_compiled", "security_proof_checked", "privacy_preflight_passed", "evidence_attached"];
    case "trace_source_to_sink":
      return ["context_compiled", "security_proof_checked", "privacy_preflight_passed"];
    case "validate_only":
      return ["context_compiled", "validation_planned", "validation_executed", "failure_memory_checked", "privacy_preflight_passed"];
    case "evidence_only":
      return ["context_compiled", "privacy_preflight_passed", "evidence_attached"];
    default:
      return ["context_compiled", "privacy_preflight_passed"];
  }
}

function compactStages(stages: Array<WorkStageId | null>): WorkStageId[] {
  return stages.filter((stage): stage is WorkStageId => Boolean(stage));
}

function stagePassedOrSkipped(stages: WorkStage[], id: WorkStageId) {
  const stage = stages.find((item) => item.id === id);
  if (!stage) return false;
  if (stage.status !== "passed" && stage.status !== "skipped") return false;
  if (stage.source === "model_claim" && hardRuntimeStages().has(id)) return false;
  return true;
}

function stageStatus(stages: WorkStage[], id: WorkStageId) {
  return stages.find((stage) => stage.id === id)?.status ?? "pending";
}

function hardRuntimeStages() {
  return new Set<WorkStageId>([
    "files_inspected",
    "patch_attempted",
    "validation_planned",
    "validation_executed",
    "failure_memory_checked",
    "security_proof_checked",
    "evidence_attached",
  ]);
}

function fallbackRequiredButMissing(workPlan: WorkPlan, toolExecutions: ToolExecutionRecord[]) {
  if (workPlan.risk !== "high" || !workPlan.validationPlan.fallbackCommand) {
    return false;
  }
  return !toolExecutions.some((execution) => {
    const haystack = `${JSON.stringify(execution.args)}\n${execution.output}`;
    return haystack.includes(workPlan.validationPlan.fallbackCommand ?? "\u0000");
  });
}

function resolveVerdict(input: {
  missingRequired: WorkStageId[];
  failedValidationHardBlocker: boolean;
  fallbackMissing: boolean;
  blocked: boolean;
  evidenceRequired: boolean;
  evidenceAttached: boolean;
}): FinalRunVerdict {
  if (input.blocked) return "blocked";
  if (input.failedValidationHardBlocker) return "failed";
  if (input.fallbackMissing) return "needs_validation";
  if (input.missingRequired.includes("validation_executed")) return "needs_validation";
  if (input.evidenceRequired && !input.evidenceAttached) return "needs_evidence";
  if (input.missingRequired.length > 0) return "partial";
  return "success";
}

function rewriteUnsupportedClaims(content: string, stages: WorkStage[], warnings: string[]) {
  const validationOk = stageStatus(stages, "validation_executed") === "passed";
  const proofOk = stageStatus(stages, "security_proof_checked") === "passed";
  let next = content;

  if (!validationOk) {
    next = next
      .replace(/\bshould be fixed\b/gi, "may be patched, validation pending")
      .replace(/\blooks good\b/gi, "looks unverified")
      .replace(/\bsafe to merge\b/gi, "merge safety not proven")
      .replace(/\bvalidated by inspection\b/gi, "reviewed by inspection; runtime validation pending")
      .replace(/\btests passed\b/gi, "runtime checks not proven")
      .replace(/\btests appear fine\b/gi, "tests not proven by runtime evidence")
      .replace(/\bno obvious issue\b/gi, "no proven issue from available evidence")
      .replace(/\bresolved\b/gi, "resolution unverified")
      .replace(/\bproduction-ready\b/gi, "not production-ready")
      .replace(/\brisk is gone\b/gi, "risk not proven resolved")
      .replace(/\bverified manually\b/gi, "manual verification claim unsupported")
      .replace(/\bpatch is correct\b/gi, "patch correctness not proven")
      .replace(/\bfixed\b/gi, "patched with validation pending")
      .replace(/\bvalidated\b/gi, "validation not proven")
      .replace(/\btested\b/gi, "runtime checks not proven")
      .replace(/\bmerge-ready\b/gi, "merge safety not proven")
      .replace(/\bmerge ready\b/gi, "merge safety not proven")
      .replace(/\bcomplete\b/gi, "incomplete");
  }
  if (!proofOk) {
    next = next
      .replace(/\bsecurity issue confirmed\b/gi, "candidate security issue")
      .replace(/\bconfirmed issue\b/gi, "candidate issue")
      .replace(/\breal vuln\b/gi, "candidate issue")
      .replace(/\bexploitable\b/gi, "exploitability unproven")
      .replace(/\bRCE\b/g, "potential code execution candidate")
      .replace(/\bSSRF\b/g, "potential SSRF candidate")
      .replace(/\bauth bypass\b/gi, "potential auth bypass candidate")
      .replace(/\bsecret leak\b/gi, "potential secret exposure")
      .replace(/\bcritical\b/gi, "severity unproven")
      .replace(/\bhigh severity\b/gi, "severity unproven")
      .replace(/\bsource-to-sink confirmed\b/gi, "source-to-sink proof incomplete")
      .replace(/\bexploit is possible\b/gi, "exploitability needs proof")
      .replace(/\bconfirmed vulnerability\b/gi, "candidate issue")
      .replace(/\bvulnerability\b/gi, "candidate issue")
      .replace(/\bno issue\b/gi, "no proven issue");
  }
  if (
    [...CLAIM_PATTERNS, ...SECURITY_OVERCLAIM_PATTERNS].some((pattern) => pattern.test(content)) &&
    next !== content
  ) {
    warnings.push("Unsupported final claim wording was downgraded by Work Engine.");
  }

  return next;
}

function appendHonestStatus(content: string, verdict: FinalRunVerdict, warnings: string[]) {
  const warningBlock = warnings.length > 0 ? `\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
  return `${content.trim()}\n\nWork Engine verdict: ${verdict}.${warningBlock}`;
}
