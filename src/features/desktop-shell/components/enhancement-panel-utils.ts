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

export function getEvidenceCommands(evidencePack: EvidencePack | null) {
  return evidencePack?.commandsExecuted?.map((entry) => entry.command) ?? [];
}

export function getEvidenceFiles(evidencePack: EvidencePack | null) {
  return [
    ...(evidencePack?.filesModified?.map((entry) => entry.path) ?? []),
    ...(evidencePack?.touchedPaths ?? []),
  ].filter((path, index, all) => all.indexOf(path) === index);
}
