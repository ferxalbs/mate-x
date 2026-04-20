import { relative } from "node:path";
import type { Tool } from "../tool-service";
import {
  clampNumber,
  limitTextOutput,
  readUtf8FileSafe,
} from "./tool-utils";

export const readManyTool: Tool = {
  name: "read_many",
  description:
    "Read multiple files in one call with optional line ranges to reduce tool round-trips.",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "List of file paths relative to workspace root.",
      },
      lineStart: {
        type: "number",
        description: "Optional start line (1-indexed, inclusive) applied to each file.",
      },
      lineEnd: {
        type: "number",
        description: "Optional end line (1-indexed, inclusive) applied to each file.",
      },
      maxCharsPerFile: {
        type: "number",
        description: "Optional output cap per file in characters. Defaults to 12000.",
      },
    },
    required: ["paths"],
  },
  async execute(args, { workspacePath }) {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    if (paths.length === 0) {
      return "Error: paths must include at least one file.";
    }

    const maxFiles = 12;
    const selectedPaths = paths.slice(0, maxFiles);
    const maxCharsPerFile = clampNumber(args.maxCharsPerFile, 500, 100_000, 12_000);
    const lineStartRaw = args.lineStart;
    const lineEndRaw = args.lineEnd;

    // Use Promise.all to execute concurrent reads for better performance
    const sections = await Promise.all(
      selectedPaths.map(async (path) => {
        try {
          const { resolvedPath, content } = await readUtf8FileSafe(workspacePath, path);
          const relPath = relative(workspacePath, resolvedPath);
          const lines = content.split("\n");

          let excerpt = content;
          if (typeof lineStartRaw === "number" || typeof lineEndRaw === "number") {
            const start = Math.max(1, Math.floor(Number(lineStartRaw ?? 1)));
            const end = Math.min(
              lines.length,
              Math.floor(Number(lineEndRaw ?? lines.length)),
            );
            if (end < start) {
              return `### ${relPath}\nError: invalid line range (${start}-${end}).`;
            }

            excerpt = lines.slice(start - 1, end).join("\n");
            excerpt = `Showing lines ${start}-${end} of ${lines.length}\n${excerpt}`;
          }

          return `### ${relPath}\n${limitTextOutput(excerpt, maxCharsPerFile)}`;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown error.";
          return `### ${path}\nError: ${reason}`;
        }
      }),
    );

    if (paths.length > selectedPaths.length) {
      sections.push(
        `Note: processed ${selectedPaths.length}/${paths.length} paths (max ${maxFiles} per call).`,
      );
    }

    return sections.join("\n\n");
  },
};
