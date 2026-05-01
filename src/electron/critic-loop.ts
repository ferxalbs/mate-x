import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { ToolExecutionRecord } from "./evidence-pack";
import type { ToolEvent } from "../contracts/chat";
import {
  evaluateCriticLoopClaims,
  extractClaimedChangedFiles,
  extractRepoPaths,
} from "./critic-loop-claims";

export interface CriticLoopInput {
  workspacePath: string;
  prompt: string;
  finalContent: string;
  statusLines: string[];
  events: ToolEvent[];
  toolExecutions: ToolExecutionRecord[];
}

export interface CriticLoopVerification {
  validationStatus: "passed" | "failed" | "not_run";
  modifiedFiles: string[];
  claimedFiles: Array<{ path: string; exists: boolean }>;
  commandsRan: string[];
  warnings: string[];
}

const VALIDATION_TOOL_NAMES = new Set([
  "run_tests",
  "sandbox_run",
  "plan_validation",
  "verify_validation_persistence",
]);
const execFileAsync = promisify(execFile);

export function buildCriticReviewPrompt(input: CriticLoopInput) {
  return [
    "You are Pass 2 critic in MaTE X critic_loop mode.",
    "Review existing context only. Do not ask for tools. Do not invent evidence.",
    "Check for unsupported claims, risky changes, missing tests, broad edits, and hallucinated evidence.",
    "Downgrade High/Critical security claims unless concrete exploitability or full data flow is proven.",
    "Flag any claimed missing file or failed access that is not backed by tool output.",
    "If user requested a fix but no patch is evidenced, mark major_issue.",
    "Return exact format:",
    "CRITIC_VERDICT: ok | major_issue",
    "CRITIC_NOTES:",
    "- concise note",
    "",
    "Final candidate:",
    input.finalContent,
    "",
    "Actual tool executions:",
    renderToolExecutions(input.toolExecutions),
    "",
    "Actual events:",
    input.events
      .map((event) => `- ${event.label}: ${event.status} - ${event.detail}`)
      .join("\n"),
    "",
    `Git status lines:\n${input.statusLines.join("\n") || "(clean)"}`,
  ].join("\n");
}

export function buildCriticRevisionPrompt(finalContent: string, criticNotes: string) {
  return [
    "Revise final answer using critic notes. Do not add new claims.",
    "Keep only claims supported by existing tool output. Surface concise warnings.",
    "",
    "Critic notes:",
    criticNotes,
    "",
    "Draft to revise:",
    finalContent,
  ].join("\n");
}

export function criticFoundMajorIssue(criticNotes: string) {
  return /^CRITIC_VERDICT:\s*major_issue\b/im.test(criticNotes);
}

export async function verifyCriticLoop(
  input: CriticLoopInput,
): Promise<CriticLoopVerification> {
  const currentStatusLines = await readGitStatusLines(input.workspacePath);
  const modifiedFiles = extractModifiedFiles(
    currentStatusLines.length > 0 ? currentStatusLines : input.statusLines,
  );
  const claimedFiles = Array.from(extractClaimedFiles(input.finalContent)).slice(0, 40);
  const fileChecks = await Promise.all(
    claimedFiles.map(async (path) => ({
      path,
      exists: await fileExists(resolveWorkspacePath(input.workspacePath, path)),
    })),
  );
  const commandsRan = extractCommandsRan(input.toolExecutions);
  const validationStatus = resolveValidationStatus(input.events, input.toolExecutions);
  const warnings: string[] = await evaluateCriticLoopClaims({
    workspacePath: input.workspacePath,
    prompt: input.prompt,
    finalContent: input.finalContent,
    modifiedFiles,
    commandsRan,
    validationStatus,
    toolExecutions: input.toolExecutions,
  });

  if (validationStatus !== "passed") {
    warnings.push(`Validation status: ${validationStatus}.`);
  }

  const missingClaimedFiles = fileChecks.filter((file) => !file.exists);
  if (missingClaimedFiles.length > 0) {
    warnings.push(
      `Claimed file(s) not found: ${missingClaimedFiles
        .map((file) => file.path)
        .join(", ")}.`,
    );
  }

  const claimedChangedFiles = extractClaimedChangedFiles(input.finalContent);
  if (claimedChangedFiles.length > 0) {
    const missingChangedFiles = claimedChangedFiles.filter(
      (path) => !modifiedFiles.includes(path),
    );
    if (missingChangedFiles.length > 0) {
      warnings.push(
        `Claimed changed file(s) not present in current git status: ${missingChangedFiles.join(", ")}.`,
      );
    }
  }

  return {
    validationStatus,
    modifiedFiles,
    claimedFiles: fileChecks,
    commandsRan,
    warnings,
  };
}

export function appendVerificationWarnings(
  finalContent: string,
  verification: CriticLoopVerification,
) {
  if (verification.warnings.length === 0) {
    return finalContent;
  }

  return [
    finalContent.trim(),
    "",
    "Warnings:",
    ...verification.warnings.map((warning) => `- ${warning}`),
  ].join("\n");
}

function renderToolExecutions(toolExecutions: ToolExecutionRecord[]) {
  if (toolExecutions.length === 0) {
    return "(none)";
  }

  return toolExecutions
    .map((record) => {
      const args = JSON.stringify(record.args);
      const output = record.output.replace(/\s+/g, " ").slice(0, 600);
      return `- ${record.toolName} ${args}\n  Output: ${output}`;
    })
    .join("\n");
}

function extractModifiedFiles(statusLines: string[]) {
  return statusLines
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter((path): path is string => Boolean(path));
}

function extractClaimedFiles(content: string) {
  return extractRepoPaths(content);
}

function extractCommandsRan(toolExecutions: ToolExecutionRecord[]) {
  return toolExecutions
    .map((record) => {
      const command = record.args.command ?? record.args.cmd ?? record.args.script;
      return typeof command === "string" ? command : null;
    })
    .filter((command): command is string => Boolean(command));
}

function resolveValidationStatus(
  events: ToolEvent[],
  toolExecutions: ToolExecutionRecord[],
): CriticLoopVerification["validationStatus"] {
  const validationTools = toolExecutions.filter((record) =>
    VALIDATION_TOOL_NAMES.has(record.toolName),
  );
  const validationEvents = events.filter((event) =>
    /\b(validation|test|typecheck|lint|build)\b/i.test(`${event.label} ${event.detail}`),
  );

  if (validationTools.length === 0 && validationEvents.length === 0) {
    return "not_run";
  }

  if (
    validationEvents.some((event) => event.status === "error") ||
    validationTools.some((record) => /\b(exit\s*code\s*[1-9]|failed|error)\b/i.test(record.output))
  ) {
    return "failed";
  }

  return "passed";
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

async function readGitStatusLines(workspacePath: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workspacePath, "status", "--short"],
      { timeout: 5000, maxBuffer: 128 * 1024 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    return [];
  }
}
