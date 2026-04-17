import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../tool-service";

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
    },
    required: ["path", "searchString", "replacementString"],
  },
  async execute(args, { workspacePath }) {
    const { path, searchString, replacementString } = args;
    const targetFile = join(workspacePath, path);
    const backupFile = `${targetFile}.bak`;

    try {
      const content = await readFile(targetFile, "utf8");

      if (!content.includes(searchString)) {
        return `Patch failed: The exact searchString was not found in ${path}.`;
      }

      // Create backup
      await copyFile(targetFile, backupFile);

      // Apply patch globally across the file
      // If we only want single replacement, we can use content.replace once.
      // Doing global replacement for safety if pattern repeats.
      const newContent = content.split(searchString).join(replacementString);

      await writeFile(targetFile, newContent, "utf8");

      return `Patch applied successfully to ${path}.\\nBackup created at ${path}.bak`;
    } catch (error) {
      return `Error applying patch: ${(error as Error).message}`;
    }
  },
};
