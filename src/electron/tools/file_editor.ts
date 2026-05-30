import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { Tool } from "../tool-service";
import { policyService } from "../policy-service";
import {
  analyzePatchAfter,
  analyzePatchBefore,
  assessPatchBeforeWrite,
  formatPatchImpactBlocked,
  formatPatchImpactSkipped,
  formatPatchImpactSummary,
} from "../patch-impact-engine";
import { resolveWorkspacePath } from "./tool-utils";

export const fileEditorTool: Tool = {
  name: "file_editor",
  description:
    "Precise workspace file editor for creating files, overwriting files, replacing line ranges, inserting before/after lines, deleting line ranges, and replacing exact blocks. Returns PATCH_IMPACT_SUMMARY_JSON when requested and does not create backup files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file to edit (relative to workspace).",
      },
      operation: {
        type: "string",
        enum: ["replace_range", "insert_before", "insert_after", "delete_range", "replace_block", "append", "create", "overwrite"],
        description:
          "Edit operation. Defaults to replace_range for backward compatibility.",
      },
      startLine: {
        type: "number",
        description:
          "The starting line number for range operations (1-indexed, inclusive).",
      },
      endLine: {
        type: "number",
        description:
          "The ending line number for replace/delete range operations (1-indexed, inclusive).",
      },
      newContent: {
        type: "string",
        description:
          "Content to write, insert, append, or use as replacement. Optional only for delete_range.",
      },
      searchString: {
        type: "string",
        description:
          "Exact block to replace when operation is replace_block. Must match file content exactly.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "For replace_block, replace all occurrences when true. Defaults to false.",
      },
      expectedContent: {
        type: "string",
        description:
          "Optional exact current content guard. For range operations it must match the target range. For append/overwrite it must match the whole file.",
      },
      failIfExists: {
        type: "boolean",
        description:
          "For create, reject if the target file already exists. Defaults to true.",
      },
      allowHighImpact: {
        type: "boolean",
        description:
          "Set true only after explicit user confirmation when PATCH_IMPACT_DECISION requires confirmation.",
      },
      impactAnalysis: {
        type: "string",
        enum: ["none", "before", "full"],
        description:
          "RepoGraph impact analysis level. Defaults to none for fast, precise edits on new or large files. Use full when dependency/risk summary is required.",
      },
    },
    required: ["path"],
  },
  async execute(args, { workspacePath, trustContract }) {
    const {
      path,
      startLine,
      endLine,
      newContent = "",
      expectedContent,
      searchString,
      replaceAll = false,
      failIfExists = true,
      allowHighImpact = false,
    } = args;
    const operation = normalizeOperation(args.operation);
    const impactAnalysis = args.impactAnalysis === "before" || args.impactAnalysis === "full"
      ? args.impactAnalysis
      : "none";
    
    const targetFile = resolveWorkspacePath(workspacePath, path);

    try {
      let content = "";
      let fileExists = true;
      try {
        content = await readFile(targetFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        fileExists = false;
      }

      const editPlan = buildEditPlan({
        content,
        fileExists,
        operation,
        startLine,
        endLine,
        newContent,
        expectedContent,
        searchString,
        replaceAll,
        failIfExists,
      });
      if (typeof editPlan === "string") {
        return editPlan;
      }

      const impactBefore = impactAnalysis === "none"
        ? null
        : await analyzePatchBefore(workspacePath, String(path));
      const decision = impactBefore ? assessPatchBeforeWrite(impactBefore) : null;
      if (impactBefore && decision?.requiresConfirmation) {
        if (allowHighImpact !== true) {
          return formatPatchImpactBlocked(impactBefore.targetFile, decision, impactBefore.summary);
        }
        if (trustContract?.autonomy !== "unrestricted") {
          const approval = await requestHighImpactPatchApproval({
            workspacePath,
            toolName: "file_editor",
            target: String(path),
            summary: editPlan.summary,
            riskScore: decision.level,
          });
          if (!approval) {
            return JSON.stringify({
              status: "refused",
              reason: "USER_DECLINED_HIGH_IMPACT_PATCH",
              target: String(path),
            });
          }
        }
      }

      const finalContent = editPlan.finalContent;
      if (finalContent === content) {
        return impactBefore && decision
          ? formatPatchImpactSkipped(impactBefore.targetFile, decision, impactBefore.summary)
          : `Edit skipped for ${relative(workspacePath, targetFile)}. ${editPlan.summary} would not change the file.`;
      }

      if (!fileExists) {
        await mkdir(dirname(targetFile), { recursive: true });
      }
      await atomicWriteFile(targetFile, finalContent);

      const rel = relative(workspacePath, targetFile);
      const impactSummary = impactAnalysis === "full" && impactBefore
        ? `\n${formatPatchImpactSummary(await analyzePatchAfter(impactBefore))}`
        : impactAnalysis === "before" && impactBefore && decision
          ? `\nPATCH_IMPACT_DECISION\nRisk: ${decision.level.toUpperCase()}\nValidation: ${decision.validationCommands.join(", ")}`
          : "\nImpact analysis skipped for speed. Set impactAnalysis to full when dependency impact is required.";
      return `File ${rel} successfully ${fileExists ? "edited" : "created"} with ${editPlan.summary}.\nNo backup file was created.${impactSummary}`;
    } catch (error) {
      return `Error editing file: ${(error as Error).message}`;
    }
  },
};

async function requestHighImpactPatchApproval(input: {
  workspacePath: string;
  toolName: string;
  target: string;
  summary: string;
  riskScore: string;
}) {
  const stop = policyService.createStop({
    runId: `tool-${Date.now()}`,
    workspacePath: input.workspacePath,
    toolName: input.toolName,
    severity: "warning",
    policyId: "change.high_impact.allow_flag",
    title: "Run paused: high-impact patch requires approval.",
    explanation:
      "The agent set allowHighImpact: true. A human must approve this high-impact patch before execution continues.",
    kind: "HIGH_IMPACT_PATCH_APPROVAL",
    target: input.target,
    metadata: {
      patchSummary: input.summary,
      riskScore: input.riskScore,
      allowHighImpact: true,
    },
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort", "safer_alternative"],
  });
  const resolvedStop = await policyService.waitForResolution(stop.id);
  policyService.markStopCompleted(stop.id);
  return resolvedStop.resolution?.action === "approve_once";
}

type FileEditOperation =
  | "replace_range"
  | "insert_before"
  | "insert_after"
  | "delete_range"
  | "replace_block"
  | "append"
  | "create"
  | "overwrite";

type EditPlanInput = {
  content: string;
  fileExists: boolean;
  operation: FileEditOperation;
  startLine?: number;
  endLine?: number;
  newContent: string;
  expectedContent?: string;
  searchString?: string;
  replaceAll: boolean;
  failIfExists: boolean;
};

type EditPlan = {
  finalContent: string;
  summary: string;
};

function normalizeOperation(operation: unknown): FileEditOperation {
  return operation === "insert_before" ||
    operation === "insert_after" ||
    operation === "delete_range" ||
    operation === "replace_block" ||
    operation === "append" ||
    operation === "create" ||
    operation === "overwrite"
    ? operation
    : "replace_range";
}

function buildEditPlan(input: EditPlanInput): EditPlan | string {
  switch (input.operation) {
    case "create":
      if (input.fileExists && input.failIfExists !== false) {
        return "File already exists. Use overwrite, append, or another edit operation to modify it.";
      }
      return { finalContent: input.newContent, summary: "create" };
    case "overwrite":
      if (typeof input.expectedContent === "string" && input.content !== input.expectedContent) {
        return "Edit rejected. expectedContent did not match whole file. No file was changed.";
      }
      return { finalContent: input.newContent, summary: "overwrite" };
    case "append":
      if (!input.fileExists) return { finalContent: input.newContent, summary: "append/create" };
      if (typeof input.expectedContent === "string" && input.content !== input.expectedContent) {
        return "Edit rejected. expectedContent did not match whole file. No file was changed.";
      }
      return { finalContent: `${input.content}${input.newContent}`, summary: "append" };
    case "replace_block":
      return buildBlockReplacePlan(input);
    case "insert_before":
    case "insert_after":
    case "delete_range":
    case "replace_range":
      return buildRangeEditPlan(input);
  }
}

function buildBlockReplacePlan(input: EditPlanInput): EditPlan | string {
  if (!input.fileExists) return "File does not exist. Use create to create a new file.";
  if (!input.searchString) return "replace_block requires searchString.";
  if (!input.content.includes(input.searchString)) {
    return "Edit rejected. Exact searchString was not found. No file was changed.";
  }

  const matchCount = input.content.split(input.searchString).length - 1;
  const finalContent = input.replaceAll
    ? input.content.split(input.searchString).join(input.newContent)
    : input.content.replace(input.searchString, input.newContent);
  return {
    finalContent,
    summary: `replace_block (${input.replaceAll ? matchCount : 1} occurrence(s))`,
  };
}

function buildRangeEditPlan(input: EditPlanInput): EditPlan | string {
  const line = asPositiveLine(input.startLine);
  if (!line) return `${input.operation} requires startLine >= 1.`;
  const endLine = input.operation === "insert_before" || input.operation === "insert_after"
    ? line
    : asPositiveLine(input.endLine ?? input.startLine);
  if (!endLine || endLine < line) return "Invalid line range.";
  if (!input.fileExists && (line !== 1 || endLine !== 1)) {
    return "File does not exist. Use create, or replace range 1-1 to create it.";
  }

  const range = locateLineRange(input.content, line, endLine);
  if (!range) return `Line range is beyond file length (${countLines(input.content)} lines).`;

  const currentRange = input.content.slice(range.startOffset, range.endOffset);
  if (typeof input.expectedContent === "string" && currentRange !== input.expectedContent) {
    return `Edit rejected. expectedContent did not match lines ${line}-${endLine}. No file was changed.`;
  }

  const insertionOffset = input.operation === "insert_after" ? range.endOffsetWithLineEnding : range.startOffset;
  if (input.operation === "insert_before" || input.operation === "insert_after") {
    return {
      finalContent: `${input.content.slice(0, insertionOffset)}${input.newContent}${input.content.slice(insertionOffset)}`,
      summary: `${input.operation} line ${line}`,
    };
  }

  const replacement = input.operation === "delete_range" ? "" : input.newContent;
  return {
    finalContent: `${input.content.slice(0, range.startOffset)}${replacement}${input.content.slice(range.endOffset)}`,
    summary: `${input.operation} lines ${line}-${endLine}`,
  };
}

function asPositiveLine(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

async function atomicWriteFile(targetFile: string, content: string) {
  const targetDirectory = dirname(targetFile);
  const tempFile = join(
    targetDirectory,
    `.${basename(targetFile)}.matex-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    handle = await open(tempFile, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempFile, targetFile);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function countLines(content: string) {
  if (!content) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) lines++;
  }
  return lines;
}

function locateLineRange(content: string, startLine: number, endLine: number) {
  if (!content) return startLine === 1 ? { startOffset: 0, endOffset: 0, endOffsetWithLineEnding: 0 } : null;

  let currentLine = 1;
  let startOffset = startLine === 1 ? 0 : -1;
  let endOffset = content.length;
  let endOffsetWithLineEnding = content.length;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    if (currentLine + 1 === startLine) startOffset = index + 1;
    if (currentLine === endLine) {
      endOffset = index;
      endOffsetWithLineEnding = index + 1;
      break;
    }
    currentLine++;
  }

  if (startOffset < 0) return null;
  if (endLine > currentLine && endOffset === content.length) return null;
  return { startOffset, endOffset, endOffsetWithLineEnding };
}
