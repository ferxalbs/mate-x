import { readFile, writeFile, copyFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Tool } from "../tool-service";
import { resolveWorkspacePath } from "./tool-utils";

export const autoPatchTool: Tool = {
  name: "auto_patch",
  description:
    "An Active Remediation tool that replaces a vulnerable block of code with a secure patch. Automatically creates a .bak backup before writing.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file to patch (relative to workspace).",
      },
      searchString: {
        type: "string",
        description: "The exact vulnerable string/block to replace. Must exactly match the file.",
      },
      replacementString: {
        type: "string",
        description: "The secure code to inject.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Replace every occurrence when true. Defaults to false (single replacement).",
      },
    },
    required: ["path", "searchString", "replacementString"],
  },
  async execute(args, { workspacePath, settings }) {
    const { path, searchString, replacementString, replaceAll = false } = args;
    const targetFile = resolveWorkspacePath(workspacePath, path);
    const backupFile = `${targetFile}.bak`;

    try {
      const content = await readFile(targetFile, "utf8");

      if (!content.includes(searchString)) {
        return `Patch failed: The exact searchString was not found in ${path}.`;
      }

      // Create backup
      await copyFile(targetFile, backupFile);

      const replacementCount = content.split(searchString).length - 1;
      const newContent = replaceAll
        ? content.split(searchString).join(replacementString)
        : content.replace(searchString, replacementString);

      await writeFile(targetFile, newContent, "utf8");

      const rel = relative(workspacePath, targetFile);
      return `Patch applied successfully to ${rel}. Replaced ${
        replaceAll ? replacementCount : 1
      } occurrence(s).\nBackup created at ${rel}.bak`;
    } catch (error) {
      return `Error applying patch: ${(error as Error).message}`;
    }
  },
};
