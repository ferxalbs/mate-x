import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);

const SECRET_PATTERNS = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  {
    name: "Generic API Key",
    regex:
      /"?[a-zA-Z0-9_-]*[aA][pP][iI]_[kK][eE][yY]"?[ :]+['"]([a-zA-Z0-9_-]{16,})['"]/g,
  },
  {
    name: "Generic Secret",
    regex:
      /"?[a-zA-Z0-9_-]*[sS][eE][cC][rR][eE][tT]"?[ :]+['"]([a-zA-Z0-9_-]{16,})['"]/g,
  },
  { name: "Private Key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Slack Token", regex: /xox[baprs]-[0-9a-zA-Z]{10,48}/g },
  { name: "Stripe API Key", regex: /sk_live_[0-9a-zA-Z]{24}/g },
];

export const secretScanTool: Tool = {
  name: "secret_scan",
  description:
    "Deep-scans the repository for hardcoded secrets, API keys, and tokens.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'The directory or file to scan (relative to workspace root). Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings }) {
    const relativePath = args.path || ".";

    try {
      // Use rg to find potential files first to be efficient
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync(
        "rg",
        ["--files", "--", relativePath],
        { cwd: workspacePath },
      );
      const files = stdout.split("\n").filter(Boolean);
      const promises = files.map(async (file) => {
        if (file.includes("node_modules") || file.includes(".git")) return [];

        try {
          const content = await readFile(join(workspacePath, file), "utf8");
          const fileResults: string[] = [];
          for (const pattern of SECRET_PATTERNS) {
            const matches = content.match(pattern.regex);
            if (matches) {
              fileResults.push(
                `[${pattern.name}] found in ${file} (${matches.length} occurrence(s))`,
              );
            }
          }
          return fileResults;
        } catch {
          return [];
        }
      });

      const results = (await Promise.all(promises)).flat();

      return results.length > 0
        ? `Scan complete. Found potential secrets:\n${results.join("\n")}`
        : "Scan complete. No secrets found.";
    } catch (error) {
      return `Error scanning for secrets: ${(error as Error).message}`;
    }
  },
};
