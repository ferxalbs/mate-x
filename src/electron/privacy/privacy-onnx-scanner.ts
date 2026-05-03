import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PrivacyModelStatus } from "../../contracts/privacy";
import type { PrivacyLabel, PrivacyRisk, PrivacySpan } from "./privacy-types";
import { hashSensitiveText } from "./privacy-redactor";
import { loadPrivacyModelStatus } from "./privacy-model-loader";

export interface PrivacyOnnxScanResult {
  spans: PrivacySpan[];
  status: PrivacyModelStatus;
  error?: string;
}

type TiktokenModule = typeof import("js-tiktoken");

interface PrivacyModelConfig {
  encoding?: string;
  ner_class_names?: string[];
}

interface TokenOffset {
  token: number;
  start: number;
  end: number;
}

let sessionPromise: Promise<{ ort: any; session: any }> | null = null;
let tokenizerPromise: Promise<ReturnType<TiktokenModule["getEncoding"]>> | null = null;
let configPromise: Promise<PrivacyModelConfig> | null = null;

export async function scanWithOnnx(text: string): Promise<PrivacyOnnxScanResult> {
  const status = await loadPrivacyModelStatus();

  if (!status.loaded) {
    return {
      spans: [],
      status,
      error: "MaTE X Privacy v0.15 ONNX assets missing.",
    };
  }

  try {
    const [runtime, tokenizer, config] = await Promise.all([
      loadSession(status.assetPath),
      loadTokenizer(status.assetPath),
      loadConfig(status.assetPath),
    ]);
    const labels = config.ner_class_names ?? [];
    const tokenOffsets = encodeWithOffsets(tokenizer, text).slice(0, 4096);

    if (tokenOffsets.length === 0 || labels.length === 0) {
      return { spans: [], status };
    }

    const { ort, session } = runtime;
    const dims = [1, tokenOffsets.length];
    const feeds = {
      input_ids: new ort.Tensor(
        "int64",
        BigInt64Array.from(tokenOffsets.map((item) => BigInt(item.token))),
        dims,
      ),
      attention_mask: new ort.Tensor("bool", Uint8Array.from(tokenOffsets.map(() => 1)), dims),
    };
    const output = await session.run(feeds);
    const logits = Object.values(output)[0] as
      | { data?: Float32Array | number[]; dims?: number[] }
      | undefined;

    if (!logits?.data || typeof logits.dims?.[2] !== "number") {
      return { spans: [], status, error: "MaTE X Privacy ONNX output is missing logits." };
    }

    const predicted = decodeTokenPredictions(
      logits.data as Float32Array | number[],
      logits.dims[1],
      logits.dims[2],
      labels,
    );

    return {
      spans: spansFromPredictions(text, tokenOffsets, predicted),
      status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MaTE X Privacy ONNX inference failed.";
    return {
      spans: [],
      status: { ...status, inferenceReady: false, inferenceError: message },
      error: message,
    };
  }
}

async function loadSession(assetPath: string) {
  sessionPromise ??= loadOrtRuntime().then(async (ort) => {
    if (ort.kind === "node") {
      return {
        ort: ort.module,
        session: await ort.module.InferenceSession.create(path.join(assetPath, "model.onnx"), {
          executionProviders: ["cpu"],
          graphOptimizationLevel: "all",
        }),
      };
    }

    const [modelBytes, dataBytes] = await Promise.all([
      readFile(path.join(assetPath, "model.onnx")),
      readFile(path.join(assetPath, "model.onnx.data")).catch(() => null),
    ]);
    return {
      ort: ort.module,
      session: await ort.module.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        externalData: dataBytes ? [{ path: "model.onnx.data", data: dataBytes }] : undefined,
      } as any),
    };
  });
  return sessionPromise;
}

async function loadOrtRuntime(): Promise<{ kind: "node" | "web"; module: any }> {
  try {
    return { kind: "node", module: await import("onnxruntime-node") };
  } catch {
    return { kind: "web", module: await import("onnxruntime-web") };
  }
}

async function loadTokenizer(assetPath: string) {
  tokenizerPromise ??= Promise.all([import("js-tiktoken"), loadConfig(assetPath)]).then(
    ([tiktoken, config]) =>
      tiktoken.getEncoding((config.encoding ?? "o200k_base") as Parameters<typeof tiktoken.getEncoding>[0]),
  );
  return tokenizerPromise;
}

async function loadConfig(assetPath: string) {
  configPromise ??= readFile(path.join(assetPath, "config.json"), "utf8").then((raw) =>
    JSON.parse(raw) as PrivacyModelConfig,
  );
  return configPromise;
}

function encodeWithOffsets(
  tokenizer: ReturnType<TiktokenModule["getEncoding"]>,
  text: string,
): TokenOffset[] {
  const tokens = Array.from(tokenizer.encode(text));
  const offsets: TokenOffset[] = [];
  let cursor = 0;

  for (const token of tokens) {
    const decoded = tokenizer.decode([token]);
    const start = text.indexOf(decoded, cursor);
    const safeStart = start >= 0 ? start : cursor;
    const end = Math.min(text.length, safeStart + decoded.length);
    offsets.push({ token, start: safeStart, end });
    cursor = end;
  }

  return offsets;
}

function decodeTokenPredictions(
  logits: Float32Array | number[],
  sequenceLength: number,
  labelCount: number,
  labels: string[],
) {
  const predictions: Array<{ label: string; confidence: number }> = [];

  for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
    const offset = tokenIndex * labelCount;
    let bestIndex = 0;
    let best = Number.NEGATIVE_INFINITY;
    let second = Number.NEGATIVE_INFINITY;

    for (let labelIndex = 0; labelIndex < labelCount; labelIndex += 1) {
      const value = Number(logits[offset + labelIndex]);
      if (value > best) {
        second = best;
        best = value;
        bestIndex = labelIndex;
      } else if (value > second) {
        second = value;
      }
    }

    const confidence = 1 / (1 + Math.exp(-(best - second)));
    predictions.push({ label: labels[bestIndex] ?? "O", confidence });
  }

  return predictions;
}

function spansFromPredictions(
  text: string,
  tokenOffsets: TokenOffset[],
  predictions: Array<{ label: string; confidence: number }>,
) {
  const spans: PrivacySpan[] = [];
  let current: { label: PrivacyLabel; start: number; end: number; scores: number[] } | null = null;

  predictions.forEach((prediction, index) => {
    const parsed = parseNerLabel(prediction.label);
    const offset = tokenOffsets[index];

    if (!offset || !parsed) {
      if (current) {
        spans.push(materializeSpan(text, current, spans.length));
        current = null;
      }
      return;
    }

    if (!current || parsed.prefix === "B" || parsed.prefix === "S" || current.label !== parsed.label) {
      if (current) {
        spans.push(materializeSpan(text, current, spans.length));
      }
      current = { label: parsed.label, start: offset.start, end: offset.end, scores: [prediction.confidence] };
    } else {
      current.end = offset.end;
      current.scores.push(prediction.confidence);
    }

    if (parsed.prefix === "E" || parsed.prefix === "S") {
      spans.push(materializeSpan(text, current, spans.length));
      current = null;
    }
  });

  if (current) {
    spans.push(materializeSpan(text, current, spans.length));
  }

  return spans.filter((span) => span.text.trim().length > 0);
}

function parseNerLabel(rawLabel: string): { prefix: string; label: PrivacyLabel } | null {
  if (rawLabel === "O") {
    return null;
  }

  const match = rawLabel.match(/^([BIES])-([a-z_]+)$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    label: normalizeModelLabel(match[2]),
  };
}

function normalizeModelLabel(label: string): PrivacyLabel {
  if (label === "agent_memory_sensitive") {
    return "prompt_sensitive";
  }
  if (label === "terminal_log") {
    return "stacktrace_sensitive";
  }
  return label as PrivacyLabel;
}

function materializeSpan(
  text: string,
  span: { label: PrivacyLabel; start: number; end: number; scores: number[] },
  index: number,
): PrivacySpan {
  const value = text.slice(span.start, span.end);
  const hash = hashSensitiveText(span.label, value);
  const confidence =
    span.scores.reduce((sum, score) => sum + score, 0) / Math.max(1, span.scores.length);

  return {
    id: `onnx-${index}-${span.start}-${hash.slice(0, 8)}`,
    label: span.label,
    text: value,
    start: span.start,
    end: span.end,
    confidence,
    source: ["onnx"],
    risk: riskForLabel(span.label),
    replacement: "[SECRET]",
    hash,
  };
}

function riskForLabel(label: PrivacyLabel): PrivacyRisk {
  if (
    label === "secret" ||
    label === "api_key" ||
    label === "auth_token" ||
    label === "session_cookie" ||
    label === "database_uri" ||
    label === "cloud_credential" ||
    label === "repo_secret" ||
    label === "prompt_sensitive" ||
    label === "payment_token" ||
    label === "personal_document_id"
  ) {
    return "p0";
  }

  if (
    label === "private_file_path" ||
    label === "internal_url" ||
    label === "workspace_identity" ||
    label === "customer_data" ||
    label === "stacktrace_sensitive"
  ) {
    return "p1";
  }

  return "p2";
}
