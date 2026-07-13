import { access } from "node:fs/promises";

import type { ToolExecutionRecord } from "./evidence-pack";
import { resolveWorkspacePath } from "./tools/tool-utils";

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
    ...evaluateConsistencyClaims(input),
    ...evaluateCompletionClaims(input.finalContent),
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

  if (input.validationStatus !== "passed") {
    if (claimsSafeToMerge(input.finalContent)) {
      warnings.push(
        `Safe-to-merge claim is not supported because validation status is ${input.validationStatus}.`,
      );
    }

    if (claimsHighConfidence(input.finalContent) && !claimsStaticProofScope(input.finalContent)) {
      warnings.push(
        `High confidence is not supported because validation status is ${input.validationStatus}.`,
      );
    }
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
    const modifiedFileSet = new Set(input.modifiedFiles);
    const missingChangedFiles = claimedChangedFiles.filter(
      (path) => !modifiedFileSet.has(path),
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

function evaluateConsistencyClaims(input: CriticLoopClaimInput) {
  const warnings: string[] = [];
  const content = input.finalContent;

  if (claimsWarningsNone(content) && hasNonEmptyUnresolvedRisks(content)) {
    warnings.push('Warnings cannot be "None" while unresolved risks remain.');
  }

  if (/\bmerge-ready\b/i.test(content) && /\bpending ci\b/i.test(content)) {
    warnings.push(
      'Merge-ready claim is too strong while CI is pending; use "ready for CI review" instead.',
    );
  }

  if (
    /\b(validation status|validation)\s*:\s*(failed|blocked|not_run|not run|unconfirmed)\b/i.test(
      content,
    ) &&
    claimsValidationPassed(content)
  ) {
    warnings.push(
      "Validation result is inconsistent: final answer claims both failed/blocked and passed validation.",
    );
  }

  if (input.validationStatus === "passed" && claimsCommandsNone(content)) {
    warnings.push(
      "Commands cannot be listed as none when verifier recorded passed validation.",
    );
  }

  return warnings;
}

function evaluateCompletionClaims(content: string) {
  const warnings: string[] = [];
  const asksForAnotherPass = /\b(next audit pass|re-run|rerun|retry|run another pass|follow-up audit|future audit)\b/i.test(
    content,
  );
  const hasCurrentVerdict = /\b(verdict|severity|confidence)\s*:/i.test(content);

  if (asksForAnotherPass && !hasCurrentVerdict) {
    warnings.push(
      "Final answer defers to another audit pass without giving a current verdict.",
    );
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
    if (await fileExistsInsideWorkspace(input.workspacePath, path)) {
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

function claimsSafeToMerge(content: string) {
  return /\b(safe to merge|merge is safe|merge-ready|ready to merge)\b/i.test(
    content,
  );
}

function claimsHighConfidence(content: string) {
  return /\b(confidence\s*:\s*high|high confidence)\b/i.test(content);
}

function claimsStaticProofScope(content: string) {
  return /\b(static proof only|confidence is scoped to static proof|grounded in static proof only)\b/i.test(
    content,
  );
}

function claimsNoUnresolvedRisk(content: string) {
  return /\b(unresolved risks?:\s*none|no unresolved risks|none identified)\b/i.test(
    content,
  );
}

function claimsWarningsNone(content: string) {
  return /\bwarnings\s*:\s*(?:\*\*)?\s*(none|no warnings|n\/a)\b/i.test(
    content,
  );
}

function claimsCommandsNone(content: string) {
  return /\bcommands run\s*:\s*(?:\*\*)?\s*(none|no commands|n\/a)\b/i.test(
    content,
  );
}

function claimsValidationPassed(content: string) {
  return /\b(validation (?:passed|complete|confirmed)|status\s*:\s*passed|exit\s*0)\b/i.test(
    content,
  );
}

function hasNonEmptyUnresolvedRisks(content: string) {
  const match = content.match(
    /\bunresolved risks?\s*:\s*([\s\S]*?)(?:\n\s*\n|\n\s*\*\*final recommendation|\n\s*final recommendation|$)/i,
  );
  if (!match) {
    return false;
  }

  return !/^\s*(none|no unresolved risks|n\/a|none identified)\s*\.?\s*$/i.test(
    match[1].replace(/[*`-]/g, "").trim(),
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

async function fileExistsInsideWorkspace(workspacePath: string, path: string) {
  try {
    const resolved = resolveWorkspacePath(workspacePath, path);
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}
