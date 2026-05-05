import type { GitStatus } from "../../../contracts/git";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";
import type {
  ChatMessage,
  Conversation,
  EvidencePack,
  RunStatus,
  ToolEvent,
} from "../../../contracts/chat";

export type ImpactRisk = "High" | "Medium" | "Low" | "None";

export interface ImpactSummary {
  affectedCount: number;
  serviceCount: number;
  toolFanoutCount: number;
  risk: ImpactRisk;
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
