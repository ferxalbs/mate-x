import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../tool-service";

export const threatModelTool: Tool = {
  name: "threat_model",
  description:
    "Assembles architectural data to generate a high-level STRIDE threat model of the system.",
  parameters: {
    type: "object",
    properties: {}, // No params needed, scans generically
    required: [],
  },
  async execute(args, { workspacePath, settings }) {
    const findings = {
      Spoofing: [] as string[],
      Tampering: [] as string[],
      Repudiation: [] as string[],
      InformationDisclosure: [] as string[],
      DenialOfService: [] as string[],
      ElevationOfPrivilege: [] as string[],
    };

    try {
      // Analyze Package.json to infer architecture components
      const pkgPath = join(workspacePath, "package.json");
      let hasApi = false;
      let hasDb = false;
      let hasUi = false;

      try {
        await access(pkgPath);
        const pkgContent = await readFile(pkgPath, "utf8");
        const pkg = JSON.parse(pkgContent);
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        const depsStr = JSON.stringify(deps);

        if (
          depsStr.includes("express") ||
          depsStr.includes("fastify") ||
          depsStr.includes("koa")
        )
          hasApi = true;
        if (
          depsStr.includes("pg") ||
          depsStr.includes("mysql") ||
          depsStr.includes("mongoose") ||
          depsStr.includes("prisma")
        )
          hasDb = true;
        if (
          depsStr.includes("react") ||
          depsStr.includes("vue") ||
          depsStr.includes("svelte")
        )
          hasUi = true;
      } catch (_e) {
        // missing package.json, ignore
      }

      // Populate STRIDE
      if (hasApi) {
        findings.Spoofing.push(
          "API boundaries susceptible to spoofing without strict JWT/Session verification.",
        );
        findings.ElevationOfPrivilege.push(
          "API roles (User vs Admin) might allow horizontal/vertical privilege escalation (BOLA/IDOR).",
        );
        findings.DenialOfService.push(
          "API endpoints without rate-limiting are vulnerable to Layer 7 DoS.",
        );
      }

      if (hasDb) {
        findings.Tampering.push(
          "Database layer vulnerable to SQL/NoSQL injection if ORM is bypassed (Parameter tampering).",
        );
        findings.InformationDisclosure.push(
          "Unencrypted PII in database could be exposed in physical breaches or SQLi.",
        );
      }

      if (hasUi) {
        findings.Spoofing.push(
          "Frontend susceptible to CSRF if authentication cookies are loosely configured (SameSite).",
        );
        findings.InformationDisclosure.push(
          "Client-side state might leak sensitive keys or tokens (XSS).",
        );
      }

      // Add generic heuristics if not clearly identified
      if (!hasApi && !hasDb && !hasUi) {
        findings.Spoofing.push(
          "Ensure all components have strict mutual authentication if microservices exist.",
        );
        findings.InformationDisclosure.push(
          "Verify sensitive keys are handled outside codebase and injected via environment variables.",
        );
      }

      findings.Repudiation.push(
        "Lack of standard audit-logging for critical actions (money transfer, admin changes) prevents attribution.",
      );
      findings.Tampering.push(
        "Supply chain dependencies must be locked down (Dependabot/Snyk) to prevent dependency confusion attacks.",
      );

      let report = `Automated STRIDE Threat Model\\n===============================\\n`;
      report += `Context: ${hasApi ? "[API] " : ""}${hasDb ? "[Database] " : ""}${hasUi ? "[Frontend UI] " : ""}\\n\\n`;

      Object.entries(findings).forEach(([category, items]) => {
        report += `[${category}]\\n`;
        items.forEach((item) => {
          report += `- ${item}\\n`;
        });
        report += `\\n`;
      });

      return report;
    } catch (error) {
      return `Error generating threat model: ${(error as Error).message}`;
    }
  },
};
