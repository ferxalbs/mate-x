import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_MONTHS_OUT = 6;
const MAX_MONTHS_OUT = 36;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_COMMITS = 1000;

type FileSignal = {
  commits: Set<string>;
  authors: Set<string>;
  insertions: number;
  deletions: number;
  riskyMessages: number;
  latestTimestamp: number;
  touchedInWorkingTree: boolean;
};

const RISKY_MESSAGE_PATTERN =
  /\b(auth|bypass|credential|cve|danger|encrypt|escape|exploit|fix|injection|jwt|oauth|password|permission|privilege|race|rce|secret|security|sql|ssrf|token|vulnerability|xss)\b/i;
const SENSITIVE_PATH_PATTERN =
  /(^|\/)(auth|crypto|security|permission|permissions|policy|policies|secret|secrets|token|tokens|session|sessions|ipc|electron|preload|main|api|server|db|database|migration|migrations|container|docker|kube|k8s)(\/|\.|-|_|$)/i;
const SENSITIVE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|rs|go|py|rb|java|kt|cs|php|sql|ya?ml|json|toml|env|dockerfile)$/i;
const GENERATED_OR_LOW_SIGNAL_PATTERN =
  /(^|\/)(node_modules|dist|out|coverage|target|\.next|\.git)\/|(\.lock|\.map|\.d\.ts|package-lock\.json|pnpm-lock\.yaml|bun\.lock|yarn\.lock)$/i;

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const parseNumstatValue = (value: string) => (value === "-" ? 0 : Number(value) || 0);

const getSignal = (signals: Map<string, FileSignal>, file: string) => {
  const existing = signals.get(file);
  if (existing) return existing;

  const signal: FileSignal = {
    commits: new Set(),
    authors: new Set(),
    insertions: 0,
    deletions: 0,
    riskyMessages: 0,
    latestTimestamp: 0,
    touchedInWorkingTree: false,
  };
  signals.set(file, signal);
  return signal;
};

const riskLabel = (score: number) => {
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
};

const safeText = (value: string) => value.replace(/\s+/g, " ").trim();

const scoreFile = (file: string, signal: FileSignal, now: number) => {
  const churn = signal.insertions + signal.deletions;
  const ageDays = signal.latestTimestamp > 0 ? (now - signal.latestTimestamp) / 86_400_000 : 999;
  const recencyScore = Math.max(0, 18 - Math.floor(ageDays / 7));
  const sensitivePathScore = SENSITIVE_PATH_PATTERN.test(file) ? 22 : 0;
  const sensitiveExtensionScore = SENSITIVE_EXTENSION_PATTERN.test(file) ? 8 : 0;
  const workingTreeScore = signal.touchedInWorkingTree ? 18 : 0;
  const score =
    signal.commits.size * 6 +
    Math.min(24, Math.floor(churn / 40)) +
    Math.min(16, signal.authors.size * 4) +
    Math.min(18, signal.riskyMessages * 6) +
    recencyScore +
    sensitivePathScore +
    sensitiveExtensionScore +
    workingTreeScore;

  return { score, churn, ageDays };
};

const parseLog = (stdout: string, signals: Map<string, FileSignal>) => {
  let currentCommit = "";
  let currentAuthor = "";
  let currentTimestamp = 0;
  let currentRiskyMessage = false;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith("__COMMIT__")) {
      const [, hash = "", timestamp = "0", author = "", subject = ""] = line.split("\t");
      currentCommit = hash;
      currentTimestamp = Number(timestamp) * 1000;
      currentAuthor = author;
      currentRiskyMessage = RISKY_MESSAGE_PATTERN.test(subject);
      continue;
    }

    const [insertionsRaw, deletionsRaw, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t");
    if (!file || GENERATED_OR_LOW_SIGNAL_PATTERN.test(file)) continue;

    const signal = getSignal(signals, file);
    signal.commits.add(currentCommit);
    if (currentAuthor) signal.authors.add(currentAuthor);
    signal.insertions += parseNumstatValue(insertionsRaw || "0");
    signal.deletions += parseNumstatValue(deletionsRaw || "0");
    if (currentRiskyMessage) signal.riskyMessages += 1;
    signal.latestTimestamp = Math.max(signal.latestTimestamp, currentTimestamp);
  }
};

const parseWorkingTree = (stdout: string, signals: Map<string, FileSignal>) => {
  for (const rawLine of stdout.split("\n")) {
    const file = rawLine.slice(3).trim();
    if (!file || GENERATED_OR_LOW_SIGNAL_PATTERN.test(file)) continue;
    getSignal(signals, file).touchedInWorkingTree = true;
  }
};

export const gitForensicsTool: Tool = {
  name: "git_forensics",
  description:
    "Analyzes git history to compute file churn and identify risk hotspots. Files that change most often are statistically the highest risk for vulnerabilities.",
  parameters: {
    type: "object",
    properties: {
      monthsOut: {
        type: "number",
        description: "Number of months of git history to analyze. Defaults to 6, capped at 36.",
      },
      limit: {
        type: "number",
        description: "Number of hotspot files to return. Defaults to 10, capped at 50.",
      },
      includeWorkingTree: {
        type: "boolean",
        description: "Include currently modified/untracked files as extra risk signal. Defaults to true.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const monthsOut = toPositiveInteger(args.monthsOut, DEFAULT_MONTHS_OUT, MAX_MONTHS_OUT);
    const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const includeWorkingTree = args.includeWorkingTree !== false;

    try {
      const sinceDate = new Date();
      sinceDate.setMonth(sinceDate.getMonth() - monthsOut);
      const sinceStr = sinceDate.toISOString().split("T")[0];

      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `--since=${sinceStr}`,
          `--max-count=${MAX_COMMITS}`,
          "--numstat",
          "--date-order",
          "--pretty=format:__COMMIT__%H%x09%ct%x09%an%x09%s",
          "--",
        ],
        { cwd: workspacePath, maxBuffer: 1024 * 1024 * 10 }
      );

      const signals = new Map<string, FileSignal>();
      parseLog(stdout, signals);

      if (includeWorkingTree) {
        try {
          const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: workspacePath });
          parseWorkingTree(status.stdout, signals);
        } catch {
          // History signal still useful when status unavailable.
        }
      }

      if (signals.size === 0) return "No useful git history or working tree signals found in that range.";

      const now = Date.now();
      const sortedHotspots = [...signals.entries()]
        .map(([file, signal]) => {
          const scored = scoreFile(file, signal, now);
          return { file, signal, ...scored };
        })
        .sort((a, b) => b.score - a.score || b.signal.commits.size - a.signal.commits.size || b.churn - a.churn)
        .slice(0, limit);

      if (sortedHotspots.length === 0) return "No valid code files identified in history.";

      let report = `Git Forensics Risk Report (last ${monthsOut} month(s), ${signals.size} file signal(s)):\n`;
      report += "Risk blends churn, recency, author spread, risky commit keywords, sensitive paths, and dirty working tree state.\n\n";

      sortedHotspots.forEach(({ file, signal, score, churn, ageDays }, index) => {
        const reasons = [
          `${signal.commits.size} commit(s)`,
          `${churn} line churn`,
          `${signal.authors.size} author(s)`,
          `${Math.max(0, Math.floor(ageDays))}d since last touch`,
        ];
        if (signal.riskyMessages > 0) reasons.push(`${signal.riskyMessages} risky message(s)`);
        if (SENSITIVE_PATH_PATTERN.test(file)) reasons.push("sensitive path");
        if (signal.touchedInWorkingTree) reasons.push("working tree modified");

        report += `${index + 1}. [${riskLabel(score).toUpperCase()} ${score}] ${file}\n`;
        report += `   signals: ${safeText(reasons.join(", "))}\n`;
      });

      report += "\nUse top files first for focused security review, ownership review, and regression tests.\n";
      return report;
    } catch (error) {
      const maybeError = error as { stderr?: string; message?: string };
      return `git_forensics failed: ${maybeError.stderr?.trim() || maybeError.message || "Unknown error"}. Is this a git repository?`;
    }
  },
};
