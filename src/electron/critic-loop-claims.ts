import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { ToolExecutionRecord } from "./evidence-pack";

export interface CriticLoopClaimInput {
  workspacePath: string;
  prompt: string;
  finalContent: string;
  modifiedFiles: string[];
  commandsRan: string[];
  validationStatus: "passed" | "failed" | "not_run";
  toolExecutions: ToolExecutionRecord[];
}

export async function evaluateCriticLoopClaims(input: CriticLoopClaimInput) {
  const warnings = [
    ...evaluateValidationClaims(input),
    ...evaluateSeverityClaims(input.finalContent),
    ...evaluatePatchClaims(input),
    ...evaluateToolEvidenceClaims(input),
  ];
  warnings.push(...(await evaluateFileExistenceClaims(input)));
  return uniqueWarnings(warnings);
}

export function extractClaimedChangedFiles(content: string) {
  const changedSection = content.match(
    /(?:files changed|changed files|modified files|impacted files)\s*:\s*([\s\S]*?)(?:\n\s*\n|$)/i,
  );
  if (!changedSection) {
    return [];
  }

  return Array.from(extractRepoPaths(changedSection[1]));
}

export function extractRepoPaths(content: string) {
  const matches = content.matchAll(
    /(?:^|[\s(["'`])((?:src|app|lib|test|tests|packages|electron|contracts)\/[A-Za-z0-9._/@+-]+)(?=$|[\s)"'`,:])/g,
  );
  return new Set(Array.from(matches, (match) => match[1]));
}

function evaluateValidationClaims(input: CriticLoopClaimInput) {
  const warnings: string[] = [];

  if (claimsCommandEvidence(input.finalContent)) {
    const hasValidationOrCommand =
      input.commandsRan.length > 0 || input.toolExecutions.length > 0;
    if (!hasValidationOrCommand) {
      warnings.push(
        "Final answer claims command or validation evidence, but no tool execution is recorded.",
      );
    }
  }

  if (claimsProductionReady(input.finalContent)) {
    const missingChecks = requiredProductionChecks(input.commandsRan);
    if (missingChecks.length > 0) {
      warnings.push(
        `Production-ready claim is not fully supported; missing validation: ${missingChecks.join(", ")}.`,
      );
    }
  }

  if (claimsNoUnresolvedRisk(input.finalContent) && input.validationStatus !== "passed") {
    warnings.push(
      `No-risk claim is not supported because validation status is ${input.validationStatus}.`,
    );
  }

  return warnings;
}

function evaluateSeverityClaims(content: string) {
  const warnings: string[] = [];
  const highSeverity = /\b(severity\s*:\s*high|critical|rce|remote code execution|privilege escalation|lpe|arbitrary)\b/i.test(
    content,
  );
  const conditionalEvidence = /\b(potential|may exist|could|if\b|depends on|conditional|not reproduced|static analysis|static proof|confidence\s*:\s*(low|medium))\b/i.test(
    content,
  );
  const concreteRuntimeEvidence = /\b(reproduced at runtime|exploit reproduced|pre-patch outcome\s*:\s*(failed|confirmed)|post-patch outcome\s*:\s*passed)\b/i.test(
    content,
  );

  if (highSeverity && conditionalEvidence && !concreteRuntimeEvidence) {
    warnings.push(
      "High-impact security claim is conditional and not fully supported by runtime or complete data-flow evidence.",
    );
  }

  return warnings;
}

function evaluatePatchClaims(input: CriticLoopClaimInput) {
  const warnings: string[] = [];
  const promptRequestedPatch = /\b(fix|patch|apply|implement|arregla|corrige|aplica|implementa)\b/i.test(
    input.prompt,
  );
  const admitsNoPatch = /\b(no patch has been applied|no patch was applied|recommendation only|not yet patched)\b/i.test(
    input.finalContent,
  );
  const claimedChangedFiles = extractClaimedChangedFiles(input.finalContent);

  if (promptRequestedPatch && input.modifiedFiles.length === 0) {
    warnings.push("User requested a fix, but no modified files are present in current git status.");
  }

  if (promptRequestedPatch && admitsNoPatch) {
    warnings.push("User requested a fix, but final answer states no patch was applied.");
  }

  if (claimedChangedFiles.length > 0) {
    const missingChangedFiles = claimedChangedFiles.filter(
      (path) => !input.modifiedFiles.includes(path),
    );
    if (missingChangedFiles.length > 0) {
      warnings.push(
        `Claimed changed file(s) not present in current git status: ${missingChangedFiles.join(", ")}.`,
      );
    }
  }

  return warnings;
}

function evaluateToolEvidenceClaims(input: CriticLoopClaimInput) {
  const warnings: string[] = [];
  const enoentClaims = Array.from(
    input.finalContent.matchAll(/(?:ENOENT|not found|failed to locate).*?((?:src|app|lib|test|tests|packages)\/[A-Za-z0-9._/@+-]+)/gi),
    (match) => match[1],
  );

  for (const path of enoentClaims) {
    const toolOutputSupportsClaim = input.toolExecutions.some(
      (record) => record.output.includes(path) && /ENOENT|not found|failed to locate/i.test(record.output),
    );
    if (!toolOutputSupportsClaim) {
      warnings.push(
        `File access failure for ${path} is claimed but not supported by recorded tool output.`,
      );
    }
  }

  return warnings;
}

async function evaluateFileExistenceClaims(input: CriticLoopClaimInput) {
  const warnings: string[] = [];
  const claimedMissingFiles = Array.from(
    input.finalContent.matchAll(/(?:ENOENT|not found|failed to locate).*?((?:src|app|lib|test|tests|packages)\/[A-Za-z0-9._/@+-]+)/gi),
    (match) => match[1],
  );

  for (const path of claimedMissingFiles) {
    if (await fileExists(resolveWorkspacePath(input.workspacePath, path))) {
      warnings.push(
        `Claimed missing file exists in workspace: ${path}.`,
      );
    }
  }

  return warnings;
}

function claimsCommandEvidence(content: string) {
  return /\b(command|ran|executed|validated|tested|typecheck|lint|build)\b/i.test(
    content,
  );
}

function claimsProductionReady(content: string) {
  return /\b(production-ready|ready for deployment|stable and ready|all tests passed)\b/i.test(
    content,
  );
}

function claimsNoUnresolvedRisk(content: string) {
  return /\b(unresolved risks?:\s*none|no unresolved risks|none identified)\b/i.test(
    content,
  );
}

function requiredProductionChecks(commandsRan: string[]) {
  const normalizedCommands = commandsRan.join("\n").toLowerCase();
  const required = [
    { label: "typecheck", pattern: /\b(typecheck|tsc)\b/ },
    { label: "lint", pattern: /\blint\b/ },
    { label: "tests or build", pattern: /\b(test|build|package|make)\b/ },
  ];

  return required
    .filter((check) => !check.pattern.test(normalizedCommands))
    .map((check) => check.label);
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}

function resolveWorkspacePath(workspacePath: string, path: string) {
  return isAbsolute(path) ? path : join(workspacePath, path);
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
