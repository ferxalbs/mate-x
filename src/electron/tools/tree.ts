import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../tool-service";
import { resolveWorkspacePathForRead } from "./tool-utils";

export const projectTreeTool: Tool = {
  name: "tree",
  description: "Generate a visual tree structure of the project directory.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'The root directory for the tree (relative to workspace root). Defaults to ".".',
      },
      depth: {
        type: "number",
        description: "Maximum depth of the tree. Defaults to 2.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const relativePath = args.path || ".";
    const maxDepth = args.depth || 2;
    try {
      const startDir = await resolveWorkspacePathForRead(workspacePath, relativePath);
      const tree = await buildTree(startDir, 0, maxDepth);
      return tree || "Directory empty or depth exceeded.";
    } catch (error) {
      return `Error generating tree: ${(error as Error).message}`;
    }
  },
};

async function buildTree(
  dir: string,
  currentDepth: number,
  maxDepth: number,
  prefix = "",
): Promise<string> {
  if (currentDepth > maxDepth) return "";

  const entries = await readdir(dir, { withFileTypes: true });
  const visibleEntries = entries.filter(
    (entry) =>
      !entry.name.includes("node_modules") &&
      !entry.name.includes(".git"),
  );
  let result = "";

  for (let i = 0; i < visibleEntries.length; i++) {
    const entry = visibleEntries[i];
    const isLast = i === visibleEntries.length - 1;
    const marker = isLast ? "└── " : "├── ";
    const isSymlink = entry.isSymbolicLink();
    result += `${prefix}${marker}${entry.name}${entry.isDirectory() && !isSymlink ? "/" : isSymlink ? " @" : ""}\n`;

    // Never recurse through directory symlinks. The displayed link is useful
    // evidence, but resolving it during traversal would re-open the workspace
    // escape that the root validator closed.
    if (entry.isDirectory() && !isSymlink && currentDepth < maxDepth) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      result += await buildTree(
        join(dir, entry.name),
        currentDepth + 1,
        maxDepth,
        newPrefix,
      );
    }
  }

  return result;
}
