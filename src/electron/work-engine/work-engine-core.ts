import { classifyWorkIntent } from "./intent";
import {
  resolveWorkRunbook,
  runbookRequiresEvidence,
  runbookRequiresValidation,
  runbookStopConditions,
} from "./runbook-resolver";
import type { SensitiveSurfaceKind, WorkPlan, WorkPlanMetadata, WorkRisk } from "./types";

export type WorkEngineMode = "build" | "plan" | "critic" | "security_review";

export type WorkPlanInputSnapshot = {
  prompt: string;
  mode: WorkEngineMode;
  workspace: {
    root: string;
    name: string;
  };
  git?: {
    branch?: string | null;
    changedFiles: string[];
    stagedFiles: string[];
    untrackedFiles: string[];
  };
  repoGraph?: {
    status: "ready" | "partial" | "unavailable";
    entrypoints: string[];
    impactedFiles: string[];
    relatedTests: string[];
    sensitiveSurfaces: Array<{
      kind: string;
      files: string[];
      reason: string;
    }>;
  };
  scripts?: Array<{
    name: string;
    command: string;
    signal: "test" | "lint" | "typecheck" | "build" | "dev" | "other";
  }>;
  failures?: Array<{
    signature: string;
    command: string;
    status: string;
    lastSeenAt: string;
  }>;
  privacy?: {
    status: "active" | "inactive" | "blocked" | "unknown";
    strict: boolean;
    redactions: number;
    categories: string[];
  };
};

export function buildWorkPlanFromSnapshot(snapshot: WorkPlanInputSnapshot): WorkPlan {
  const intent = classifyWorkIntent(snapshot.prompt);
  const changedFiles = changedFilesFromSnapshot(snapshot);
  const risk = inferRisk(snapshot, intent, changedFiles);
  const runbook = resolveWorkRunbook(intent, risk);
  const validationRequired = runbookRequiresValidation(runbook, risk, changedFiles);
  const evidenceRequired = runbookRequiresEvidence(runbook, changedFiles);
  const primaryCommand = selectScript(snapshot.scripts ?? [], ["test", "typecheck", "lint", "build"])?.command ?? null;
  const fallbackCommand =
    risk === "high"
      ? selectScript(snapshot.scripts ?? [], ["typecheck", "lint", "build"], primaryCommand)?.command ?? null
      : null;

  return {
    id: createPureWorkPlanId(snapshot),
    intent,
    risk,
    objective: snapshot.prompt,
    runbook,
    workingSet: {
      primaryFiles: primaryFilesFromSnapshot(snapshot, changedFiles),
      relatedFiles: [],
      relatedTests: snapshot.repoGraph?.relatedTests ?? [],
      changedFiles,
      impactedFiles: snapshot.repoGraph?.impactedFiles ?? [],
      entrypoints: snapshot.repoGraph?.entrypoints ?? [],
      sensitiveSurfaces: (snapshot.repoGraph?.sensitiveSurfaces ?? []).map((surface) => ({
        kind: normalizeSensitiveSurfaceKind(surface.kind),
        files: surface.files,
        reason: surface.reason,
      })),
      relevantScripts: (snapshot.scripts ?? [])
        .filter((script) => !isRuntimePollutionText(`${script.name}\n${script.command}`))
        .map((script) => ({
          name: script.name,
          command: script.command,
          reason: `${script.signal} script from workspace snapshot.`,
        })),
      knownFailures: (snapshot.failures ?? []).filter((failure) => !isRuntimePollutionText(`${failure.command}\n${failure.signature}`)),
    },
    validationPlan: {
      required: validationRequired,
      primaryCommand: validationRequired ? primaryCommand : null,
      fallbackCommand,
      reason: validationRequired
        ? `${runbook} requires runtime validation before final confidence claims.`
        : null,
    },
    privacyPlan: {
      requireSanitization: intent !== "answer" || (snapshot.privacy?.redactions ?? 0) > 0,
      blockIfP0Unsanitized: snapshot.privacy?.strict ?? true,
      includeRepoContext: intent !== "answer",
      includeToolOutput: evidenceRequired,
      reason: privacyReason(snapshot),
    },
    evidencePlan: {
      required: evidenceRequired,
      expectedArtifacts: expectedEvidenceArtifacts(runbook, changedFiles),
      requiredClaims: requiredEvidenceClaims(runbook),
    },
    stopConditions: runbookStopConditions(runbook),
  };
}

export function renderWorkPlanForPrompt(workPlan: WorkPlan) {
  return JSON.stringify(workPlan, null, 2);
}

export function buildWorkPlanMetadata(
  workPlan: WorkPlan,
  privacyPreflightStatus: WorkPlanMetadata["privacyPreflightStatus"],
  finalOutcome: WorkPlanMetadata["finalOutcome"] = "pending",
): WorkPlanMetadata {
  return {
    workPlanId: workPlan.id,
    intent: workPlan.intent,
    runbook: workPlan.runbook,
    risk: workPlan.risk,
    workingSetSummary: {
      primaryFiles: workPlan.workingSet.primaryFiles.length,
      relatedFiles: workPlan.workingSet.relatedFiles.length,
      relatedTests: workPlan.workingSet.relatedTests.length,
      changedFiles: workPlan.workingSet.changedFiles.length,
      impactedFiles: workPlan.workingSet.impactedFiles.length,
      sensitiveSurfaces: workPlan.workingSet.sensitiveSurfaces.length,
      knownFailures: workPlan.workingSet.knownFailures.length,
    },
    validationRequired: workPlan.validationPlan.required,
    privacyPreflightStatus,
    evidenceRequired: workPlan.evidencePlan.required,
    finalOutcome,
  };
}

function inferRisk(
  snapshot: WorkPlanInputSnapshot,
  intent: ReturnType<typeof classifyWorkIntent>,
  changedFiles: string[],
): WorkRisk {
  // Prompt-keyword escalation is always authoritative.
  if (/\b(auth|secret|security|rce|ssrf|injection|payment|database|migration)\b/i.test(snapshot.prompt)) {
    return "high";
  }
  // Security-review mode with sensitive surfaces in the repo graph.
  if ((snapshot.repoGraph?.sensitiveSurfaces.length ?? 0) > 0 && snapshot.mode === "security_review") {
    return "high";
  }
  // For review_changes with no actual changed files, repo-graph surfaces are
  // advisory context only — they must not drive current-change risk to medium/high.
  if (intent === "review_changes" && changedFiles.length === 0) {
    return "low";
  }
  // General risk from change volume.
  if (changedFiles.length > 8 || (snapshot.repoGraph?.impactedFiles.length ?? 0) > 10) {
    return "medium";
  }
  if (changedFiles.length > 0) {
    return "medium";
  }
  return "low";
}

function primaryFilesFromSnapshot(snapshot: WorkPlanInputSnapshot, changedFiles: string[]) {
  if (changedFiles.length > 0) return changedFiles.slice(0, 12);
  return [
    ...(snapshot.repoGraph?.entrypoints ?? []).slice(0, 6),
    ...(snapshot.repoGraph?.impactedFiles ?? []).slice(0, 6),
  ];
}

function changedFilesFromSnapshot(snapshot: WorkPlanInputSnapshot) {
  return [
    ...(snapshot.git?.changedFiles ?? []),
    ...(snapshot.git?.stagedFiles ?? []),
    ...(snapshot.git?.untrackedFiles ?? []),
  ].filter((file, index, files) => file && files.indexOf(file) === index).slice(0, 40);
}

function selectScript(
  scripts: NonNullable<WorkPlanInputSnapshot["scripts"]>,
  names: string[],
  excludeCommand?: string | null,
) {
  return scripts.find(
    (script) =>
      !isRuntimePollutionText(`${script.name}\n${script.command}`) &&
      script.command !== excludeCommand &&
      (names.includes(script.signal) || names.some((name) => script.name.toLowerCase().includes(name))),
  );
}

function isRuntimePollutionText(text: string) {
  return /(?:^|\s)test:[^\s]*work[^\s]*engine\b|work-engine\/bench|bench[^\s]*\/fixtures|fixture-repo|enforcement-advers|self.?smoke/i.test(text);
}

function normalizeSensitiveSurfaceKind(kind: string): SensitiveSurfaceKind {
  if (["env", "ipc", "http", "shell", "filesystem", "network", "database", "dependency", "auth"].includes(kind)) {
    return kind as SensitiveSurfaceKind;
  }
  return "unknown";
}

function privacyReason(snapshot: WorkPlanInputSnapshot) {
  if (!snapshot.privacy) return "Privacy Sentinel status unavailable; treat cloud context as requiring preflight.";
  if (snapshot.privacy.status === "blocked") return "Privacy Sentinel blocked unsafe context.";
  if (snapshot.privacy.redactions > 0) {
    return `Privacy Sentinel has ${snapshot.privacy.redactions} redaction(s): ${snapshot.privacy.categories.join(", ")}.`;
  }
  return "Repo context, tool output, memory, and evidence payloads must pass Privacy Sentinel before cloud transit.";
}

function expectedEvidenceArtifacts(runbook: WorkPlan["runbook"], changedFiles: string[]) {
  if (runbook === "evidence_only") return ["existing runtime records", "missing evidence list"];
  if (runbook === "patch_test_verify") return ["files changed", "validation command", "validation persistence"];
  if (runbook === "audit_reproduce_remediate" || runbook === "trace_source_to_sink") {
    return ["source", "path", "sink", "mitigation check", "exploitability proof"];
  }
  // For a read-only review with no changed files, no evidence artifact is expected.
  if (runbook === "review_classify_summarize" && changedFiles.length === 0) return [];
  return ["files inspected", "commands run", "unresolved risks"];
}

function requiredEvidenceClaims(runbook: WorkPlan["runbook"]) {
  if (runbook === "patch_test_verify") return ["changed files", "validation status", "unresolved risks"];
  if (runbook === "audit_reproduce_remediate" || runbook === "trace_source_to_sink") {
    return ["candidate/proven wording", "source-to-sink proof", "affected file evidence"];
  }
  return ["runtime evidence source", "missing evidence"];
}

function createPureWorkPlanId(snapshot: WorkPlanInputSnapshot) {
  const hash = `${snapshot.workspace.root}:${snapshot.prompt}:${Date.now()}:${Math.random()}`
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  return `work-plan-${hash.toString(36)}`;
}
