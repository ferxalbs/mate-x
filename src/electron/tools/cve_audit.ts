import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 1024 * 1024 * 8;

type PackageManager = "auto" | "bun" | "npm" | "pnpm" | "yarn";

type AuditCommand = {
  manager: Exclude<PackageManager, "auto">;
  args: string[];
  json: boolean;
};

type Vulnerability = {
  severity: string;
  name: string;
  title: string;
  via: string;
  range?: string;
  fix?: string;
  url?: string;
};

const LOCKFILES: Array<{ file: string; manager: Exclude<PackageManager, "auto"> }> = [
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
  { file: "npm-shrinkwrap.json", manager: "npm" },
  { file: "yarn.lock", manager: "yarn" },
];

const SEVERITY_ORDER = ["critical", "high", "moderate", "medium", "low", "info", "unknown"];

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relativePath = relative(workspacePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const detectPackageManagers = async (workspacePath: string) => {
  const detected: Array<Exclude<PackageManager, "auto">> = [];

  for (const lockfile of LOCKFILES) {
    if (await fileExists(resolve(workspacePath, lockfile.file))) {
      if (!detected.includes(lockfile.manager)) detected.push(lockfile.manager);
    }
  }

  if ((await fileExists(resolve(workspacePath, "package.json"))) && detected.length === 0) {
    detected.push("npm");
  }

  return detected;
};

const getAuditCommand = (manager: Exclude<PackageManager, "auto">): AuditCommand => {
  if (manager === "npm") return { manager, args: ["audit", "--json"], json: true };
  if (manager === "pnpm") return { manager, args: ["audit", "--json"], json: true };
  if (manager === "yarn") return { manager, args: ["npm", "audit", "--json"], json: true };
  return { manager, args: ["audit"], json: false };
};

const normalizeSeverity = (severity: unknown) => {
  const normalized = String(severity || "unknown").toLowerCase();
  return normalized === "moderate" ? "medium" : normalized;
};

const summarizeCounts = (vulnerabilities: Vulnerability[]) => {
  const counts = new Map<string, number>();
  for (const vulnerability of vulnerabilities) {
    const severity = normalizeSeverity(vulnerability.severity);
    counts.set(severity, (counts.get(severity) || 0) + 1);
  }

  return SEVERITY_ORDER.map((severity) => {
    const normalized = normalizeSeverity(severity);
    const count = counts.get(normalized);
    return count ? `${normalized}:${count}` : "";
  })
    .filter(Boolean)
    .join(", ");
};

const stringifyVia = (via: unknown) => {
  if (typeof via === "string") return via;
  if (Array.isArray(via)) {
    return via
      .map((item) => (typeof item === "string" ? item : (item as { name?: string; title?: string })?.name || (item as { title?: string })?.title))
      .filter(Boolean)
      .join(", ");
  }
  return "";
};

const parseNpmLikeAudit = (raw: string) => {
  const parsed = JSON.parse(raw) as {
    vulnerabilities?: Record<
      string,
      {
        name?: string;
        severity?: string;
        via?: unknown;
        range?: string;
        fixAvailable?: boolean | { name?: string; version?: string };
      }
    >;
    advisories?: Record<
      string,
      {
        module_name?: string;
        severity?: string;
        title?: string;
        vulnerable_versions?: string;
        recommendation?: string;
        url?: string;
      }
    >;
  };

  if (parsed.vulnerabilities) {
    return Object.entries(parsed.vulnerabilities).map(([name, vulnerability]) => {
      const fix =
        typeof vulnerability.fixAvailable === "object"
          ? `${vulnerability.fixAvailable.name || name}@${vulnerability.fixAvailable.version || "fixed"}`
          : vulnerability.fixAvailable
            ? "fix available"
            : "no direct fix reported";

      return {
        severity: normalizeSeverity(vulnerability.severity),
        name: vulnerability.name || name,
        title: stringifyVia(vulnerability.via) || "dependency advisory",
        via: stringifyVia(vulnerability.via),
        range: vulnerability.range,
        fix,
      };
    });
  }

  if (parsed.advisories) {
    return Object.values(parsed.advisories).map((advisory) => ({
      severity: normalizeSeverity(advisory.severity),
      name: advisory.module_name || "unknown",
      title: advisory.title || "dependency advisory",
      via: advisory.recommendation || "",
      range: advisory.vulnerable_versions,
      fix: advisory.recommendation,
      url: advisory.url,
    }));
  }

  return [];
};

const formatVulnerabilities = (manager: string, vulnerabilities: Vulnerability[], limit: number) => {
  const sorted = vulnerabilities.sort(
    (a, b) => SEVERITY_ORDER.indexOf(normalizeSeverity(a.severity)) - SEVERITY_ORDER.indexOf(normalizeSeverity(b.severity))
  );
  const visible = sorted.slice(0, limit);
  const lines = visible.map((vulnerability, index) => {
    const details = [
      `${index + 1}. [${normalizeSeverity(vulnerability.severity).toUpperCase()}] ${vulnerability.name}`,
      vulnerability.title ? `title: ${vulnerability.title}` : "",
      vulnerability.range ? `range: ${vulnerability.range}` : "",
      vulnerability.fix ? `fix: ${vulnerability.fix}` : "",
      vulnerability.url ? `url: ${vulnerability.url}` : "",
    ].filter(Boolean);

    return details.join(" | ");
  });

  return [
    `${manager}: ${vulnerabilities.length} vulnerable package(s) (${summarizeCounts(vulnerabilities) || "no severity counts"})`,
    ...lines,
    sorted.length > limit ? `... truncated ${sorted.length - limit} more finding(s)` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const looksClean = (stdout: string) =>
  /0 vulnerabilities found|No vulnerabilities found|found 0 vulnerabilities|No known vulnerabilities/i.test(stdout);

export const cveAuditTool: Tool = {
  name: "cve_audit",
  description:
    "Audits dependency CVEs across Bun, npm, pnpm, and Yarn projects. Detects lockfiles, runs available package manager audits, and returns normalized severity/fix summaries.",
  parameters: {
    type: "object",
    properties: {
      packageManager: {
        type: "string",
        enum: ["auto", "bun", "npm", "pnpm", "yarn"],
        description: "Package manager to use. Defaults to auto-detect from lockfiles.",
      },
      path: {
        type: "string",
        description: "Workspace-relative package directory to audit. Defaults to '.'.",
      },
      limit: {
        type: "number",
        description: "Max normalized findings per package manager. Defaults to 25, capped at 100.",
      },
      timeoutMs: {
        type: "number",
        description: "Per-audit timeout in milliseconds. Defaults to 60000, capped at 180000.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const packageManager = (args.packageManager || "auto") as PackageManager;
    const relativePath = String(args.path || ".");
    const auditPath = resolve(workspacePath, relativePath);
    const limit = toPositiveInteger(args.limit, 25, 100);
    const timeoutMs = toPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    if (!isInsideWorkspace(workspacePath, auditPath)) {
      return "Refusing to audit outside the workspace.";
    }

    try {
      const managers =
        packageManager === "auto" ? await detectPackageManagers(auditPath) : [packageManager as Exclude<PackageManager, "auto">];

      if (managers.length === 0) {
        return "No supported package manifest or lockfile found for CVE audit.";
      }

      const reports: string[] = [];
      const failures: string[] = [];

      for (const manager of managers) {
        const command = getAuditCommand(manager);
        let stdout = "";
        let stderr = "";

        try {
          const result = await execFileAsync(manager, command.args, {
            cwd: auditPath,
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_BYTES,
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          const execError = error as { stdout?: string; stderr?: string; message?: string };
          stdout = execError.stdout || "";
          stderr = execError.stderr || "";

          if (!stdout.trim()) {
            failures.push(`${manager}: ${stderr.trim() || execError.message || "audit command failed"}`);
            continue;
          }
        }

        if (looksClean(stdout)) {
          reports.push(`${manager}: no known vulnerabilities found.`);
          continue;
        }

        if (command.json) {
          try {
            const vulnerabilities = parseNpmLikeAudit(stdout);
            reports.push(
              vulnerabilities.length > 0
                ? formatVulnerabilities(manager, vulnerabilities, limit)
                : `${manager}: audit returned JSON but no normalized vulnerabilities were found. Raw output:\n${stdout.slice(0, 4000)}`
            );
            continue;
          } catch {
            reports.push(`${manager}: audit output was not parseable JSON. Raw output:\n${stdout.slice(0, 4000)}`);
            continue;
          }
        }

        reports.push(`${manager}: raw audit output\n${stdout.slice(0, 6000)}${stdout.length > 6000 ? "\n... truncated raw output" : ""}`);

        if (stderr.trim()) {
          failures.push(`${manager} stderr: ${stderr.trim()}`);
        }
      }

      const report = [
        `CVE Supply Chain Audit Report (${managers.join(", ")})`,
        "================================================",
        ...reports,
        failures.length > 0 ? `\nAudit command warnings/errors:\n${failures.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return report;
    } catch (error) {
      return `Error generating CVE audit: ${(error as Error).message}`;
    }
  },
};
