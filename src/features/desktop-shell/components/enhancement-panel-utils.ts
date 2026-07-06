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
  | "Ready"
  | "Not ready"
  | "Risky"
  | "Blocked"
  | "Unknown";
export type ShipStatusLabel = TrustGateVerdict | "Needs check" | "Not ready to push";
export type TrustGateStatus =
  | "trusted"
  | "resolving"
  | "needs_validation"
  | "risky"
  | "blocked"
  | "unknown";
export type TrustGateConfidence = "verified" | "high" | "medium" | "low" | "none";
export type ShipStatusMode = "ambient" | "active";
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
  headline: ShipStatusLabel;
  explanation: string;
  recommendedAction: string;
  primaryActionLabel: string;
  reasonChips: string[];
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

export function getShipStatusHeaderLabel(state: TrustGateState) {
  if (state.status === "resolving") return "Needs check";
  if (state.status === "needs_validation") return "Needs check";
  return state.verdict;
}

export function getTopbarRepoSafetyLabel(state: TrustGateState) {
  if (state.status === "trusted") return "Validated";
  if (state.status === "blocked") return "Blocked";
  if (state.status === "risky") return "Risky";
  if (state.status === "needs_validation" || state.status === "resolving") return "Needs check";
  return state.verdict === "Ready" ? "Validated" : "Clean";
}

export function detectActiveGateIntent(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/[^\w\s?]/g, " ");
  const compact = normalized.replace(/\s+/g, " ").trim();
  if (!compact) return false;

  const casualOnly =
    /^(hi|hello|hey|how are you|thanks|thank you|ok|okay|cool|nice|great|explain\b.*|what is\b.*|general chat\b.*)$/i;
  if (casualOnly.test(compact)) return false;

  return /\b(commit|push|merge|ship|release|deploy|safe|verify|validate|audit|proof|evidence|ready)\b/i.test(compact) ||
    /\bcan i ship\b/i.test(compact);
}

export function getShipStatusMode({
  activeGateRequested = false,
  conversation,
  state,
}: {
  activeGateRequested?: boolean;
  conversation: Conversation | null;
  state: TrustGateState;
}): ShipStatusMode {
  if (activeGateRequested) return "active";
  if (state.status === "blocked" || state.policyStopState === "unresolved") return "active";
  if (state.touchedRiskSurfaces.length > 0 && state.status === "risky") return "active";

  const messages = conversation?.messages ?? [];
  const latestMessage = messages.at(-1);
  if (
    latestMessage?.role === "assistant" &&
    (latestMessage.evidencePack?.filesModified?.length ?? 0) > 0 &&
    state.status !== "trusted"
  ) {
    return "active";
  }
  if (
    latestMessage?.role === "assistant" &&
    latestMessage.events?.some((event) =>
      /\b(file_editor|auto_patch|mutation|edit|patch|modified|created|deleted)\b/i.test(
        `${event.label} ${event.detail ?? ""}`,
      ),
    ) &&
    state.status !== "trusted"
  ) {
    return "active";
  }

  const latestUserPrompt = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content ?? "";

  return detectActiveGateIntent(latestUserPrompt) ? "active" : "ambient";
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
        ? "Workspace metadata loaded. Map repo signals to populate tests, lint, and secret indicators."
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
      detail: "Repo usable, but live trust signals are still resolving.",
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
    ? hasVerifiedSignals && validationState === "passed" && score !== null && score >= 85
      ? "Proof available"
      : hasVerifiedSignals
        ? "No validation passed yet"
        : "Needs safety check"
    : "No validation passed yet";
  const evidencePackState: TrustGateEvidenceState = !evidencePack
    ? "missing"
    : !hasVerifiedSignals || score === null
      ? "present_missing_validation"
      : score >= 85 && validationState === "passed"
        ? "signed_strong"
        : "present_weak";

  const buildState = (
    state: Omit<
      TrustGateState,
      | "headline"
      | "explanation"
      | "recommendedAction"
      | "primaryActionLabel"
      | "reasonChips"
      | "reasons"
      | "suggestedNextAction"
      | "sourceSignalsUsed"
    >,
  ): TrustGateState => ({
    ...state,
    ...getHumanTrustGateCopy(state, changedFiles.length),
    reasons: state.why,
    suggestedNextAction: state.nextAction,
    sourceSignalsUsed,
  });

  if (isRunning) {
    return buildState({
      status: "resolving",
      verdict: "Not ready",
      confidenceLabel: "none",
      tone: eventPolicyStop ? "warn" : "watch",
      proofLabel,
      why: [
        eventPolicyStop
          ? "A live tool or approval event may affect trust."
          : "Run is still producing tool, validation, and proof signals.",
        "Final Trust Gate waits for runtime evidence, not assistant wording.",
      ],
      missingProof: ["Final proof verdict"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: eventPolicyStop ? "unresolved" : "none",
      evidencePackState,
      nextAction: "Wait for safety check",
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
        hasPolicyStop ? "An unresolved approval or safety stop is recorded." : "The run ended blocked or failed.",
        "Do not continue until this is resolved.",
      ],
      missingProof: ["Resolved stop", "Passing validation"],
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
      verdict: "Risky",
      confidenceLabel: "low",
      tone: "warn",
      proofLabel,
      why: [
        `${riskyFiles.length} auth, session, env, payment, network, dependency, IPC, or runtime surface change${riskyFiles.length === 1 ? "" : "s"} detected.`,
        hasValidation ? "A validation command is available, but no passing result is proven yet." : "No validation command is proven yet.",
      ],
      missingProof: ["Risk-surface validation", "Strong proof"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Run safety check",
    });
  }

  if (!evidencePack) {
    return buildState({
      status: changedFiles.length > 0 ? "needs_validation" : "unknown",
      verdict: changedFiles.length > 0 ? "Not ready" : "Unknown",
      confidenceLabel: "none",
      tone: changedFiles.length > 0 ? "watch" : "muted",
      proofLabel,
      why: [
        changedFiles.length > 0
          ? `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"} found without a proven passing check.`
          : "No evidence has been generated for the current workspace.",
        "MaTE X checks what your AI agent changed before you ship.",
      ],
      missingProof: ["No validation passed"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: changedFiles.length > 0 ? "Run safety check" : "Open details",
    });
  }

  if (!hasVerifiedSignals || score === null) {
    return buildState({
      status: "needs_validation",
      verdict: "Not ready",
      confidenceLabel: "low",
      tone: "watch",
      proofLabel,
      why: [
        "Proof exists, but safety signals are missing.",
        hasValidation ? "Validation commands exist but need verified results." : "No validation command evidence yet.",
      ],
      missingProof: ["Verified task signals", "Passing validation"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Run safety check",
    });
  }

  if (!hasExecutedValidation || validationState !== "passed") {
    return buildState({
      status: "needs_validation",
      verdict: "Not ready",
      confidenceLabel: "medium",
      tone: "watch",
      proofLabel,
      why: [
        !hasExecutedValidation
          ? "Proof has score signals, but no command evidence."
          : "Validation evidence did not prove a passing run.",
        "Readiness is still unproven.",
      ],
      missingProof: ["Passing validation"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Run safety check",
    });
  }

  if (riskyFiles.length > 0 && evidencePackState !== "signed_strong") {
    return buildState({
      status: "risky",
      verdict: "Risky",
      confidenceLabel: score >= 75 ? "medium" : "low",
      tone: "warn",
      proofLabel,
      why: [
        "Risky surfaces changed without strong proof.",
        "Review the remaining risk before merging.",
      ],
      missingProof: score < 85 ? ["Strong proof score"] : ["Strong risky-surface proof"],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Show details",
    });
  }

  if (hasDirtyRepo) {
    return buildState({
      status: "needs_validation",
      verdict: "Not ready",
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
      nextAction: "Run safety check",
    });
  }

  if (summary.risk === "High" || score < 85) {
    return buildState({
      status: "risky",
      verdict: "Risky",
      confidenceLabel: score >= 75 ? "medium" : "low",
      tone: "warn",
      proofLabel,
      why: [
        summary.risk === "High"
          ? "The change touches a broad area."
          : `Verified score is ${score}/100.`,
        "Review the remaining risk before merging.",
      ],
      missingProof: score < 85 ? ["Strong proof score"] : [],
      touchedRiskSurfaces: riskyFiles,
      validationState,
      policyStopState: hasPolicyStop ? "resolved" : "none",
      evidencePackState,
      nextAction: "Show details",
    });
  }

  return buildState({
    status: "trusted",
    verdict: "Ready",
    confidenceLabel: "verified",
    tone: "good",
    proofLabel,
    why: ["Passing validation is proven.", "The checked workspace is clean."],
    missingProof: [],
    touchedRiskSurfaces: riskyFiles,
    validationState,
    policyStopState: hasPolicyStop ? "resolved" : "none",
    evidencePackState,
    nextAction: "Continue",
  });
}

function getHumanTrustGateCopy(
  state: Omit<
    TrustGateState,
    | "headline"
    | "explanation"
    | "recommendedAction"
    | "primaryActionLabel"
    | "reasonChips"
    | "reasons"
    | "suggestedNextAction"
    | "sourceSignalsUsed"
  >,
  changedFileCount: number,
): Pick<
  TrustGateState,
  "headline" | "explanation" | "recommendedAction" | "primaryActionLabel" | "reasonChips"
> {
  const validationChip =
    state.validationState === "passed"
      ? "Validation passed"
      : state.validationState === "failed"
        ? "Validation failed"
        : "No validation passed";
  const proofChip =
    state.evidencePackState === "signed_strong"
      ? "Proof complete"
      : "Needs safety check";
  const changeChip =
    changedFileCount > 0
      ? `${changedFileCount} file${changedFileCount === 1 ? "" : "s"} changed`
      : "No changed files";
  const riskChip =
    state.touchedRiskSurfaces.length > 0
      ? `${state.touchedRiskSurfaces.length} risky surface${state.touchedRiskSurfaces.length === 1 ? "" : "s"}`
      : "";

  const base: Pick<
    TrustGateState,
    "headline" | "recommendedAction" | "primaryActionLabel" | "reasonChips"
  > = {
    headline: state.status === "needs_validation" ? "Needs check" : state.verdict,
    recommendedAction: state.nextAction,
    primaryActionLabel: state.status === "trusted" ? "View proof" : "Run safety check",
    reasonChips: [changeChip, validationChip, proofChip, riskChip].filter(Boolean),
  };

  if (state.status === "trusted") {
    return {
      ...base,
      recommendedAction: "View proof",
      explanation: "Validation passed and proof is available.",
    };
  }

  if (state.status === "blocked") {
    return {
      ...base,
      primaryActionLabel: "Show details",
      explanation: "A safety stop needs attention before you continue.",
    };
  }

  if (state.status === "risky") {
    return {
      ...base,
      primaryActionLabel: "Inspect risky changes",
      explanation: "Auth/session, env, dependency, payment, network, or IPC surfaces changed without proof.",
    };
  }

  if (state.status === "unknown") {
    return {
      ...base,
      primaryActionLabel: "Show details",
      explanation: "MaTE X does not have enough information yet to judge this workspace.",
    };
  }

  return {
    ...base,
    headline: "Not ready to push",
    explanation:
      changedFileCount > 0
        ? "MaTE X found changed files, but no passing validation has been proven."
        : "No validation passed yet.",
  };
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
          : "No proof yet",
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
