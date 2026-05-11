import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { Tool } from "../tool-service";
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
  description: "Surgically patch a file by replacing a specific line range with new content. Returns PATCH_IMPACT_SUMMARY_JSON and does not create backup files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file to edit (relative to workspace).",
      },
      startLine: {
        type: "number",
        description: "The starting line number to replace (1-indexed, inclusive).",
      },
      endLine: {
        type: "number",
        description: "The ending line number to replace (1-indexed, inclusive).",
      },
      newContent: {
        type: "string",
        description: "The new content to insert in place of the specified lines.",
      },
      expectedContent: {
        type: "string",
        description:
          "Optional exact current content for the target line range. If provided and it does not match, the edit is rejected.",
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
    required: ["path", "startLine", "endLine", "newContent"],
  },
  async execute(args, { workspacePath }) {
    const { path, startLine, endLine, newContent, expectedContent, allowHighImpact = false } = args;
    const impactAnalysis = args.impactAnalysis === "before" || args.impactAnalysis === "full"
      ? args.impactAnalysis
      : "none";
    if (startLine < 1 || endLine < startLine) return "Invalid line numbers.";
    
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

      if (!fileExists && (startLine !== 1 || endLine !== 1)) {
        return "File does not exist. To create a new file, replace lines 1-1 with the full file content.";
      }

      const range = locateLineRange(content, startLine, endLine);
      if (!range) return `startLine is beyond file length (${countLines(content)} lines).`;

      const currentRange = content.slice(range.startOffset, range.endOffset);
      if (typeof expectedContent === "string" && currentRange !== expectedContent) {
        return `Edit rejected for ${relative(workspacePath, targetFile)}. expectedContent did not match lines ${startLine}-${endLine}. No file was changed.`;
      }

      const impactBefore = impactAnalysis === "none"
        ? null
        : await analyzePatchBefore(workspacePath, String(path));
      const decision = impactBefore ? assessPatchBeforeWrite(impactBefore) : null;
      if (impactBefore && decision?.requiresConfirmation && allowHighImpact !== true) {
        return formatPatchImpactBlocked(impactBefore.targetFile, decision, impactBefore.summary);
      }

      const finalContent = `${content.slice(0, range.startOffset)}${newContent}${content.slice(range.endOffset)}`;
      if (finalContent === content) {
        return impactBefore && decision
          ? formatPatchImpactSkipped(impactBefore.targetFile, decision, impactBefore.summary)
          : `Edit skipped for ${relative(workspacePath, targetFile)}. Replacement would not change the file.`;
      }

      if (!fileExists) {
        await mkdir(dirname(targetFile), { recursive: true });
      }
      await writeFile(targetFile, finalContent, "utf8");

      const rel = relative(workspacePath, targetFile);
      const impactSummary = impactAnalysis === "full" && impactBefore
        ? `\n${formatPatchImpactSummary(await analyzePatchAfter(impactBefore))}`
        : impactAnalysis === "before" && impactBefore && decision
          ? `\nPATCH_IMPACT_DECISION\nRisk: ${decision.level.toUpperCase()}\nValidation: ${decision.validationCommands.join(", ")}`
          : "\nImpact analysis skipped for speed. Set impactAnalysis to full when dependency impact is required.";
      return `File ${rel} successfully ${fileExists ? "edited" : "created"} lines ${startLine}-${endLine}.\nNo backup file was created.${impactSummary}`;
    } catch (error) {
      return `Error editing file: ${(error as Error).message}`;
    }
  },
};

function countLines(content: string) {
  if (!content) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) lines++;
  }
  return lines;
}

function locateLineRange(content: string, startLine: number, endLine: number) {
  if (!content) return startLine === 1 ? { startOffset: 0, endOffset: 0 } : null;

  let currentLine = 1;
  let startOffset = startLine === 1 ? 0 : -1;
  let endOffset = content.length;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;
    if (currentLine + 1 === startLine) startOffset = index + 1;
    if (currentLine === endLine) {
      endOffset = index;
      break;
    }
    currentLine++;
  }

  if (startOffset < 0) return null;
  if (endLine > currentLine && endOffset === content.length) return null;
  return { startOffset, endOffset };
}
