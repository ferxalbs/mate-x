import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_ONNX_MAX_FILES = 50;
const MAX_ONNX_FILES = 300;
const ONNX_CHUNK_SIZE = 12_000;
const ONNX_CHUNK_OVERLAP = 500;
const SKIP_PATH_PATTERN =
  /(^|\/)(node_modules|\.git|dist|out|coverage|target|\.next)(\/|$)|(\.lock|\.map|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.ico|\.pdf|\.zip|\.tar|\.gz)$/i;
const SECRET_CONTEXT_PATTERN =
  /\b(api[_-]?key|auth|bearer|client[_-]?secret|connection[_-]?string|credential|database[_-]?url|db[_-]?url|jwt|password|private[_-]?key|secret|session|token|webhook)\b/i;
const HIGH_ENTROPY_TOKEN_PATTERN = /[A-Za-z0-9_./+=-]{24,}/g;
const PLACEHOLDER_PATTERN =
  /^(changeme|example|fake|placeholder|sample|test|todo|xxx+|your[_-]?(key|secret|token)|<[^>]+>)$/i;
const ML_SECRET_LABELS = new Set([
  "secret",
  "api_key",
  "auth_token",
  "session_cookie",
  "database_uri",
  "cloud_credential",
  "repo_secret",
  "payment_token",
  "prompt_sensitive",
]);
let transformersPipelinePromise: Promise<any> | null = null;

const SECRET_PATTERNS = [
  { name: "AWS Access Key", severity: "critical", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Key", severity: "critical", regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g },
  { name: "GitHub Token", severity: "critical", regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g },
  { name: "OpenAI API Key", severity: "critical", regex: /sk-[A-Za-z0-9_-]{32,}/g },
  { name: "Rainy API Key", severity: "critical", regex: /ra-[A-Za-z0-9]{32,}/g },
  {
    name: "Generic API Key",
    severity: "high",
    regex:
      /"?[a-zA-Z0-9_-]*[aA][pP][iI]_[kK][eE][yY]"?[ :]+['"]([a-zA-Z0-9_-]{16,})['"]/g,
  },
  {
    name: "Generic Secret",
    severity: "high",
    regex:
      /"?[a-zA-Z0-9_-]*[sS][eE][cC][rR][eE][tT]"?[ :]+['"]([a-zA-Z0-9_-]{16,})['"]/g,
  },
  { name: "JWT", severity: "medium", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "Private Key", severity: "critical", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Slack Token", severity: "critical", regex: /xox[baprs]-[0-9a-zA-Z-]{10,80}/g },
  { name: "Stripe API Key", severity: "critical", regex: /sk_live_[0-9a-zA-Z]{24,}/g },
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

const shannonEntropy = (value: string) => {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
};

const isLikelyPlaceholder = (value: string) => PLACEHOLDER_PATTERN.test(value.trim());

const isHighEntropyCandidate = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length >= 24 && !isLikelyPlaceholder(trimmed) && shannonEntropy(trimmed) >= 3.7;
};

const redact = (value: string) => {
  const clean = value.trim();
  if (clean.length <= 12) return "[redacted]";
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
};

const getLineNumber = (content: string, index = 0) => content.slice(0, index).split("\n").length;

const onnxSeverity = (risk: string) => {
  if (risk === "p0") return "critical";
  if (risk === "p1") return "high";
  return "medium";
};

const shouldReportOnnxSpan = (label: string) =>
  ML_SECRET_LABELS.has(label);

const shouldRunMlScan = (file: string, content: string) => {
  if (/\.(md|mdx|txt|csv|svg|html|css)$/i.test(file) && !SECRET_CONTEXT_PATTERN.test(content)) {
    return false;
  }

  if (SECRET_CONTEXT_PATTERN.test(file) || SECRET_CONTEXT_PATTERN.test(content)) return true;

  for (const match of content.matchAll(HIGH_ENTROPY_TOKEN_PATTERN)) {
    if (isHighEntropyCandidate(match[0])) return true;
  }

  return false;
};

const dedupeFindings = (findings: string[]) => [...new Set(findings)];

const scanContentWithTransformers = async (
  file: string,
  content: string,
  minConfidence: number,
  limit: number,
) => {
  const findings: string[] = [];

  try {
    const { loadPrivacyModelStatus } = await import("../privacy/privacy-model-loader");
    const status = await loadPrivacyModelStatus();
    if (!status.loaded) {
      return {
        findings,
        modelStatus: `${status.model}:${status.source}`,
        modelError: "MaTE X Privacy ONNX assets missing.",
      };
    }

    transformersPipelinePromise ??= import("@huggingface/transformers").then(async (transformers: any) => {
      if (transformers.env) {
        transformers.env.allowRemoteModels = false;
        transformers.env.allowLocalModels = true;
        transformers.env.localModelPath = status.assetPath;
      }

      return transformers.pipeline("token-classification", status.assetPath, {
        local_files_only: true,
        aggregation_strategy: "simple",
      });
    });

    const classifier = await transformersPipelinePromise;
    for (let offset = 0; offset < content.length && findings.length < limit; offset += ONNX_CHUNK_SIZE - ONNX_CHUNK_OVERLAP) {
      const chunk = content.slice(offset, offset + ONNX_CHUNK_SIZE);
      const spans = (await classifier(chunk)) as Array<{
        entity_group?: string;
        entity?: string;
        score?: number;
        word?: string;
        start?: number;
      }>;

      for (const span of spans) {
        if (findings.length >= limit) break;
        const rawLabel = String(span.entity_group || span.entity || "").replace(/^[BIES]-/, "");
        const label = rawLabel === "agent_memory_sensitive" ? "prompt_sensitive" : rawLabel;
        const confidence = Number(span.score || 0);
        const text = String(span.word || "").replace(/\s+/g, " ").trim();
        if (!ML_SECRET_LABELS.has(label) || confidence < minConfidence || !text) continue;

        const absoluteStart = offset + Number(span.start || 0);
        findings.push(
          `[CRITICAL] Transformers.js ${label} in ${file}:${getLineNumber(content, absoluteStart)} evidence=${redact(text)} confidence=${confidence.toFixed(2)} model=${status.model}:${status.source}`,
        );
      }

      if (chunk.length < ONNX_CHUNK_SIZE) break;
    }

    return { findings, modelStatus: `${status.model}:${status.source}`, modelError: "" };
  } catch (error) {
    return {
      findings,
      modelStatus: "",
      modelError: error instanceof Error ? error.message : "Transformers.js inference unavailable.",
    };
  }
};

const scanContentWithOnnx = async (
  file: string,
  content: string,
  minConfidence: number,
  limit: number,
) => {
  const findings: string[] = [];
  let modelStatus = "";
  let modelError = "";
  const { scanWithOnnx } = await import("../privacy/privacy-onnx-scanner");

  for (let offset = 0; offset < content.length && findings.length < limit; offset += ONNX_CHUNK_SIZE - ONNX_CHUNK_OVERLAP) {
    const chunk = content.slice(offset, offset + ONNX_CHUNK_SIZE);
    const result = await scanWithOnnx(chunk);
    modelStatus = `${result.status.model}:${result.status.source}`;
    if (result.error) modelError = result.error;

    for (const span of result.spans) {
      if (findings.length >= limit) break;
      if (span.confidence < minConfidence || !shouldReportOnnxSpan(span.label)) continue;

      const absoluteStart = offset + span.start;
      findings.push(
        `[${onnxSeverity(span.risk).toUpperCase()}] ONNX ${span.label} in ${file}:${getLineNumber(content, absoluteStart)} evidence=${redact(span.text)} confidence=${span.confidence.toFixed(2)} model=${modelStatus}`,
      );
    }

    if (chunk.length < ONNX_CHUNK_SIZE) break;
  }

  return { findings, modelStatus, modelError };
};

export const secretScanTool: Tool = {
  name: "secret_scan",
  description:
    "Scans workspace files for hardcoded secrets with redacted evidence, severity, entropy checks, path guards, and result caps.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'The directory or file to scan (relative to workspace root). Defaults to ".".',
      },
      limit: {
        type: "number",
        description: "Max findings to return. Defaults to 100, capped at 500.",
      },
      includeGenerated: {
        type: "boolean",
        description: "Include generated/build outputs normally skipped. Defaults to false.",
      },
      maxFileBytes: {
        type: "number",
        description: "Max file size to read. Defaults to 1MB, capped at 5MB.",
      },
      useOnnx: {
        type: "boolean",
        description: "Use optional MaTE X Privacy model for semantic secret detection. Defaults to true.",
      },
      mlBackend: {
        type: "string",
        enum: ["transformers", "onnx", "off"],
        description: "ML backend for optional semantic scan. Defaults to transformers; falls back gracefully.",
      },
      onnxMinConfidence: {
        type: "number",
        description: "Minimum ML span confidence. Defaults to 0.72.",
      },
      onnxMaxFiles: {
        type: "number",
        description: "Max files to scan with ONNX after regex checks. Defaults to 50, capped at 300.",
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const relativePath = String(args.path || ".");
    const targetPath = resolve(workspacePath, relativePath);
    const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const maxFileBytes = toPositiveInteger(args.maxFileBytes, DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES);
    const useOnnx = args.useOnnx !== false;
    const mlBackend = args.mlBackend === "onnx" || args.mlBackend === "off" ? args.mlBackend : "transformers";
    const onnxMinConfidence = Math.max(0.1, Math.min(0.99, Number(args.onnxMinConfidence) || 0.72));
    const onnxMaxFiles = toPositiveInteger(args.onnxMaxFiles, DEFAULT_ONNX_MAX_FILES, MAX_ONNX_FILES);

    if (!isInsideWorkspace(workspacePath, targetPath)) {
      return "Refusing to scan outside the workspace.";
    }

    try {
      // Use rg to find potential files first to be efficient
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync(
        "rg",
        ["--files", "--color", "never", "--", relativePath],
        { cwd: workspacePath },
      );
      const files = stdout.split("\n").filter(Boolean);
      const results: string[] = [];
      const modelNotes = new Set<string>();
      let onnxFilesScanned = 0;

      for (const file of files) {
        if (results.length >= limit) break;
        if (!args.includeGenerated && SKIP_PATH_PATTERN.test(file)) continue;

        try {
          const filePath = resolve(workspacePath, file);
          if (!isInsideWorkspace(workspacePath, filePath)) continue;

          const content = await readFile(join(workspacePath, file), "utf8");
          if (Buffer.byteLength(content, "utf8") > maxFileBytes) continue;

          const fileResults: string[] = [];
          for (const pattern of SECRET_PATTERNS) {
            for (const match of content.matchAll(pattern.regex)) {
              const value = match[1] || match[0] || "";
              const entropy = value.length > 0 ? shannonEntropy(value) : 0;
              if (isLikelyPlaceholder(value)) continue;
              if ((pattern.name === "AWS Secret Key" || pattern.name.startsWith("Generic")) && entropy < 4.0) continue;

              fileResults.push(
                `[${pattern.severity.toUpperCase()}] ${pattern.name} in ${file}:${getLineNumber(content, match.index)} evidence=${redact(value)} entropy=${entropy.toFixed(2)}`,
              );
              if (fileResults.length >= limit) break;
            }
            if (fileResults.length >= limit) break;
          }

          if (useOnnx && mlBackend !== "off" && onnxFilesScanned < onnxMaxFiles && fileResults.length < limit && shouldRunMlScan(file, content)) {
            onnxFilesScanned += 1;
            const ml =
              mlBackend === "onnx"
                ? await scanContentWithOnnx(file, content, onnxMinConfidence, limit - fileResults.length)
                : await scanContentWithTransformers(file, content, onnxMinConfidence, limit - fileResults.length);
            fileResults.push(...ml.findings);
            if (ml.modelStatus) modelNotes.add(`ML model=${ml.modelStatus} backend=${mlBackend}`);
            if (ml.modelError) modelNotes.add(`ML warning=${ml.modelError}`);
          }

          results.push(...dedupeFindings(fileResults));
        } catch {
          continue;
        }
      }
      const visible = results.slice(0, limit);

      return visible.length > 0
        ? `Secret scan complete. Found ${visible.length}${results.length > limit ? "+" : ""} potential secret(s):\n${[...modelNotes].join("\n")}${modelNotes.size ? "\n" : ""}${visible.join("\n")}`
        : `Scan complete. No secrets found.${modelNotes.size ? `\n${[...modelNotes].join("\n")}` : ""}`;
    } catch (error) {
      return `Error scanning for secrets: ${(error as Error).message}`;
    }
  },
};
