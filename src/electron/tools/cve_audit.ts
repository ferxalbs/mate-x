import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);

export const cveAuditTool: Tool = {
  name: "cve_audit",
  description:
    "Queries local package managers to find exact CVE vulnerabilities in the dependency tree and provides upgrade paths.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, { workspacePath }) {
    try {
      // First, check if bun is available (since this repo uses Bun)
      let stdout;
      try {
        const result = await execFileAsync("bun", ["audit"], { cwd: workspacePath });
        stdout = result.stdout;
      } catch (err) {
        // Many audit failures return a non-zero exit code if vulns are found.
        stdout = (err as { stdout?: string }).stdout || "";
        
        if (!stdout) {
           return "Error: Could not execute 'bun audit'. Ensure package manager is available.";
        }
      }

      if (stdout.includes("0 vulnerabilities found") || stdout.includes("No vulnerabilities found")) {
        return "CVE Supply Chain Audit: No known vulnerabilities found in the dependency tree.";
      }

      // We just pass the raw output back, as Bun formats it nicely
      // (or we could parse npm audit --json if using npm)
      let report = `CVE Supply Chain Audit Report\\n===============================\\n`;
      report += stdout;
      
      return report;

    } catch (error) {
      return `Error generating CVE audit: ${(error as Error).message}`;
    }
  },
};
