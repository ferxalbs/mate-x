import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);

export const gitForensicsTool: Tool = {
  name: "git_forensics",
  description:
    "Analyzes git history to compute file churn and identify risk hotspots. Files that change most often are statistically the highest risk for vulnerabilities.",
  parameters: {
    type: "object",
    properties: {
      monthsOut: {
        type: "number",
        description: "Number of months of git history to analyze. Defaults to 6.",
      },
      limit: {
        type: "number",
        description: "Number of hotspot files to return. Defaults to 10.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const { monthsOut = 6, limit = 10 } = args;

    try {
      // Get all files changed in the last X months
      const sinceDate = new Date();
      sinceDate.setMonth(sinceDate.getMonth() - monthsOut);
      const sinceStr = sinceDate.toISOString().split("T")[0];

      const { stdout } = await execFileAsync(
        "git",
        ["log", `--since=${sinceStr}`, "--name-only", "--pretty=format:"],
        { cwd: workspacePath }
      );

      const files = stdout.split("\\n").filter(Boolean);
      if (files.length === 0) return "No commit history found in that range.";

      // Compute churn
      const churnMap: Record<string, number> = {};
      for (const file of files) {
        // Skip obvious non-code volatility
        if (file === "package.json" || file === "bun.lock" || file.endsWith(".lock")) continue;
        churnMap[file] = (churnMap[file] || 0) + 1;
      }

      // Sort by churn
      const sortedHotspots = Object.entries(churnMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      if (sortedHotspots.length === 0) return "No valid code files identified in history.";

      let report = `Git Forensics Hotspot Report (Last ${monthsOut} months):\\n======================================================\\n`;
      report += `These files have changed the most often. High churn correlates strongly with security bugs and tech debt.\\n\\n`;

      sortedHotspots.forEach(([file, count], i) => {
        report += `${i + 1}. ${file} (${count} modifications)\\n`;
      });

      return report;
    } catch (error) {
      return `Error analyzing git history: ${(error as Error).message}. (Is this a git repository?)`;
    }
  },
};
