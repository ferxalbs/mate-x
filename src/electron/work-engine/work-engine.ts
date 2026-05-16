import { createId } from "../../lib/id";
import type { WorkspaceSummary } from "../../contracts/workspace";
import type { WorkingSet } from "../../contracts/working-set";
import { repoGraphService } from "../repo-graph-service";
import { classifyWorkIntent } from "./intent";
import {
  resolveWorkRunbook,
  runbookRequiresEvidence,
  runbookRequiresValidation,
  runbookStopConditions,
} from "./runbook-resolver";
import type { SensitiveSurfaceKind, WorkPlan, WorkPlanMetadata, WorkRisk } from "./types";

interface BuildWorkPlanInput {
  prompt: string;
  workspace: WorkspaceSummary;
  gitStatus: string[];
  workingSet: WorkingSet;
}

export async function buildWorkPlan(input: BuildWorkPlanInput): Promise<WorkPlan> {
  const intent = classifyWorkIntent(input.prompt);
  const risk = inferRisk(input.prompt, input.gitStatus, input.workingSet);
  const runbook = resolveWorkRunbook(intent, risk);
  const [entrypoints, ipcSurface, envUsage, dependencySurface, impactedFiles] = await Promise.all([
    repoGraphService.getEntrypoints(input.workspace).catch(() => []),
    repoGraphService.getIpcSurface(input.workspace).catch(() => []),
    repoGraphService.getEnvUsage(input.workspace).catch(() => []),
    repoGraphService.getDependencySurface(input.workspace).catch(() => []),
    collectImpactedFiles(input.workspace, input.workingSet).catch(() => []),
  ]);
  const validationRequired = runbookRequiresValidation(runbook, risk);
  const scripts = input.workingSet.relevantPackageScripts;
  const primaryCommand =
    selectScript(scripts, ["test", "typecheck", "lint", "build"])?.command ?? null;
  const fallbackCommand =
    risk === "high"
      ? selectScript(scripts, ["typecheck", "lint", "build"], primaryCommand)?.command ?? null
      : null;

  return {
    id: createId("work-plan"),
    intent,
    risk,
    objective: input.prompt,
    runbook,
    workingSet: {
      primaryFiles: input.workingSet.primaryTargetFiles.map((file) => file.path),
      relatedFiles: [
        ...input.workingSet.directlyImportedFiles,
        ...input.workingSet.directlyImportingFiles,
        ...input.workingSet.relatedContractsTypes,
      ].map((file) => file.path),
      relatedTests: input.workingSet.relatedTests.map((file) => file.path),
      changedFiles: normalizeChangedFiles(input.gitStatus),
      impactedFiles,
      entrypoints: entrypoints.map((entrypoint) => entrypoint.file),
      sensitiveSurfaces: [
        ...envUsage.map((usage) => ({
          kind: "env" as SensitiveSurfaceKind,
          files: usage.files,
          reason: `Uses ${usage.variable}.`,
        })),
        ...ipcSurface.map((surface) => ({
          kind: "ipc" as SensitiveSurfaceKind,
          files: [...surface.callers, ...surface.callees],
          reason: `IPC channel ${surface.channel}.`,
        })),
        ...dependencySurface.map((surface) => ({
          kind: "dependency" as SensitiveSurfaceKind,
          files: surface.files.length > 0 ? surface.files : [surface.manifest],
          reason: `${surface.dependency} dependency surface.`,
        })),
      ].slice(0, 20),
      relevantScripts: scripts.map((script) => ({
        name: script.name,
        command: script.command,
        reason: script.reasons[0] ?? "Ranked by working set compiler.",
      })),
      knownFailures: input.workingSet.recentFailureContext.map((failure) => ({
        signature: failure.summary ?? failure.command,
        command: failure.command,
        status: failure.status ?? "unknown",
        lastSeenAt: failure.ranAt,
      })),
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
      requireSanitization: true,
      blockIfP0Unsanitized: true,
      includeRepoContext: intent !== "answer",
      includeToolOutput: runbookRequiresEvidence(runbook),
      reason: "Repo context, tool output, memory, and evidence payloads must pass Privacy Sentinel before cloud transit.",
    },
    evidencePlan: {
      required: runbookRequiresEvidence(runbook),
      expectedArtifacts: expectedEvidenceArtifacts(runbook),
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

function inferRisk(prompt: string, gitStatus: string[], workingSet: WorkingSet): WorkRisk {
  if (/\b(auth|secret|security|rce|ssrf|injection|payment|database|migration)\b/i.test(prompt)) {
    return "high";
  }
  if (gitStatus.length > 8 || workingSet.primaryTargetFiles.length > 5) {
    return "medium";
  }
  if (gitStatus.length > 0) {
    return "medium";
  }
  return "low";
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

function selectScript(
  scripts: WorkingSet["relevantPackageScripts"],
  names: string[],
  excludeCommand?: string | null,
) {
  return scripts.find(
    (script) =>
      script.command !== excludeCommand &&
      names.some((name) => script.name.toLowerCase().includes(name)),
  );
}

function expectedEvidenceArtifacts(runbook: WorkPlan["runbook"]) {
  if (runbook === "evidence_only") return ["existing runtime records", "missing evidence list"];
  if (runbook === "patch_test_verify") return ["files changed", "validation command", "validation persistence"];
  if (runbook === "audit_reproduce_remediate" || runbook === "trace_source_to_sink") {
    return ["source", "path", "sink", "mitigation check", "exploitability proof"];
  }
  return ["files inspected", "commands run", "unresolved risks"];
}

function requiredEvidenceClaims(runbook: WorkPlan["runbook"]) {
  if (runbook === "patch_test_verify") return ["changed files", "validation status", "unresolved risks"];
  if (runbook === "audit_reproduce_remediate" || runbook === "trace_source_to_sink") {
    return ["candidate/proven wording", "source-to-sink proof", "affected file evidence"];
  }
  return ["runtime evidence source", "missing evidence"];
}
