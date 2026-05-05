import type { GitStatus } from "../../../contracts/git";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";

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

export function getVerifiedScore(summary: ImpactSummary, tests: string[], changedFiles: string[]) {
  const evidence = changedFiles.length > 0 ? 18 : 0;
  const validation = tests.length > 0 ? 18 : 8;
  const privacy = 20;
  const impact = summary.risk === "High" ? 18 : summary.risk === "Medium" ? 22 : 24;
  const graph = Math.min(20, Math.max(8, summary.affectedCount + 8));

  return Math.min(96, evidence + validation + privacy + impact + graph);
}
