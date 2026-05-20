import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import glob from "fast-glob"; // We can use fast-glob if available, or a manual walk. Wait, glob tool uses fast-glob? Let's check or do a robust manual walk or use standard fs/promises. Let's do fs/promises recursive read or similar.
import { readdir, stat } from "node:fs/promises";
import type { Tool } from "../tool-service";
import { resolveWorkspacePath } from "./tool-utils";

const execFileAsync = promisify(execFile);

// Common security hotspots for built-in fallback scanner
const SECURITY_HOTSPOTS = [
  {
    id: "unsafe-eval",
    severity: "CRITICAL",
    pattern: /\beval\s*\([^)]*\)/g,
    description: "Use of eval() detected. This leads to potential Remote Code Execution (RCE) vulnerabilities.",
  },
  {
    id: "unsafe-dynamic-function",
    severity: "HIGH",
    pattern: /\bnew\s+Function\s*\([^)]*\)/g,
    description: "Use of dynamically created functions can allow arbitrary code execution.",
  },
  {
    id: "command-injection-risk",
    severity: "HIGH",
    pattern: /\b(exec|execSync|spawn|spawnSync|fork)\s*\(\s*[`"']([^`"'\s]+)[`"']/g,
    description: "Potential Command Injection risk. Ensure shell execution inputs are strictly validated and sanitized.",
  },
  {
    id: "prototype-pollution-risk",
    severity: "MEDIUM",
    pattern: /\[\s*['"`]__proto__['"`]\s*\]|\[\s*['"`]constructor['"`]\s*\]\s*\[\s*['"`]prototype['"`]\s*\]/g,
    description: "Prototype Pollution vector detected. Unsafe object merges can corrupt object prototype chains.",
  },
  {
    id: "xss-dangerously-set-html",
    severity: "HIGH",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:/g,
    description: "React dangerouslySetInnerHTML detected. Ensure variable content is fully sanitized to prevent XSS.",
  },
  {
    id: "unsafe-jwt-verification",
    severity: "MEDIUM",
    pattern: /\bjwt\.decode\s*\(/g,
    description: "JWT decoded without verification. Ensure signatures are verified using jwt.verify() before trust.",
  },
  {
    id: "hardcoded-credentials",
    severity: "CRITICAL",
    pattern: /\b(secret|passwd|password|api_key|apikey|private_key|token|auth_token)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/gi,
    description: "Possible hardcoded credential or API secret token. Restructure using process.env or secure vault.",
  },
];

async function* getFilesRecursively(dir: string): AsyncGenerator<string> {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (dirent.name === "node_modules" || dirent.name === ".git" || dirent.name === "dist" || dirent.name === "build") {
        continue;
      }
      yield* getFilesRecursively(res);
    } else {
      const ext = dirent.name.split(".").pop() || "";
      if (["js", "ts", "jsx", "tsx", "py", "go", "java", "rb", "php"].includes(ext)) {
        yield res;
      }
    }
  }
}

export const semgrepScanTool: Tool = {
  name: "semgrep_scan",
  description: "Structural security scanner. Uses local semgrep binary or falls back to an optimized built-in pattern ruleset to detect injection, XSS, RCE, and credentials.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory or file to scan (default: '.').",
      },
      ruleset: {
        type: "string",
        description: "The Semgrep ruleset to run, e.g. 'p/security-audit' or 'p/default' (default: 'p/security-audit').",
      },
      useFallbackOnly: {
        type: "boolean",
        description: "Force the use of the built-in fallback engine instead of running Semgrep.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const targetInput = args.path || ".";
    const ruleset = args.ruleset || "p/security-audit";
    const useFallbackOnly = !!args.useFallbackOnly;

    let targetPath: string;
    try {
      targetPath = resolveWorkspacePath(workspacePath, targetInput);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }

    if (!useFallbackOnly) {
      try {
        // Test if semgrep is installed
        await execFileAsync("semgrep", ["--version"]);
        
        // Execute semgrep in JSON format
        const { stdout } = await execFileAsync(
          "semgrep",
          ["scan", "--json", "--config", ruleset, targetPath],
          { cwd: workspacePath }
        );
        
        const data = JSON.parse(stdout);
        const results = data.results || [];
        
        if (results.length === 0) {
          return `Semgrep completed successfully: 0 issues found in ruleset "${ruleset}".`;
        }
        
        let report = `Semgrep found ${results.length} security hotspots:\n\n`;
        results.forEach((finding: any, index: number) => {
          const filePath = resolve(workspacePath, finding.path);
          const relativeFilePath = filePath.replace(workspacePath + "/", "");
          const line = finding.start?.line || "?";
          const col = finding.start?.col || "?";
          const message = finding.extra?.message || "Security finding.";
          const severity = finding.extra?.severity || "WARNING";
          const codeSnippet = finding.extra?.lines?.trim() || "";

          report += `[Finding #${index + 1}] Severity: ${severity} | Rule: ${finding.check_id}\n`;
          report += `Location: ${relativeFilePath}:${line}:${col}\n`;
          report += `Description: ${message}\n`;
          if (codeSnippet) {
            report += `Code:\n\`\`\`\n${codeSnippet}\n\`\`\`\n`;
          }
          report += `----------------\n\n`;
        });
        
        return report;
      } catch (err: any) {
        // Semgrep not installed or exited with error; proceed to high-performance fallback
      }
    }

    // Built-in Fallback Scanner (High-performance regex matcher looking for critical injection, credentials, and XSS vectors)
    try {
      const findings: Array<{
        id: string;
        file: string;
        line: number;
        content: string;
        severity: string;
        description: string;
      }> = [];

      // If it is a file
      const pathStat = await stat(targetPath);
      const filesToScan: string[] = [];

      if (pathStat.isFile()) {
        filesToScan.push(targetPath);
      } else {
        for await (const file of getFilesRecursively(targetPath)) {
          filesToScan.push(file);
        }
      }

      for (const file of filesToScan) {
        const relativeFile = file.replace(workspacePath + "/", "");
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const lineContent = lines[i];

          for (const hotspot of SECURITY_HOTSPOTS) {
            // Reset regex search index just in case
            hotspot.pattern.lastIndex = 0;
            if (hotspot.pattern.test(lineContent)) {
              findings.push({
                id: hotspot.id,
                file: relativeFile,
                line: i + 1,
                content: lineContent.trim(),
                severity: hotspot.severity,
                description: hotspot.description,
              });
            }
          }
        }
      }

      if (findings.length === 0) {
        return `Built-in security static analysis completed: 0 hotspots detected in "${targetInput}".`;
      }

      let report = `Built-in security static analysis found ${findings.length} potential hotspots:\n\n`;
      findings.forEach((finding, index) => {
        report += `[Hotspot #${index + 1}] [${finding.severity}] ID: ${finding.id}\n`;
        report += `Location: ${finding.file}:${finding.line}\n`;
        report += `Description: ${finding.description}\n`;
        report += `Code: \`${finding.content}\`\n`;
        report += `----------------\n\n`;
      });

      report += "Recommendation: Please review the hotspots listed above and apply sanitization or refactoring patterns.";
      return report;
    } catch (err: any) {
      return `Static security analysis failed: ${(err as Error).message}`;
    }
  },
};
