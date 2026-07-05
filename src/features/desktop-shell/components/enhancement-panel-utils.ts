import type { GitStatus } from "../../../contracts/git";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type {
  WorkspaceHealthProfile,
  WorkspaceSummary,
} from "../../../contracts/workspace";
import type {
  ChatMessage,
  Conversation,
  EvidencePack,
  RunStatus,
  ToolEvent,
} from "../../../contracts/chat";

export type ImpactRisk = "High" | "Medium" | "Low" | "None";
export type SignalTone = "good" | "watch" | "warn" | "bad" | "muted";
export type TrustGateVerdict =
  | "Trusted / Ready"
  | "Resolving trust"
  | "Needs validation"
  | "Risky change"
  | "Blocked"
  | "Unknown / Not proven";
export type TrustGateStatus =
  | "trusted"
  | "resolving"
  | "needs_validation"
  | "risky"
  | "blocked"
  | "unknown";
export type TrustGateConfidence = "verified" | "high" | "medium" | "low" | "none";
export type TrustGateValidationState =
  | "passed"
  | "failed"
  | "planned"
  | "not_run";
export type TrustGateStopState = "none" | "resolved" | "unresolved";
export type TrustGateEvidenceState =
  | "signed_strong"
  | "present_weak"
  | "present_missing_validation"
  | "missing";

export interface ImpactSummary {
  affectedCount: number;
  serviceCount: number;
  toolFanoutCount: number;
  risk: ImpactRisk;
}

export interface RepoHealthSignal {
  label: string;
  value: string;
  tone: SignalTone;
}

export interface TrustGateState {
  status: TrustGateStatus;
  verdict: TrustGateVerdict;
  confidenceLabel: TrustGateConfidence;
  tone: SignalTone;
  reasons: string[];
  why: string[];
  missingProof: string[];
  touchedRiskSurfaces: string[];
  validationState: TrustGateValidationState;
  policyStopState: TrustGateStopState;
  evidencePackState: TrustGateEvidenceState;
  suggestedNextAction: string;
  nextAction: string;
  proofLabel: string;
  sourceSignalsUsed: string[];
}

export function getChangedFiles(status: GitStatus) {
  return [
    ...new Set([
      ...status.files.map((file) => file.path),
      ...status.modified,
      ...status.created,
      ...status.staged,
      ...status.renamed.map((file) => file.to),
    ]),
  ]
    .filter(Boolean)
    .sort();
}

export function summarizeImpact(
  changedFiles: string[],
  impactedFiles: RepoGraphImpactedFile[],
): ImpactSummary {
  const concreteImpacts = impactedFiles.filter((entry) => !entry.group);
  const serviceCount = concreteImpacts.filter(
    (entry) =>
      entry.file.startsWith("src/electron/") && !entry.file.includes("/tools/"),
  ).length;
  const toolFanoutCount = impactedFiles.reduce(
    (total, entry) =>
      total +
      (entry.group === "tool ecosystem"
        ? (entry.hiddenCount ?? 1)
        : entry.file.includes("/tools/")
          ? 1
          : 0),
    0,
  );
  const affectedCount =
    concreteImpacts.length +
    impactedFiles.reduce((total, entry) => total + (entry.hiddenCount ?? 0), 0);
  const risk =
    affectedCount >= 20 || serviceCount >= 6 || toolFanoutCount >= 10
      ? "High"
      : affectedCount >= 6 || serviceCount >= 3
        ? "Medium"
        : changedFiles.length > 0
          ? "Low"
          : "None";

  return {
    affectedCount,
    serviceCount,
    toolFanoutCount,
    risk,
  };
}

export function getRepoFields(health: WorkspaceHealthProfile | null) {
  if (!health) {
    return [
      ["Stack", "Detecting"],
      ["PM", "Unknown"],
      ["Test", "Map pending"],
      ["Lint", "Map pending"],
      ["Git", "Pending"],
      ["Secrets", "0"],
    ];
  }

  return [
    ["Stack", health.stack.join(", ")],
    ["PM", health.packageManager],
    ["Test", health.testCommand],
    ["Lint", health.lintCommand],
    ["Git", health.gitDirtyState],
    ["Secrets", String(health.secretWarningCount)],
  ];
}

export function getRepoHealthSignals(
  health: WorkspaceHealthProfile | null,
  workspace?: WorkspaceSummary | null,
): RepoHealthSignal[] {
  if (!health) {
    return workspace
      ? [
          {
            label: "Status",
            value: workspace.status,
            tone: workspace.status === "ready" ? "good" : "watch",
          },
          {
            label: "Branch",
            value: workspace.branch,
            tone: workspace.branch ? "good" : "muted",
          },
        ]
      : [];
  }

  const stackValue = health.stack.length > 0 ? health.stack.join(", ") : "Unknown";
  const hasTestCommand =
    Boolean(health.testCommand) && health.testCommand !== "unknown";
  const hasLintCommand =
    Boolean(health.lintCommand) && health.lintCommand !== "unknown";
  const secretCount = health.secretWarningCount;

  return [
    {
      label: "Stack",
      value: stackValue,
      tone: health.stack.length > 0 ? "good" : "warn",
    },
    {
      label: "PM",
      value: health.packageManager,
      tone: health.packageManager === "unknown" ? "warn" : "good",
    },
    {
      label: "Tests",
      value: health.testCommand,
      tone: hasTestCommand ? "good" : "warn",
    },
    {
      label: "Lint",
      value: health.lintCommand,
      tone: hasLintCommand ? "good" : "warn",
    },
    {
      label: "Git",
      value: health.gitDirtyState,
      tone: health.gitDirtyState === "clean" ? "good" : "watch",
    },
    {
      label: "Secrets",
      value: secretCount > 0 ? `${secretCount} risk signal${secretCount === 1 ? "" : "s"}` : "0 risk signals",
      tone: secretCount > 0 ? "bad" : "good",
    },
  ];
}

export function getRepoHealthVerdict(
  signals: RepoHealthSignal[],
  hasProfile: boolean,
) {
  if (!hasProfile) {
    const hasWorkspace = signals.some((signal) => signal.tone !== "muted");

    return {
      label: hasWorkspace ? "Pending" : "No repo",
      detail: hasWorkspace
        ? "Workspace metadata loaded. Run a scan to populate tests, lint, and secret signals."
        : "Open or import a workspace to start repo health analysis.",
      tone: hasWorkspace ? ("watch" as SignalTone) : ("muted" as SignalTone),
    };
  }

  if (signals.some((signal) => signal.tone === "bad")) {
    return {
      label: "Critical",
      detail: "Repo has blocking security signals.",
      tone: "bad" as SignalTone,
    };
  }

  if (signals.some((signal) => signal.tone === "warn")) {
    return {
      label: "Weak",
      detail: "Repo is missing core quality signals.",
      tone: "warn" as SignalTone,
    };
  }

  if (signals.some((signal) => signal.tone === "watch")) {
    return {
      label: "Watch",
      detail: "Repo usable, but live scan still resolving.",
      tone: "watch" as SignalTone,
    };
  }

  return {
    label: "Strong",
    detail: "Repo exposes usable verification signals.",
    tone: "good" as SignalTone,
  };
}

export function getVerificationCommands(tests: string[], health: WorkspaceHealthProfile | null) {
  const commands = [
    health?.testCommand,
    health?.lintCommand,
    health?.buildCommand,
    ...tests.slice(0, 2),
  ].filter((command): command is string => Boolean(command && command !== "unknown"));

  return [...new Set(commands)].slice(0, 3);
}

export function deriveTrustGate({
  changedFiles,
  commands,
  evidencePack,
  events = [],
  health,
  isRunning = false,
  summary,
}: {
  changedFiles: string[];
  commands: string[];
  evidencePack: EvidencePack | null;
  events?: ToolEvent[];
  health: WorkspaceHealthProfile | null;
  isRunning?: boolean;
  summary: ImpactSummary;
}): TrustGateState {
  const policyStops = evidencePack?.policyStops ?? [];
  const hasPolicyStop = policyStops.length > 0;
  const unresolvedPolicyStop = hasPolicyStop && policyStops.some((stop) => {
    const status = String((stop as { status?: unknown }).status ?? "");
    return !/complete|resolved|approved|resumed/i.test(status);
  });
  const evidenceVerdict = evidencePack?.verdict.label ?? "";
  const runBlocked =
    evidencePack?.status === "blocked" ||
    evidencePack?.status === "failed" ||
    /blocked|fail|error/i.test(evidenceVerdict);
  const hasVerifiedSignals = hasVerifiedEvidenceSignals(evidencePack);
  const score = getVerifiedEvidenceScore(evidencePack);
  const hasPassedValidationSignal =
    evidencePack?.verifiedTaskScore?.signals?.some(
      (signal) => signal.id === "validation_passed" && signal.satisfied,
    ) ?? false;
  const hasFailedValidationSignal =
    evidencePack?.verifiedTaskScore?.signals?.some(
      (signal) =>
        signal.id === "validation_command_executed" &&
        signal.satisfied &&
        evidencePack?.verifiedTaskScore?.status === "failed",
    ) ?? false;
  const hasExecutedValidation =
    (evidencePack?.commandsExecuted?.length ?? 0) > 0 ||
    hasPassedValidationSignal ||
    hasFailedValidationSignal;
  const hasValidation =
    hasExecutedValidation || commands.length > 0;
  const validationState: TrustGateValidationState = hasPassedValidationSignal
    ? "passed"
    : hasFailedValidationSignal
      ? "failed"
      : hasExecutedValidation
        ? score !== null && score >= 75
          ? "passed"
          : "failed"
        : commands.length > 0
          ? "planned"
          : "not_run";
  const dirtyState = health?.gitDirtyState ?? "unknown";
  const hasDirtyRepo = changedFiles.length > 0 || dirtyState !== "clean";
  const riskyFiles = changedFiles.filter(isRiskySurfacePath);
  const eventPolicyStop = events.some((event) =>
    /policy stop|approval|blocked/i.test(`${event.label} ${event.detail ?? ""}`),
  );
  const sourceSignalsUsed = [
    "git status",
    health ? "workspace health" : "",
    commands.length > 0 ? "validation planner commands" : "",
    changedFiles.length > 0 ? "changed files" : "",
    summary.affectedCount > 0 ? "RepoGraph impact" : "",
    evidencePack ? "Evidence Pack" : "",
    evidencePack?.verifiedTaskScore ? "VTS" : "",
    events.length > 0 ? "tool events" : "",
    hasPolicyStop || eventPolicyStop ? "policy stops" : "",
  ].filter(Boolean);
  const proofLabel = evidencePack
    ? hasVerifiedSignals
      ? "Ship Proof ready"
      : "Ship Proof needs evidence"
    : "No Ship Proof yet";
  const evidencePackState: TrustGateEvidenceState = !evidencePack
    ? "missing"
    : !hasVerifiedSignals || score === null
      ? "present_missing_validation"
      : score >= 85 && validationState === "passed"
        ? "signed_strong"
        : "present_weak";

  const buildState = (
    state: Omit<TrustGateState, "reasons" | "suggestedNextAction" | "sourceSignalsUsed">,
  ): TrustGateState => ({
    ...state,
    reasons: state.why,
    suggestedNextAction: state.nextAction,
    sourceSignalsUsed,
  });

  if (isRunning) {
    return buildState({
      status: "resolving",
      verdict: "Resolving trust",
      confidenceLabel: "none",
      tone: eventPolicyStop ? "warn" : "watch",
      proofLabel,
      why: [
        eventPolicyStop
          ? "A live tool or approval event may affect trust."
          : "Run is still producing tool, validation, and proof signals.",
        "Final Trust Gate waits for runtime evidence, not assistant wording.",
      ],
      missingProof: ["Final Evidence Pack/VTS verdict"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: eventPolicyStop ? "unresolved" : "none",
      evidencePackState,
      nextAction: "Wait for proof",
    });
  }

  if (unresolvedPolicyStop || runBlocked) {
    return buildState({
      status: "blocked",
      verdict: "Blocked",
      confidenceLabel: "low",
      tone: "bad",
      proofLabel,
      why: [
        hasPolicyStop ? "Unresolved policy stop recorded in proof data." : "Run ended blocked or failed.",
        "Agent changes are not trusted until proven.",
      ],
      missingProof: ["Resolved policy stop", "Passing validation evidence"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "unresolved" : "none",
      evidencePackState,
      nextAction: "Resolve policy stop",
    });
  }

  if (riskyFiles.length > 0 && !hasVerifiedSignals) {
    return buildState({
      status: "risky",
      verdict: "Risky change",
      confidenceLabel: "low",
      tone: "warn",
      proofLabel,
      why: [
        `${riskyFiles.length} auth, session, env, payment, network, dependency, IPC, or runtime surface change${riskyFiles.length === 1 ? "" : "s"} detected.`,
        hasValidation ? "Validation is planned but not proven by Ship Proof." : "No validation command is proven yet.",
      ],
      missingProof: ["Risk-surface validation", "Strong VTS evidence"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Review auth/session changes",
    });
  }

  if (!evidencePack) {
    return buildState({
      status: changedFiles.length > 0 ? "needs_validation" : "unknown",
      verdict: changedFiles.length > 0 ? "Needs validation" : "Unknown / Not proven",
      confidenceLabel: "none",
      tone: changedFiles.length > 0 ? "watch" : "muted",
      proofLabel,
      why: [
        changedFiles.length > 0
          ? `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"} found without Ship Proof.`
          : "No proof has been generated for the current workspace.",
        "MaTE X checks what your AI agent changed before you ship.",
      ],
      missingProof: ["Evidence Pack", "VTS", "Validation command result"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: changedFiles.length > 0 ? "Generate proof" : "Open Evidence details",
    });
  }

  if (!hasVerifiedSignals || score === null) {
    return buildState({
      status: "needs_validation",
      verdict: "Needs validation",
      confidenceLabel: "low",
      tone: "watch",
      proofLabel,
      why: [
        "Proof exists, but verified task signals are missing.",
        hasValidation ? "Validation commands exist but need verified results." : "No validation command evidence yet.",
      ],
      missingProof: ["Verified task signals", "Passing validation evidence"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Run focused validation",
    });
  }

  if (!hasExecutedValidation || validationState !== "passed") {
    return buildState({
      status: "needs_validation",
      verdict: "Needs validation",
      confidenceLabel: "medium",
      tone: "watch",
      proofLabel,
      why: [
        !hasExecutedValidation
          ? "Ship Proof has score signals, but no command evidence."
          : "Validation evidence did not prove a passing run.",
        "Can I ship this is still unproven.",
      ],
      missingProof: ["Passing validation command result"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Run focused validation",
    });
  }

  if (riskyFiles.length > 0 && evidencePackState !== "signed_strong") {
    return buildState({
      status: "risky",
      verdict: "Risky change",
      confidenceLabel: score >= 75 ? "medium" : "low",
      tone: "warn",
      proofLabel,
      why: [
        "Risky surfaces changed without strong proof.",
        "Review the remaining risk before merging.",
      ],
      missingProof: score < 85 ? ["Strong VTS score"] : ["Strong risky-surface proof"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Open Evidence details",
    });
  }

  if (hasDirtyRepo) {
    return buildState({
      status: "needs_validation",
      verdict: "Needs validation",
      confidenceLabel: "medium",
      tone: "watch",
      proofLabel,
      why: [
        dirtyState === "clean" ? "Changed files are still visible in git status." : `Repository is ${dirtyState}.`,
        "Proof may not cover the latest local diff.",
      ],
      missingProof: ["Proof for latest git diff"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Generate proof",
    });
  }

  if (summary.risk === "High" || score < 85) {
    return buildState({
      status: "risky",
      verdict: "Risky change",
      confidenceLabel: score >= 75 ? "medium" : "low",
      tone: "warn",
      proofLabel,
      why: [
        summary.risk === "High"
          ? "RepoGraph impact is high."
          : `Verified score is ${score}/100.`,
        "Review the remaining risk before merging.",
      ],
      missingProof: score < 85 ? ["Strong VTS score"] : [],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Open Evidence details",
    });
  }

  return buildState({
    status: "trusted",
    verdict: "Trusted / Ready",
    confidenceLabel: "verified",
    tone: "good",
    proofLabel,
    why: ["Verified Ship Proof is present.", "Validation evidence exists and git is clean."],
    missingProof: [],
    touchedRiskSurfaces: riskyFiles,
    validationState,
    policyStopState: hasPolicyStop ? "resolved" : "none",
    evidencePackState,
    nextAction: "Can ship",
  });
}

export interface PanelRuntimeSnapshot {
  latestAssistant: ChatMessage | null;
  evidencePack: EvidencePack | null;
  events: ToolEvent[];
  activeRunTitle: string | null;
  statusLabel: string;
  isRunning: boolean;
}

export function getPanelRuntimeSnapshot(
  conversation: Conversation | null,
  runStatus: RunStatus,
): PanelRuntimeSnapshot {
  const messages = conversation?.messages ?? [];
  const latestAssistant =
    [...messages].reverse().find((message) => message.role === "assistant") ??
    null;
  const activeRun =
    conversation?.runs?.find((run) => run.status === "running") ??
    conversation?.runs?.at(-1) ??
    null;
  const evidencePack =
    latestAssistant?.evidencePack ?? activeRun?.result?.evidencePack ?? null;

  return {
    latestAssistant,
    evidencePack,
    events: latestAssistant?.events ?? activeRun?.events ?? [],
    activeRunTitle: activeRun?.title ?? null,
    statusLabel:
      runStatus === "running"
        ? "Running"
        : evidencePack
          ? evidencePack.status
          : "No pack",
    isRunning: runStatus === "running",
  };
}

export function getVerifiedScore(evidencePack: EvidencePack | null) {
  return evidencePack?.verifiedTaskScore?.score ?? null;
}

export function hasVerifiedEvidenceSignals(evidencePack: EvidencePack | null) {
  return Boolean(evidencePack?.verifiedTaskScore?.signals?.length);
}

export function getVerifiedEvidenceScore(evidencePack: EvidencePack | null) {
  return hasVerifiedEvidenceSignals(evidencePack)
    ? (evidencePack?.verifiedTaskScore?.score ?? null)
    : null;
}

export function getEvidenceCommands(evidencePack: EvidencePack | null) {
  return evidencePack?.commandsExecuted?.map((entry) => entry.command) ?? [];
}

export function getEvidenceFiles(evidencePack: EvidencePack | null) {
  return [
    ...(evidencePack?.filesModified?.map((entry) => entry.path) ?? []),
    ...(evidencePack?.touchedPaths ?? []),
  ].filter((path, index, all) => all.indexOf(path) === index);
}

function isRiskySurfacePath(path: string) {
  return /(^|\/)(auth|session|security|settings|contracts|electron|preload|main|ipc|privacy|policy|agent-firewall|threat|env|payment|billing|stripe|network|http|api|dependency|dependencies|package)(\/|\.|-)/i.test(
    path,
  );
}
