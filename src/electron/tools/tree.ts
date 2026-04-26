import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../tool-service";

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
  async execute(args, { workspacePath, settings }) {
    const relativePath = args.path || ".";
    const maxDepth = args.depth || 2;
    const startDir = join(workspacePath, relativePath);

    try {
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
  let result = "";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name.includes("node_modules") || entry.name.includes(".git"))
      continue;

    const isLast = i === entries.length - 1;
    const marker = isLast ? "└── " : "├── ";
    result += `${prefix}${marker}${entry.name}${entry.isDirectory() ? "/" : ""}\n`;

    if (entry.isDirectory() && currentDepth < maxDepth) {
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
