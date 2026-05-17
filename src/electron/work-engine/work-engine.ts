import type { WorkspaceSummary } from "../../contracts/workspace";
import type { WorkingSet } from "../../contracts/working-set";
import { repoGraphService } from "../repo-graph-service";
import {
  buildWorkPlanFromSnapshot,
  buildWorkPlanMetadata,
  renderWorkPlanForPrompt,
  type WorkPlanInputSnapshot,
} from "./work-engine-core";
import type { WorkPlan } from "./types";

export { buildWorkPlanFromSnapshot, buildWorkPlanMetadata, renderWorkPlanForPrompt };
export type { WorkPlanInputSnapshot };

interface BuildWorkPlanInput {
  prompt: string;
  workspace: WorkspaceSummary;
  gitStatus: string[];
  workingSet: WorkingSet;
}

export async function buildWorkPlan(input: BuildWorkPlanInput): Promise<WorkPlan> {
  return buildWorkPlanFromSnapshot(await collectWorkPlanSnapshotFromElectronServices(input));
}

async function collectWorkPlanSnapshotFromElectronServices(
  input: BuildWorkPlanInput,
): Promise<WorkPlanInputSnapshot> {
  const [entrypoints, ipcSurface, envUsage, dependencySurface, impactedFiles] = await Promise.all([
    repoGraphService.getEntrypoints(input.workspace).catch(() => []),
    repoGraphService.getIpcSurface(input.workspace).catch(() => []),
    repoGraphService.getEnvUsage(input.workspace).catch(() => []),
    repoGraphService.getDependencySurface(input.workspace).catch(() => []),
    collectImpactedFiles(input.workspace, input.workingSet).catch(() => []),
  ]);
  return {
    prompt: input.prompt,
    mode: "build",
    workspace: {
      root: input.workspace.path,
      name: input.workspace.name,
    },
    git: {
      branch: null,
      changedFiles: normalizeChangedFiles(input.gitStatus),
      stagedFiles: [],
      untrackedFiles: [],
    },
    repoGraph: {
      status: "ready",
      entrypoints: entrypoints.map((entrypoint) => entrypoint.file),
      impactedFiles,
      relatedTests: input.workingSet.relatedTests.map((file) => file.path),
      sensitiveSurfaces: [
        ...envUsage.map((usage) => ({
          kind: "env",
          files: usage.files,
          reason: `Uses ${usage.variable}.`,
        })),
        ...ipcSurface.map((surface) => ({
          kind: "ipc",
          files: [...surface.callers, ...surface.callees],
          reason: `IPC channel ${surface.channel}.`,
        })),
        ...dependencySurface.map((surface) => ({
          kind: "dependency",
          files: surface.files.length > 0 ? surface.files : [surface.manifest],
          reason: `${surface.dependency} dependency surface.`,
        })),
      ].slice(0, 20),
    },
    scripts: input.workingSet.relevantPackageScripts.map((script) => ({
      name: script.name,
      command: script.command,
      signal: scriptSignal(script.name),
    })),
    failures: input.workingSet.recentFailureContext.map((failure) => ({
      signature: failure.summary ?? failure.command,
      command: failure.command,
      status: failure.status ?? "unknown",
      lastSeenAt: failure.ranAt,
    })),
    privacy: {
      status: "unknown",
      strict: true,
      redactions: 0,
      categories: [],
    },
  };
}

async function collectImpactedFiles(workspace: WorkspaceSummary, workingSet: WorkingSet) {
  const files = workingSet.primaryTargetFiles.map((file) => file.path).slice(0, 8);
  if (files.length === 0) return [];
  const impacted = await repoGraphService.getImpactedFiles(workspace, files);
  return impacted.map((entry) => entry.file).slice(0, 20);
}

function normalizeChangedFiles(statusLines: string[]) {
  return statusLines
    .map((line) => line.replace(/^[ MADRCU?!]{2}\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

function scriptSignal(name: string): NonNullable<WorkPlanInputSnapshot["scripts"]>[number]["signal"] {
  const lower = name.toLowerCase();
  if (lower.includes("test")) return "test";
  if (lower.includes("lint")) return "lint";
  if (lower.includes("typecheck") || lower.includes("tsc")) return "typecheck";
  if (lower.includes("build")) return "build";
  if (lower.includes("dev") || lower.includes("start")) return "dev";
  return "other";
}
