import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_DEPTH = 5;
const MAX_DEPTH_LIMIT = 12;
const DEFAULT_MAX_MATCHES = 200;
const MAX_MATCHES_LIMIT = 1000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_SINKS = [
  "eval",
  "Function",
  "exec",
  "execFile",
  "spawn",
  "query",
  "execute",
  "innerHTML",
  "outerHTML",
  "dangerouslySetInnerHTML",
  "send",
  "invoke",
  "writeFile",
  "appendFile",
  "fetch",
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relativePath = relative(workspacePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const toStringArray = (value: unknown) => {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
};

const normalizeTerm = (term: string) => term.trim().replace(/^this\./, "");

const getIdentifierFromAssignment = (line: string, term: string) => {
  const escapedTerm = escapeRegex(term);
  const patterns = [
    new RegExp(`\\b(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*.*\\b${escapedTerm}\\b`),
    new RegExp(`\\b([a-zA-Z_$][\\w$]*(?:\\.[a-zA-Z_$][\\w$]*)?)\\s*=\\s*.*\\b${escapedTerm}\\b`),
    new RegExp(`\\b([a-zA-Z_$][\\w$]*)\\s*:\\s*.*\\b${escapedTerm}\\b`),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) return normalizeTerm(match[1]);
  }

  return "";
};

const getCallSink = (line: string, term: string, sinks: string[]) => {
  const escapedTerm = escapeRegex(term);
  for (const sink of sinks) {
    const escapedSink = escapeRegex(sink);
    const callPattern = new RegExp(`\\b${escapedSink}\\s*\\([^\\n]*\\b${escapedTerm}\\b[^\\n]*\\)`);
    const propertyPattern = new RegExp(`\\b${escapedSink}\\s*=\\s*[^\\n]*\\b${escapedTerm}\\b`);
    if (callPattern.test(line) || propertyPattern.test(line)) return sink;
  }
  return "";
};

const getFunctionParamFlow = (line: string, term: string) => {
  const escapedTerm = escapeRegex(term);
  const match = line.match(new RegExp(`\\b([a-zA-Z_$][\\w$]*)\\s*\\([^\\n]*\\b${escapedTerm}\\b[^\\n]*\\)`));
  return match?.[1] || "";
};

export const flowTraceTool: Tool = {
  name: "flow_trace",
  description:
    "Heuristically traces data flow from a source term to aliases, function calls, and risky sinks across workspace files.",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          'The starting variable or parameter name to trace (e.g., "req.body.username").',
      },
      path: {
        type: "string",
        description: "Workspace-relative path to search. Defaults to '.'.",
      },
      maxDepth: {
        type: "number",
        description:
          "Maximum number of assignment steps to trace. Defaults to 5, capped at 12.",
      },
      sinks: {
        type: "array",
        items: { type: "string" },
        description: "Optional sink names/properties to flag. Defaults to common command, SQL, DOM, IPC, file, and network sinks.",
      },
      glob: {
        type: "string",
        description: "Optional ripgrep glob filter, e.g. '**/*.{ts,tsx,js}'.",
      },
      maxMatches: {
        type: "number",
        description: "Max rg matches per term. Defaults to 200, capped at 1000.",
      },
      timeoutMs: {
        type: "number",
        description: "Per-search timeout in milliseconds. Defaults to 20000, capped at 60000.",
      },
    },
    required: ["source"],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const source = String(args.source || "").trim();
    const safeDepth = toPositiveInteger(args.maxDepth, DEFAULT_MAX_DEPTH, MAX_DEPTH_LIMIT);
    const maxMatches = toPositiveInteger(args.maxMatches, DEFAULT_MAX_MATCHES, MAX_MATCHES_LIMIT);
    const timeoutMs = toPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const path = String(args.path || ".");
    const searchPath = resolve(workspacePath, path);
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : undefined;
    const sinks = toStringArray(args.sinks).length > 0 ? toStringArray(args.sinks) : DEFAULT_SINKS;
    let currentTrace = [source];
    const visitedTerms = new Set<string>();
    const visitedEdges = new Set<string>();
    const flowPath: string[] = [];

    if (!source) return "Flow source is required.";
    if (!isInsideWorkspace(workspacePath, searchPath)) return "Refusing to trace outside the workspace.";

    try {
      for (let depth = 0; depth < safeDepth; depth++) {
        const nextTerms: string[] = [];
        for (const term of currentTrace) {
          if (visitedTerms.has(term)) continue;
          visitedTerms.add(term);

          const rgArgs = [
            "-n",
            "--no-heading",
            "--color",
            "never",
            "--fixed-strings",
            "--max-count",
            String(maxMatches),
          ];

          if (glob) rgArgs.push("--glob", glob);
          rgArgs.push("--", term, path);

          const { stdout } = await execFileAsync("rg", rgArgs, {
            cwd: workspacePath,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 * 8,
          });
          const lines = stdout.split("\n").filter(Boolean);

          for (const line of lines) {
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (!match) continue;

            const [, file, lineNumber, code] = match;
            if (/^\s*(import|export)\b/.test(code)) continue;

            const newVar = getIdentifierFromAssignment(code, term);
            if (newVar && !visitedTerms.has(newVar)) {
              const edge = `${term}->${newVar}@${file}:${lineNumber}`;
              if (!visitedEdges.has(edge)) {
                visitedEdges.add(edge);
                nextTerms.push(newVar);
                flowPath.push(
                  `Step ${depth + 1}: ${term} -> ${newVar} via assignment at ${file}:${lineNumber} | ${code.trim()}`,
                );
              }
            }

            const functionName = getFunctionParamFlow(code, term);
            if (functionName && !sinks.includes(functionName)) {
              const edge = `${term}->${functionName}()@${file}:${lineNumber}`;
              if (!visitedEdges.has(edge)) {
                visitedEdges.add(edge);
              flowPath.push(
                  `Step ${depth + 1}: ${term} passed into ${functionName}() at ${file}:${lineNumber} | ${code.trim()}`,
              );
            }
          }

            const sink = getCallSink(code, term, sinks);
            if (sink) {
              const edge = `${term}->${sink}@${file}:${lineNumber}`;
              if (!visitedEdges.has(edge)) {
                visitedEdges.add(edge);
                flowPath.push(
                  `SINK ${depth + 1}: ${term} reaches ${sink} at ${file}:${lineNumber} | ${code.trim()}`,
                );
              }
            }
          }
        }

        if (nextTerms.length === 0) break;
        currentTrace = [...new Set(nextTerms)].slice(0, maxMatches);
      }

      return flowPath.length > 0
        ? `Traced Data Flow for "${source}" (${visitedTerms.size} term(s), depth ${safeDepth}):\n${flowPath.join("\n")}`
        : `No significant data flow paths found for "${source}".`;
    } catch (error) {
      const maybeError = error as { code?: number; stderr?: string; message?: string };
      if (maybeError.code === 1) return `No occurrences found for "${source}".`;
      return `Error tracing data flow for "${source}": ${maybeError.stderr?.trim() || maybeError.message || "Unknown error"}`;
    }
  },
};
