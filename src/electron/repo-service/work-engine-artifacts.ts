import path from "node:path";
import { readFile } from "node:fs/promises";

import type { WorkspaceSummary } from "../../contracts/workspace";
import type { WorkPlan } from "../work-engine/types";
import type { WorkPlanInputSnapshot } from "../work-engine/work-engine-core";
import { runPrivacyPreflight } from "../work-engine/privacy-preflight";

export async function loadCompliancePolicySources(workspacePath: string) {
  const agentsPath = path.join(workspacePath, "AGENTS.md");
  const rulesPath = path.join(workspacePath, "RULES.md");
  const sources = await Promise.all(
    [agentsPath, rulesPath].map(async (policyPath): Promise<{ path: string; content: string } | null> => {
      const content = await readFile(policyPath, 'utf8').catch((): null => null);
      return content ? { path: path.basename(policyPath), content } : null;
    }),
  );

  return sources.filter((source): source is { path: string; content: string } => source !== null);
}

export function buildWorkEngineArtifactSnapshot(input: {
  prompt: string;
  workspace: WorkspaceSummary;
  statusLines: string[];
  workPlan: WorkPlan;
  privacyPreflight: Awaited<ReturnType<typeof runPrivacyPreflight>> | null;
}): WorkPlanInputSnapshot {
  return {
    prompt: input.prompt,
    mode: "execute",
    workspace: {
      root: input.workspace.path,
      name: input.workspace.name,
    },
    git: {
      branch: input.workspace.branch,
      changedFiles: normalizeWorkEngineArtifactStatusFiles(input.statusLines),
      stagedFiles: [],
      untrackedFiles: [],
    },
    repoGraph: {
      status: "partial",
      entrypoints: input.workPlan.workingSet.entrypoints,
      impactedFiles: input.workPlan.workingSet.impactedFiles,
      relatedTests: input.workPlan.workingSet.relatedTests,
      sensitiveSurfaces: input.workPlan.workingSet.sensitiveSurfaces,
    },
    scripts: input.workPlan.workingSet.relevantScripts.map((script) => ({
      name: script.name,
      command: script.command,
      signal: inferWorkEngineArtifactScriptSignal(script.name),
    })),
    failures: input.workPlan.workingSet.knownFailures,
    privacy: {
      status: input.privacyPreflight?.status === "blocked" ? "blocked" : input.privacyPreflight ? "active" : "unknown",
      strict: true,
      redactions: input.privacyPreflight?.redactionCount ?? 0,
      categories: [
        ...((input.privacyPreflight?.redactionCount ?? 0) > 0 ? ["redacted"] : []),
        ...((input.privacyPreflight?.p0Count ?? 0) > 0 ? ["p0"] : []),
      ],
    },
  };
}

function normalizeWorkEngineArtifactStatusFiles(statusLines: string[]) {
  return statusLines
    .map((line) => line.replace(/^[ MADRCU?!]{2}\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

function inferWorkEngineArtifactScriptSignal(
  name: string,
): NonNullable<WorkPlanInputSnapshot["scripts"]>[number]["signal"] {
  const lower = name.toLowerCase();
  if (lower.includes("test")) return "test";
  if (lower.includes("lint")) return "lint";
  if (lower.includes("typecheck") || lower.includes("tsc")) return "typecheck";
  if (lower.includes("build")) return "build";
  if (lower.includes("dev") || lower.includes("start")) return "dev";
  return "other";
}
