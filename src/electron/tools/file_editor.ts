import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
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
    },
    required: ["path", "startLine", "endLine", "newContent"],
  },
  async execute(args, { workspacePath }) {
    const { path, startLine, endLine, newContent, expectedContent, allowHighImpact = false } = args;
    if (startLine < 1 || endLine < startLine) return "Invalid line numbers.";
    
    const targetFile = resolveWorkspacePath(workspacePath, path);

    try {
      const content = await readFile(targetFile, "utf8");
      const impactBefore = await analyzePatchBefore(workspacePath, String(path));
      const decision = assessPatchBeforeWrite(impactBefore);
      const lines = content.split('\n');
      
      if (startLine > lines.length) return `startLine is beyond file length (${lines.length} lines).`;
      
      const zeroStart = startLine - 1;
      const zeroEnd = endLine; // exclusive when slicing
      
      const before = lines.slice(0, zeroStart);
      const after = lines.slice(zeroEnd);
      const currentRange = lines.slice(zeroStart, zeroEnd).join('\n');
      if (typeof expectedContent === "string" && currentRange !== expectedContent) {
        return `Edit rejected for ${relative(workspacePath, targetFile)}. expectedContent did not match lines ${startLine}-${endLine}. No file was changed.`;
      }
      
      const newLines = newContent.split('\n');
      const finalContent = [...before, ...newLines, ...after].join('\n');
      if (finalContent === content) {
        return formatPatchImpactSkipped(impactBefore.targetFile, decision, impactBefore.summary);
      }
      if (decision.requiresConfirmation && allowHighImpact !== true) {
        return formatPatchImpactBlocked(impactBefore.targetFile, decision, impactBefore.summary);
      }

      await writeFile(targetFile, finalContent, "utf8");
      const impactSummary = await analyzePatchAfter(impactBefore);

      const rel = relative(workspacePath, targetFile);
      return `File ${rel} successfully edited lines ${startLine}-${endLine}.\nNo backup file was created.\n${formatPatchImpactSummary(impactSummary)}`;
    } catch (error) {
      return `Error editing file: ${(error as Error).message}`;
    }
  },
};
