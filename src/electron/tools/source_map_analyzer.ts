import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_CONTEXT_LIMIT = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const PATTERNS = [
  { name: "process.env reference", severity: "medium", regex: "process\\.env" },
  { name: "Vite public env", severity: "medium", regex: "VITE_[A-Z0-9_]+" },
  { name: "Next public env", severity: "medium", regex: "NEXT_PUBLIC_[A-Z0-9_]+" },
  { name: "React public env", severity: "medium", regex: "REACT_APP_[A-Z0-9_]+" },
  { name: "API key label", severity: "high", regex: "API[_-]?KEY" },
  { name: "secret label", severity: "high", regex: "SECRET" },
  { name: "token label", severity: "high", regex: "TOKEN" },
  { name: "password label", severity: "high", regex: "password" },
  { name: "private key marker", severity: "critical", regex: "BEGIN [A-Z ]*PRIVATE KEY" },
  { name: "live secret prefix", severity: "critical", regex: "(sk_live_|gh[pousr]_|xox[baprs]-|AKIA[0-9A-Z]{16})" },
];

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relativePath = relative(workspacePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const redactLine = (line: string) =>
  line
    .replace(/(sk_live_|gh[pousr]_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/g, "$1[redacted]")
    .replace(/(["']?(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'])[^"']{6,}(["'])/gi, "$1[redacted]$2")
    .slice(0, 240);

const inspectSourceMap = async (workspacePath: string, file: string) => {
  if (!file.endsWith(".map")) return "";

  const filePath = resolve(workspacePath, file);
  if (!isInsideWorkspace(workspacePath, filePath)) return "";

  const content = await readFile(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return "source map too large for structural inspection";

  const parsed = JSON.parse(content) as { sources?: string[]; sourcesContent?: string[] };
  const sourceCount = parsed.sources?.length || 0;
  const embeddedSourceCount = parsed.sourcesContent?.length || 0;
  const sourceWarnings = [
    embeddedSourceCount > 0 ? `embeds ${embeddedSourceCount} source file(s)` : "",
    parsed.sources?.some((source) => source.includes("../")) ? "contains parent-directory source paths" : "",
  ].filter(Boolean);

  return `sourceMap: sources=${sourceCount}, sourcesContent=${embeddedSourceCount}${sourceWarnings.length ? `, warnings=${sourceWarnings.join("; ")}` : ""}`;
};

export const sourceMapAnalyzerTool: Tool = {
  name: "source_map_analyzer",
  description:
    "Scans bundles and source maps for leaked public env values, secret markers, embedded source content, and risky source map exposure.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Directory to scan (e.g., "dist", "build", ".next"). Defaults to ".".',
      },
      limit: {
        type: "number",
        description: "Max findings to return. Defaults to 100, capped at 500.",
      },
      contextLimit: {
        type: "number",
        description: "Max matching lines per file. Defaults to 3.",
      },
    },
  },
  async execute(args, { workspacePath }) {
    const targetDir = String(args.path || ".");
    const targetPath = resolve(workspacePath, targetDir);
    const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const contextLimit = toPositiveInteger(args.contextLimit, DEFAULT_CONTEXT_LIMIT, 20);

    if (!isInsideWorkspace(workspacePath, targetPath)) {
      return "Refusing to analyze outside the workspace.";
    }

    const commandArgs = [
      "-n",
      "--no-heading",
      "--ignore-case",
      "--color",
      "never",
      "--type-add",
      "bundle:*.{js,map}",
      "--type",
      "bundle",
    ];

    for (const pattern of PATTERNS) {
      commandArgs.push("-e", pattern.regex);
    }

    commandArgs.push("--glob", "!node_modules/**");
    commandArgs.push("--glob", "!.git/**");
    commandArgs.push("--", targetDir);

    try {
      const { stdout } = await execFileAsync("rg", commandArgs, {
        cwd: workspacePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!stdout.trim()) {
        return "No leaked secrets or suspicious patterns found in bundles.";
      }

      const findings: string[] = [];
      const perFileCounts = new Map<string, number>();
      const files = new Set<string>();

      for (const line of stdout.split("\n").filter(Boolean)) {
        if (findings.length >= limit) break;
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (!match) continue;

        const [, file, lineNumber, code] = match;
        const count = perFileCounts.get(file) || 0;
        if (count >= contextLimit) continue;

        files.add(file);
        perFileCounts.set(file, count + 1);
        const pattern = PATTERNS.find((candidate) => new RegExp(candidate.regex, "i").test(code));
        findings.push(
          `[${(pattern?.severity || "medium").toUpperCase()}] ${file}:${lineNumber} ${pattern?.name || "suspicious bundle content"} | ${redactLine(code.trim())}`
        );
      }

      const mapNotes = (
        await Promise.all([...files].map((file) => inspectSourceMap(workspacePath, file).catch(() => "")))
      ).filter(Boolean);

      return [
        `Source map/bundle analysis: ${findings.length}${findings.length >= limit ? "+" : ""} finding(s) across ${files.size} file(s).`,
        ...findings,
        mapNotes.length > 0 ? `Source map structure:\n${mapNotes.join("\n")}` : "",
        "Fix: remove source maps from public release unless needed, avoid embedding sourcesContent, rotate exposed secrets, and keep only intentionally public env vars in client bundles.",
      ]
        .filter(Boolean)
        .join("\n");
    } catch (error) {
      const execError = error as { code?: number; stdout?: string; message?: string };
      if (execError.code === 1 && !execError.stdout) {
        return "No leaked secrets or suspicious patterns found in bundles.";
      }
      return `Error executing source map analyzer: ${execError.message || "Unknown error"}`;
    }
  },
};
