import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);

export const astGrepTool: Tool = {
  name: "ast_grep",
  description:
    "Context-aware semantic semantic grep. Captures entire code blocks (e.g. functions, classes) where a vulnerability signature is found, instead of just a single line.",
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
        description: "Max number of blocks to return. Defaults to 5.",
      },
    },
    required: ["query"],
  },
  async execute(args, { workspacePath }) {
    const { query, path = ".", maxResults = 5 } = args;

    try {
      const { stdout } = await execFileAsync(
        "rg",
        ["-n", "--no-heading", "--", query, path], // -- prevents argument injection from query or path
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
          const content = await readFile(join(workspacePath, file), "utf8");
          const fileLines = content.split("\n");
          let startLine = lineNum - 1;

          while (
            startLine > 0 &&
            !/function |class |=>|\bconst \w+\s*=\s*\(|\blet \w+\s*=\s*\(/.test(
              fileLines[startLine] ?? ""
            ) &&
            lineNum - startLine < 15
          ) {
            startLine--;
          }

          if (lineNum - startLine >= 15) {
            startLine = Math.max(0, lineNum - 6);
          }

          let endLine = lineNum - 1;
          let braceCount = 0;
          let inBlock = false;

          for (let i = startLine; i < fileLines.length; i++) {
            const lineHtml = fileLines[i];
            const openBraces = (lineHtml?.match(/{/g) || []).length;
            const closeBraces = (lineHtml?.match(/}/g) || []).length;

            braceCount += openBraces;
            braceCount -= closeBraces;

            if (openBraces > 0) inBlock = true;

            if (inBlock && braceCount <= 0) {
              endLine = i;
              break;
            }

            if (i - startLine > 100) {
              endLine = i;
              break;
            }
          }

          const snippetStart = Math.max(0, lineNum - 3);
          const snippetEnd = Math.min(fileLines.length, lineNum + 2);
          const extractedLines =
            endLine >= startLine
              ? fileLines.slice(startLine, endLine + 1)
              : fileLines.slice(snippetStart, snippetEnd);
          const labelStart = endLine >= startLine ? startLine + 1 : snippetStart + 1;
          const labelEnd = endLine >= startLine ? endLine + 1 : snippetEnd;

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
    } catch (_error) {
      return "No matches found.";
    }
  },
};
