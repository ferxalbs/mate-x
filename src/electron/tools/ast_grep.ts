import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 25;
const DEFAULT_CONTEXT_LINES = 2;
const MAX_CONTEXT_LINES = 200;
const MAX_BLOCK_LINES = 1600;
const DECLARATION_PATTERN =
  /^\s*(export\s+)?(async\s+)?(function\b|class\b|interface\b|type\b|enum\b|const\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>|const\s+\w+\s*=\s*(async\s*)?function\b|let\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>|var\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>)/;

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relativePath = relative(workspacePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const countChars = (line: string, char: "{" | "}") =>
  [...line].filter((currentChar) => currentChar === char).length;

const findBlockBounds = (fileLines: string[], lineNum: number, contextLines: number) => {
  const matchIndex = lineNum - 1;
  let startLine = matchIndex;

  while (startLine > 0 && matchIndex - startLine < 30) {
    if (DECLARATION_PATTERN.test(fileLines[startLine] ?? "")) break;
    startLine--;
  }

  if (!DECLARATION_PATTERN.test(fileLines[startLine] ?? "")) {
    startLine = Math.max(0, matchIndex - contextLines);
  }

  let endLine = Math.min(fileLines.length - 1, matchIndex + contextLines);
  let braceCount = 0;
  let sawOpeningBrace = false;

  for (let i = startLine; i < fileLines.length && i - startLine < MAX_BLOCK_LINES; i++) {
    const line = fileLines[i] ?? "";
    braceCount += countChars(line, "{");
    braceCount -= countChars(line, "}");
    sawOpeningBrace ||= line.includes("{");

    if (sawOpeningBrace && braceCount <= 0 && i >= matchIndex) {
      endLine = i;
      break;
    }
  }

  return { startLine, endLine };
};

export const astGrepTool: Tool = {
  name: "ast_grep",
  description:
    "Context-aware semantic grep. Finds regex matches and returns surrounding code blocks (functions, classes, declarations) with line ranges.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The regex pattern to search for (e.g., 'eval\\\\(').",
      },
      path: {
        type: "string",
        description: "The directory or file to scan. Defaults to '.'.",
      },
      maxResults: {
        type: "number",
        description: "Max number of blocks to return. Defaults to 5, capped at 25.",
      },
      contextLines: {
        type: "number",
        description: "Fallback lines before/after each match when no code block is found. Defaults to 2, capped at 20.",
      },
      glob: {
        type: "string",
        description: "Optional ripgrep glob filter, e.g. '**/*.{ts,tsx}'.",
      },
      caseSensitive: {
        type: "boolean",
        description: "Use case-sensitive matching. Defaults to true.",
      },
    },
    required: ["query"],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const query = String(args.query ?? "").trim();
    const path = String(args.path ?? ".");
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : undefined;
    const maxResults = toPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT);
    const contextLines = toPositiveInteger(args.contextLines, DEFAULT_CONTEXT_LINES, MAX_CONTEXT_LINES);
    const caseSensitive = args.caseSensitive !== false;

    if (!query) return "Query is required.";

    const targetPath = resolve(workspacePath, path);
    if (!isInsideWorkspace(workspacePath, targetPath)) {
      return "Refusing to scan outside the workspace.";
    }

    try {
      const rgArgs = [
        "-n",
        "--no-heading",
        "--color",
        "never",
        "--max-count",
        String(maxResults),
      ];

      if (!caseSensitive) rgArgs.push("-i");
      if (glob) rgArgs.push("--glob", glob);
      rgArgs.push("--", query, path);

      const { stdout } = await execFileAsync(
        "rg",
        rgArgs, // -- prevents option injection from query or path
        { cwd: workspacePath }
      );

      const lines = stdout.split("\n").filter(Boolean);
      if (lines.length === 0) return "No matches found.";

      const matches = lines.slice(0, maxResults);
      const results: string[] = [];

      for (const matchLine of matches) {
        const parts = matchLine.match(/^(.+?):(\d+):(.*)$/);
        if (!parts) continue;

        const [, file, lineStr] = parts;
        const lineNum = parseInt(lineStr, 10);

        try {
          const filePath = resolve(workspacePath, file);
          if (!isInsideWorkspace(workspacePath, filePath)) {
            results.push(`--- FILE: ${file} (Line ${lineNum}) ---\nRefusing to read outside workspace.\n`);
            continue;
          }

          const content = await readFile(filePath, "utf8");
          const fileLines = content.split("\n");
          const { startLine, endLine } = findBlockBounds(fileLines, lineNum, contextLines);
          const extractedLines = fileLines.slice(startLine, endLine + 1);
          const labelStart = startLine + 1;
          const labelEnd = endLine + 1;

          results.push(
            `--- FILE: ${file} (Lines ${labelStart}-${labelEnd}) ---\n${extractedLines.join("\n")}\n`
          );

        } catch (_err) {
          results.push(`--- FILE: ${file} (Line ${lineNum}) ---\nUnable to read file contents.\n`);
        }
      }

      return results.length > 0
        ? `Extracted Context Blocks for query '${query}':\n\n${results.join("\n")}`
        : `Matches were found for '${query}', but no context blocks could be reconstructed.`;
    } catch (error) {
      const maybeError = error as { code?: number; stderr?: string; message?: string };
      if (maybeError.code === 1) return "No matches found.";
      return `ast_grep failed: ${maybeError.stderr?.trim() || maybeError.message || "Unknown error"}`;
    }
  },
};
