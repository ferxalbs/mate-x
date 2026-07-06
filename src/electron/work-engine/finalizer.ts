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

export type SecurityProofLedger = Array<{
  claimKind: string;
  sourcePath: string;
  sinkPath: string;
  evidenceIds: string[];
}>;

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
  /\bvulnerable\b/gi,
  /\bvulnerability\b/gi,
  /\bhigh-severity\b/gi,
  /\bcritical\b/gi,
  /\bhigh severity\b/gi,
  /\bbrute-force\b/gi,
  /\bresource exhaustion\b/gi,
  /\bsecurity of\b[\s\S]{0,80}\bis strictly tied\b/gi,
  /\beffectively disables\b/gi,
  /\bsource-to-sink confirmed\b/gi,
  /\bexploit is possible\b/gi,
];

const PRIVACY_SENTINEL_PLACEHOLDER_RE =
  /\[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\]/g;

const PRIVACY_PLACEHOLDER_MISUSE_RE =
  /\[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\][\s\S]{0,240}\b(SQL injection|placeholder|replace|template|tenant|route|file|user|org|organization|database|environment corruption|high risk|unsafe|vulnerab|exploit|severity)\b|\b(SQL injection|placeholder|replace|template|tenant|route|file|user|org|organization|database|environment corruption|high risk|unsafe|vulnerab|exploit|severity)[\s\S]{0,240}\[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\]/i;

export function finalizeWorkRun(input: {
  workPlan: WorkPlan;
  stages: WorkStage[];
  toolExecutions: ToolExecutionRecord[];
  content: string;
  evidenceAttached: boolean;
}): WorkEngineFinalization {
  const warnings: string[] = [];
  const securityProofLedger = buildSecurityProofLedger(input.toolExecutions);
  const confirmedSecurityClaims = extractConfirmedSecurityClaims(input.content);
  const unmatchedSecurityClaims = confirmedSecurityClaims.filter(
    (claim) => !claimMatchesSecurityProofLedger(claim, securityProofLedger),
  );
  const rawMissingRequired = requiredStages(input.workPlan, input.stages)
    .filter((stageId) => !stagePassedOrSkipped(input.stages, stageId));
  const missingRequired = rawMissingRequired.filter(
    (stageId) => stageId !== "security_proof_checked" || unmatchedSecurityClaims.length > 0,
  );
  const failedValidation = stageStatus(input.stages, "validation_executed") === "failed";
  const failedValidationHardBlocker = shouldFailedValidationBlock({
    workPlan: input.workPlan,
    stages: input.stages,
    failedValidation,
  });
  const fallbackMissing = fallbackRequiredButMissing(input.workPlan, input.toolExecutions);
  const blocked = input.stages.some((stage) => stage.status === "blocked");
  const preparatoryOnly = isPreparatoryOnly(input.content);
  const missingRuntimeEvidence = requiresRuntimeEvidence(input.workPlan) && input.toolExecutions.length === 0;
  const privacyPlaceholderMisuse = misusesPrivacySentinelPlaceholder(input.content);

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
    hasConfirmedSecurityWording(input.content)
  ) {
    warnings.push("Confirmed vulnerability wording unsupported by security proof stage.");
  }
  if (
    rawMissingRequired.includes("security_proof_checked") &&
    !missingRequired.includes("security_proof_checked")
  ) {
    warnings.push("Security proof was not run; risk language must remain candidate-level.");
  }
  if (failedValidation && !failedValidationHardBlocker) {
    warnings.push("Validation command failed but validation was not required for this run.");
  }
  if (failedValidation && /\b(passed|validated|works|complete|ready)\b/i.test(input.content)) {
    warnings.push("Validation failed; unsupported validation success wording was downgraded.");
  }
  if (preparatoryOnly) {
    warnings.push("Assistant returned a progress plan instead of a final repo-grounded answer.");
  }
  if (missingRuntimeEvidence) {
    warnings.push("No repository tool evidence was captured for a tool-backed security workflow.");
  }
  if (privacyPlaceholderMisuse) {
    warnings.push("Privacy Sentinel placeholder was treated as source evidence; raw private value was redacted before cloud transit.");
  }
  if (unmatchedSecurityClaims.length > 0) {
    warnings.push("Confirmed security claim wording was downgraded because no matching proof ledger entry referenced the claimed file/path.");
  }

  const verdict = resolveVerdict({
    missingRequired,
    failedValidationHardBlocker,
    fallbackMissing,
    blocked,
    preparatoryOnly,
    missingRuntimeEvidence,
    privacyPlaceholderMisuse,
    unmatchedSecurityClaims: unmatchedSecurityClaims.length,
    evidenceRequired: input.workPlan.evidencePlan.required,
    evidenceAttached: input.evidenceAttached,
  });
  const content = rewriteUnsupportedClaims(input.content, input.stages, warnings, unmatchedSecurityClaims.length > 0);

  return { verdict, content: appendHonestStatus(content, verdict, warnings, input.workPlan.objective), warnings };
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

function requiresRuntimeEvidence(workPlan: WorkPlan) {
  return (
    workPlan.intent === "security_review" ||
    workPlan.intent === "review_changes" ||
    workPlan.intent === "trace_issue" ||
    workPlan.runbook === "audit_reproduce_remediate" ||
    workPlan.runbook === "trace_source_to_sink"
  );
}

function isPreparatoryOnly(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const saysWillDoWork =
    /\b(I will|I'll|I’ll|Let me|I need to|First,?\s+I(?:'ll| will)|I will begin|I'll begin|I will start|I'll start)\b/i.test(normalized) &&
    /\b(inspect|check|examine|review|run|call|search|read|analy[sz]e|perform|identify)\b/i.test(normalized);
  const hasFinalSignal =
    /\b(Verdict:|Verdict summary:|Confidence:|Findings?:|Unresolved risks?:|Final recommendation:|Evidence:|No findings?|Candidate\b)\b/i.test(normalized);
  return saysWillDoWork && !hasFinalSignal;
}

function hasConfirmedSecurityWording(content: string) {
  return /\b(confirmed vulnerability|vulnerable|vulnerability|exploitable|source-to-sink confirmed|auth bypass|secret leak|critical|high[-\s]severity|brute-force|resource exhaustion|effectively disables)\b/i.test(content) ||
    /\bsecurity of\b[\s\S]{0,80}\bis strictly tied\b/i.test(content);
}

function buildSecurityProofLedger(toolExecutions: ToolExecutionRecord[]): SecurityProofLedger {
  return toolExecutions
    .filter((execution) => execution.toolName === "security_path_trace" || execution.toolName === "candidate_revalidator")
    .flatMap((execution, index) => {
      const evidenceId = `${execution.toolName}:${index}`;
      const paths = extractProofPaths(execution);
      return paths.map((path) => ({
        claimKind: String(execution.args.title ?? execution.toolName),
        sourcePath: path,
        sinkPath: path,
        evidenceIds: [evidenceId],
      }));
    });
}

function extractProofPaths(execution: ToolExecutionRecord) {
  const paths = new Set<string>();
  for (const key of ["file", "path", "sourcePath", "sinkPath"]) {
    const value = execution.args[key];
    if (typeof value === "string" && value.trim()) {
      paths.add(normalizeProofPath(value));
    }
  }

  const locationMatch = execution.output.match(/\bLocation:\s*([^\s:]+(?:\/[^\s:]+)*)(?::\d+)?/i);
  if (locationMatch?.[1]) {
    paths.add(normalizeProofPath(locationMatch[1]));
  }

  for (const match of execution.output.matchAll(/\b((?:src|app|pages|lib|server|api|electron|contracts)\/[A-Za-z0-9._/-]+)(?::\d+)?\b/g)) {
    paths.add(normalizeProofPath(match[1]));
  }

  return Array.from(paths).filter(Boolean);
}

function extractConfirmedSecurityClaims(content: string) {
  return content
    .split(/\n+|(?<=[.!?])\s+/)
    .map((text) => text.trim())
    .filter((text) => text && hasConfirmedSecurityWording(text))
    .map((text) => ({
      text,
      paths: extractClaimPaths(text),
    }));
}

function extractClaimPaths(content: string) {
  const paths = new Set<string>();
  for (const match of content.matchAll(/\b((?:src|app|pages|lib|server|api|electron|contracts)\/[A-Za-z0-9._/-]+)(?::\d+)?\b/g)) {
    paths.add(normalizeProofPath(match[1]));
  }
  return Array.from(paths);
}

function claimMatchesSecurityProofLedger(
  claim: { text: string; paths: string[] },
  ledger: SecurityProofLedger,
) {
  if (claim.paths.length === 0) return false;
  return claim.paths.some((claimPath) =>
    ledger.some((entry) =>
      pathsReferToSameFile(claimPath, entry.sourcePath) ||
      pathsReferToSameFile(claimPath, entry.sinkPath),
    ),
  );
}

function pathsReferToSameFile(left: string, right: string) {
  const normalizedLeft = normalizeProofPath(left);
  const normalizedRight = normalizeProofPath(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`);
}

function normalizeProofPath(path: string) {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^["'`([{]+|["'`)\]},.;]+$/g, "")
    .trim();
}

function misusesPrivacySentinelPlaceholder(content: string) {
  return PRIVACY_PLACEHOLDER_MISUSE_RE.test(content);
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
  preparatoryOnly: boolean;
  missingRuntimeEvidence: boolean;
  privacyPlaceholderMisuse: boolean;
  unmatchedSecurityClaims: number;
  evidenceRequired: boolean;
  evidenceAttached: boolean;
}): FinalRunVerdict {
  if (input.blocked) return "blocked";
  if (input.failedValidationHardBlocker) return "failed";
  if (input.fallbackMissing) return "needs_validation";
  if (input.missingRequired.includes("validation_executed")) return "needs_validation";
  if (input.evidenceRequired && !input.evidenceAttached) return "needs_evidence";
  if (input.preparatoryOnly || input.missingRuntimeEvidence || input.privacyPlaceholderMisuse || input.unmatchedSecurityClaims > 0) return "partial";
  if (input.missingRequired.length > 0) return "partial";
  return "success";
}

function rewriteUnsupportedClaims(content: string, stages: WorkStage[], warnings: string[], forceProofDowngrade = false) {
  const validationOk = stageStatus(stages, "validation_executed") === "passed";
  const proofOk = stageStatus(stages, "security_proof_checked") === "passed" && !forceProofDowngrade;
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
      .replace(/\bsuccessfully validated\b/gi, "validation was not proven")
      .replace(/\bfixed\b/gi, "patched with validation pending")
      .replace(/\bvalidated\b/gi, "validation was not proven")
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
      .replace(/\bvulnerable\b/gi, "potentially exposed")
      .replace(/\bhigh-severity\b/gi, "severity-unproven")
      .replace(/\bcritical\b/gi, "severity unproven")
      .replace(/\bhigh severity\b/gi, "severity unproven")
      .replace(/\bbrute-force\b/gi, "automated-abuse candidate")
      .replace(/\bresource exhaustion\b/gi, "resource-exhaustion candidate")
      .replace(/\beffectively disables\b/gi, "may weaken")
      .replace(/\bsource-to-sink confirmed\b/gi, "source-to-sink proof incomplete")
      .replace(/\bexploit is possible\b/gi, "exploitability needs proof")
      .replace(/\bconfirmed vulnerability\b/gi, "candidate issue")
      .replace(/\bvulnerability\b/gi, "candidate issue")
      .replace(/\bno issue\b/gi, "no proven issue");
  }
  next = rewritePrivacySentinelPlaceholderMisuse(next);
  if (
    [...CLAIM_PATTERNS, ...SECURITY_OVERCLAIM_PATTERNS].some((pattern) => pattern.test(content)) &&
    next !== content
  ) {
    warnings.push("Final wording was calibrated because runtime evidence did not prove every claim.");
  }

  return next;
}

function rewritePrivacySentinelPlaceholderMisuse(content: string) {
  if (!PRIVACY_SENTINEL_PLACEHOLDER_RE.test(content)) return content;
  PRIVACY_SENTINEL_PLACEHOLDER_RE.lastIndex = 0;
  return content
    .replace(/\bReplace the \[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\] placeholders?\b/gi, "Do not treat Privacy Sentinel redaction tokens as raw source values")
    .replace(/\bThe presence of (\[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\]) strongly suggests\b/gi, "The Privacy Sentinel redaction token $1 only shows that private data was withheld before cloud transit; it does not prove")
    .replace(/\b(\[(?:SECRET(?:_[A-Z_]+)?|PROMPT_SENSITIVE|PRIVATE_FILE_PATH|INTERNAL_URL|WORKSPACE_IDENTITY|CUSTOMER_DATA|STACKTRACE_SENSITIVE|PRIVATE_EMAIL|PRIVATE_PHONE|ACCOUNT_NUMBER|PAYMENT_TOKEN|PERSONAL_DOCUMENT_ID|PRIVATE_URL|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_DATE)\]) placeholders?\b/gi, "$1 Privacy Sentinel redaction token")
    .replace(/\bdue to (?:severity[-\s]unproven )?SQL Injection Risk in templated code\b/gi, "requires raw-source verification because Privacy Sentinel redacted private values")
    .replace(/\bDo not rely on text replacement of sensitive identifiers in SQL strings\./gi, "Verify raw local source before concluding that redacted identifiers are literal SQL text.");
}

function appendHonestStatus(content: string, verdict: FinalRunVerdict, warnings: string[], objective: string = "") {
  const isCasual = /^(hi|hello|hey|how are you|thanks|thank you|ok|okay|cool|nice|great|casual conversation|general chat\b.*)$/i.test(objective.toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim());

  if (isCasual) {
    return content.replace(/\n*Work Engine verdict: (?:success|partial|blocked|failed|needs_validation|needs_evidence)\.[\s\S]*$/i, "").trim();
  }

  const warningBlock = warnings.length > 0 ? `\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
  const cleanContent = content
    .replace(/\n*Work Engine verdict: (?:success|partial|blocked|failed|needs_validation|needs_evidence)\.[\s\S]*$/i, "")
    .trim();
  return `${cleanContent}\n\nWork Engine verdict: ${verdict}.${warningBlock}`;
}
