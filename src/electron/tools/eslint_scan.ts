import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Tool } from "../tool-service";
import { resolveWorkspacePath } from "./tool-utils";

const execFileAsync = promisify(execFile);

export const eslintScanTool: Tool = {
  name: "eslint_scan",
  description: "High-performance local ESLint scanner. Audits code quality and security rule compliance, with an optional auto-fix flag to automatically repair simple issues.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file or directory to scan (default: '.').",
      },
      fix: {
        type: "boolean",
        description: "Automatically fix simple formatting and security violations.",
      },
      ext: {
        type: "string",
        description: "Comma-separated list of file extensions to scan (default: '.js,.ts,.jsx,.tsx').",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const targetInput = args.path || ".";
    const fix = !!args.fix;
    const extensions = args.ext || ".js,.ts,.jsx,.tsx";

    let targetPath: string;
    try {
      targetPath = resolveWorkspacePath(workspacePath, targetInput);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }

    // Determine the local eslint executable path for reliability and speed
    const isWindows = process.platform === "win32";
    const binName = isWindows ? "eslint.cmd" : "eslint";
    const localEslint = join(workspacePath, "node_modules", ".bin", binName);

    let eslintCmd = "npx";
    let eslintArgs = ["eslint"];

    if (existsSync(localEslint)) {
      eslintCmd = localEslint;
      eslintArgs = [];
    }

    // Append standard arguments
    eslintArgs.push(targetPath);
    eslintArgs.push("--ext", extensions);
    eslintArgs.push("--format", "json");

    if (fix) {
      eslintArgs.push("--fix");
    }

    try {
      const { stdout } = await execFileAsync(eslintCmd, eslintArgs, {
        cwd: workspacePath,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      // If it exits with 0 and stdout is empty, it's clean
      if (!stdout || stdout.trim() === "") {
        return `ESLint completed successfully: 0 warnings or errors in "${targetInput}".`;
      }

      return parseEslintJson(stdout, workspacePath);
    } catch (err: any) {
      // ESLint returns non-zero exits on errors/warnings
      if (err.stdout) {
        return parseEslintJson(err.stdout, workspacePath);
      }
      return `ESLint execution failed: ${err.message}`;
    }
  },
};

function parseEslintJson(stdout: string, workspacePath: string): string {
  try {
    const reports = JSON.parse(stdout.trim());
    let errorCount = 0;
    let warningCount = 0;
    let fixableCount = 0;
    let detailsReport = "";

    reports.forEach((fileReport: any) => {
      const relativeFile = fileReport.filePath.replace(workspacePath + "/", "");
      const messages = fileReport.messages || [];

      errorCount += fileReport.errorCount || 0;
      warningCount += fileReport.warningCount || 0;
      fixableCount += fileReport.fixableErrorCount || 0;
      fixableCount += fileReport.fixableWarningCount || 0;

      if (messages.length > 0) {
        detailsReport += `File: ${relativeFile}\n`;
        messages.forEach((msg: any) => {
          const type = msg.severity === 2 ? "ERROR" : "WARNING";
          detailsReport += `  [${type}] Line ${msg.line}:${msg.column} - ${msg.message} (${msg.ruleId || "no-rule"})\n`;
          if (msg.fix) {
            detailsReport += `    * Auto-fixable *\n`;
          }
        });
        detailsReport += `----------------\n`;
      }
    });

    if (errorCount === 0 && warningCount === 0) {
      return "ESLint completed successfully: 0 warnings or errors detected.";
    }

    let summary = `ESLint Scan Summary:\n`;
    summary += `- Errors: ${errorCount}\n`;
    summary += `- Warnings: ${warningCount}\n`;
    if (fixableCount > 0) {
      summary += `- Fixable: ${fixableCount} (Run eslint_scan with { "fix": true } to automatically resolve)\n`;
    }
    summary += `\nDetailed Issues:\n${detailsReport}`;

    return summary;
  } catch (_err: any) {
    // If it's not valid JSON, return raw stdout
    return `ESLint output:\n${stdout.substring(0, 10000)}`;
  }
}
