import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Tool } from "../tool-service";
import { analyzePatchAfter, analyzePatchBefore, formatPatchImpactSummary } from "../patch-impact-engine";
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
    },
    required: ["path", "startLine", "endLine", "newContent"],
  },
  async execute(args, { workspacePath }) {
    const { path, startLine, endLine, newContent } = args;
    if (startLine < 1 || endLine < startLine) return "Invalid line numbers.";
    
    const targetFile = resolveWorkspacePath(workspacePath, path);

    try {
      const content = await readFile(targetFile, "utf8");
      const impactBefore = await analyzePatchBefore(workspacePath, String(path));
      const lines = content.split('\n');
      
      if (startLine > lines.length) return `startLine is beyond file length (${lines.length} lines).`;
      
      const zeroStart = startLine - 1;
      const zeroEnd = endLine; // exclusive when slicing
      
      const before = lines.slice(0, zeroStart);
      const after = lines.slice(zeroEnd);
      
      const newLines = newContent.split('\n');
      const finalContent = [...before, ...newLines, ...after].join('\n');

      await writeFile(targetFile, finalContent, "utf8");
      const impactSummary = await analyzePatchAfter(impactBefore);

      const rel = relative(workspacePath, targetFile);
      return `File ${rel} successfully edited lines ${startLine}-${endLine}.\nNo backup file was created.\n${formatPatchImpactSummary(impactSummary)}`;
    } catch (error) {
      return `Error editing file: ${(error as Error).message}`;
    }
  },
};
