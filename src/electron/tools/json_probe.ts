import { relative } from "node:path";
import type { Tool } from "../tool-service";
import { readUtf8FileSafe } from "./tool-utils";

function getByDotPath(value: unknown, dotPath: string): unknown {
  const keys = dotPath
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

export const jsonProbeTool: Tool = {
  name: "json_probe",
  description:
    "Read and query JSON files by dot-path, returning compact structured output.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "JSON file path relative to workspace root.",
      },
      query: {
        type: "string",
        description: "Optional dot-path selector (e.g., dependencies.react).",
      },
      pretty: {
        type: "boolean",
        description: "Pretty-print output. Defaults to true.",
      },
    },
    required: ["path"],
  },
  async execute(args, { workspacePath }) {
    const pretty = args.pretty !== false;
    const query = typeof args.query === "string" ? args.query.trim() : "";

    try {
      const { resolvedPath, content } = await readUtf8FileSafe(
        workspacePath,
        args.path,
      );
      const parsed = JSON.parse(content);
      const selected = query ? getByDotPath(parsed, query) : parsed;
      const relPath = relative(workspacePath, resolvedPath);

      if (typeof selected === "undefined") {
        return `No value found at query "${query}" in ${relPath}.`;
      }

      if (!pretty) {
        return JSON.stringify(selected);
      }

      return JSON.stringify(
        {
          file: relPath,
          query: query || null,
          value: selected,
        },
        null,
        2,
      );
    } catch (error) {
      return `Error probing JSON: ${(error as Error).message}`;
    }
  },
};
