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
      // First, use standard grep to find line numbers
      const { stdout } = await execFileAsync(
        "rg",
        ["-n", "--no-heading", query, path],
        { cwd: workspacePath }
      );
      
      const lines = stdout.split("\\n").filter(Boolean);
      if (lines.length === 0) return "No matches found.";

      const matches = lines.slice(0, maxResults);
      const results: string[] = [];

      for (const matchLine of matches) {
        const parts = matchLine.match(/^(.+?):(\\d+):(.*)$/);
        if (!parts) continue;

        const [, file, lineStr] = parts;
        const lineNum = parseInt(lineStr, 10);
        
        try {
          const content = await readFile(join(workspacePath, file), "utf8");
          const fileLines = content.split("\\n");
          
          // Heuristic AST Block Extraction using Brace Balancing
          let startLine = lineNum - 1;
          
          // Walk up to find the start of the block (e.g. function or class keyword)
          while (startLine > 0 && 
                 !/function |class |=>|\\bconst \\w+\\s*=\\s*\\(|\\blet \\w+\\s*=\\s*\\(/.test(fileLines[startLine]) &&
                 lineNum - startLine < 15) { // don't go back more than 15 lines blindly
            startLine--;
          }
          
          // If we couldn't find a clear start, just provide a fixed 5-line prefix
          if (lineNum - startLine >= 15) {
            startLine = Math.max(0, lineNum - 6);
          }

          let endLine = lineNum - 1;
          let braceCount = 0;
          let inBlock = false;

          // Walk down to balance braces
          for (let i = startLine; i < fileLines.length; i++) {
            const lineHtml = fileLines[i];
            const openBraces = (lineHtml.match(/\\{/g) || []).length;
            const closeBraces = (lineHtml.match(/\\}/g) || []).length;

            braceCount += openBraces;
            braceCount -= closeBraces;

            if (openBraces > 0) inBlock = true;

            if (inBlock && braceCount <= 0) {
              endLine = i;
              break;
            }
            
            // Failsafe: don't capture more than 100 lines per block
            if (i - startLine > 100) {
              endLine = i;
              break;
            }
          }
          
          results.push(`--- FILE: ${file} (Lines ${startLine + 1}-${endLine + 1}) ---\\n${fileLines.slice(startLine, endLine + 1).join('\\n')}\\n`);

        } catch (_err) {
          results.push(`Failed to extract block from ${file}`);
        }
      }

      return results.length > 0
        ? `Extracted Context Blocks for query '${query}':\\n\\n${results.join('\\n')}`
        : "Matches found, but context extraction failed.";
    } catch (_error) {
      return `Error executing AST Grep: No occurrences found.`;
    }
  },
};
