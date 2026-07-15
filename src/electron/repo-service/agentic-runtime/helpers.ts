import { type ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentToolCall } from "./types";
import type { AssistantRunOptions, MessageArtifact, ToolEvent } from "../../../contracts/chat";
import type { WorkspaceMemoryProposedUpdate } from "../../../contracts/workspace";
import {
  getToolModelOutputBudgetChars,
  isToolBatchExclusive,
} from "../../tool-metadata";

export const MAX_TOOL_OUTPUT_CHARS = 80_000;

export { getToolModelOutputBudgetChars, isToolBatchExclusive };

export function isExecutionIntentPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    /\b(run|rerun|retry|continue|execute|apply|update|install|fix|verify|test|commit|push)\b/,
    /\b(reintenta|intenta|continua|continúa|ejecuta|aplica|actualiza|instala|arregla|verifica|prueba)\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function summarizeCheckpoint(content: unknown): string | null {
  const collapsed = normalizeAssistantText(content).replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }
  return collapsed.length <= 220
    ? collapsed
    : `${collapsed.slice(0, 217).trimEnd()}...`;
}

export function summarizeToolOutput(content: unknown): string {
  const normalized = normalizeAssistantText(content)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Tool returned no textual output.";
  }
  return normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177).trimEnd()}...`;
}

export function isCleanCurrentChangeReview(prompt: string, snapshot: RepoSnapshot): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  if (!isCurrentChangeReviewPrompt(normalizedPrompt)) return false;

  return snapshot.statusLines.every((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length === 0 ||
      /\b(clean|no changes?|nothing to commit|working tree clean)\b/i.test(trimmed)
    );
  });
}

export function isCurrentChangeReviewPrompt(prompt: string): boolean {
  return (
    /\breview\b/.test(prompt) &&
    /\bcurrent changes?\b/.test(prompt) &&
    /\brisk\b/.test(prompt)
  );
}

export function isAllowedCleanReviewToolCall(toolCall: AgentToolCall): boolean {
  if (toolCall.name !== "git_diag") return false;
  const args = parseToolCallArguments(toolCall.arguments);
  return args?.operation === "diff";
}

export function isAllowedCurrentChangeReviewToolCall(toolCall: AgentToolCall): boolean {
  if (toolCall.name === "git_diag") {
    const args = parseToolCallArguments(toolCall.arguments);
    return args?.operation === "diff";
  }
  return toolCall.name === "read" || toolCall.name === "read_many" || toolCall.name === "rg";
}

export function isCleanGitDiffToolResult(result: {
  toolExecution: ToolExecutionRecord;
  content: string;
}): boolean {
  if (result.toolExecution.toolName !== "git_diag") return false;
  const args = result.toolExecution.args as { operation?: unknown };
  if (args.operation !== "diff") return false;

  const parsed = tryParseJsonObject(result.content);
  if (!parsed) return false;

  const changedFiles = Array.isArray(parsed.files) ? parsed.files.length : 0;
  return (
    changedFiles === 0 &&
    Number(parsed.insertions ?? 0) === 0 &&
    Number(parsed.deletions ?? 0) === 0
  );
}

export function buildCleanCurrentChangeReviewAnswer(): string {
  return [
    "Verdict: no current changes to review.",
    "Verdict summary: git status/diff show 0 changed files, 0 insertions, and 0 deletions.",
    "Confidence: high.",
    "Final recommendation: risk N/A; no validation or extra inspection needed for a clean current-change review.",
  ].join("\n");
}

export function parseToolCallArguments(argumentsJson?: string): Record<string, unknown> | null {
  return tryParseJsonObject(argumentsJson || "{}");
}

export function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizeAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

export function isPreparatoryAssistantText(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const startsWithPlan =
    /\b(I will|I'll|I’ll|Let me|I need to|I'll begin|I will begin|First,?\s+I(?:'ll| will)|I will start|I'll start|I will inspect|I'll inspect|I will check|I'll check)\b/i.test(normalized);
  const promisesToolWork =
    /\b(inspect|check|examine|review|run|call|search|read|analy[sz]e|perform|begin|start)\b/i.test(normalized) &&
    /\b(git status|git diff|working set|repository state|current state|files?|tool|scan|attack surface|security_path_trace|candidate_revalidator)\b/i.test(normalized);
  const hasFinalSignal =
    /\b(Verdict:|Verdict summary:|Confidence:|Findings?:|Unresolved risks?:|Final recommendation:|No findings?|Candidate\b|Evidence:)\b/i.test(normalized);
  return startsWithPlan && promisesToolWork && !hasFinalSignal;
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function buildNoContentFinalResponse(params: {
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
}): string {
  const recentEvents = params.events
    .slice(-3)
    .map((event) => `- ${event.label}: ${event.detail}`);

  return [
    "The run completed, but the model returned no final synthesis.",
    "",
    `Summary: ${params.iterations} pass(es), ${params.toolRounds} tool round(s), ${params.totalToolCalls} tool call(s).`,
    "",
    "Last steps:",
    ...(recentEvents.length > 0 ? recentEvents : ["- No events captured."]),
  ].join("\n");
}

export function isRainyConnectionTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "APIConnectionTimeoutError" ||
    /\b(APIConnectionTimeoutError|Request timed out|timeout|timed out)\b/i.test(error.message)
  );
}

export function buildTimeoutFinalResponse(params: {
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
  lastText: string;
}): string {
  const collected = params.lastText.trim();
  if (collected) {
    return [
      collected,
      "",
      "Rainy request timed out before final synthesis. This is a partial repo-grounded result from evidence already collected.",
    ].join("\n");
  }
  return [
    "Rainy request timed out before final synthesis.",
    "",
    buildNoContentFinalResponse(params),
  ].join("\n");
}

export function buildHistoryMessages(
  history: string[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.flatMap((entry) => {
    const match = entry.match(/^(user|assistant):\s*/i);
    if (!match) {
      const collapsed = entry.trim();
      return collapsed ? [{ role: "user" as const, content: collapsed }] : [];
    }

    const role: "user" | "assistant" =
      match[1].toLowerCase() === "assistant" ? "assistant" : "user";
    const content = entry.slice(match[0].length).trim();

    // Prune obvious failure/partial turns from prior runs so they don't pollute
    // context and cause repetition or "strange" parroting on re-tries of similar tasks.
    if (/rainy api fallback|agentic loop failed|buildFallbackResponse/i.test(content)) {
      return [];
    }

    return content ? [{ role, content }] : [];
  });
}

/**
 * Append assistant pass text while avoiding obvious full repetition within one run.
 * Used to mitigate the "repeats the same thing multiple times" symptom when the
 * model echoes prior passes or when nudges/synthesis feed large prior context.
 */
export function appendAssistantPass(current: string, next: string): string {
  const trimmed = next.trim();
  if (!trimmed) return current;
  // Simple, cheap, no-dep heuristic: if the head of the new text already appears
  // in the accumulated text, treat as repeat (the prior passes + events already
  // captured it for the EvidencePack).
  const head = trimmed.slice(0, 80);
  if (head.length > 20 && current.includes(head)) {
    return current;
  }
  return current ? `${current}\n\n${trimmed}` : trimmed;
}

export function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Recover first valid object when a model appends prose or another call.
  }

  const recovered = extractFirstBalancedJsonObject(rawArguments);
  if (!recovered) {
    throw new Error("Invalid tool arguments.");
  }

  const parsed = JSON.parse(recovered) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function extractFirstBalancedJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function truncateToolOutput(content: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n... (truncated ${content.length - maxChars} characters)`;
}

/**
 * Truncate tool output for model context using per-tool budgets, never exceeding
 * the hard MAX_TOOL_OUTPUT_CHARS ceiling.
 */
export function truncateToolOutputForModel(
  toolName: string,
  content: string,
): string {
  const budget = Math.min(
    getToolModelOutputBudgetChars(toolName),
    MAX_TOOL_OUTPUT_CHARS,
  );
  return truncateToolOutput(content, budget);
}

/**
 * Execute a tool batch with parallel-safe concurrency and serial exclusive tools.
 * Order of results matches input order.
 */
export async function executeToolBatchWithSafety<T extends { name: string }, R>(
  toolCalls: T[],
  maxParallel: number,
  mapper: (toolCall: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(toolCalls.length);
  let parallelIndices: number[] = [];

  const flushParallelRun = async () => {
    if (parallelIndices.length === 0) return;
    const parallelResults = await mapWithConcurrency(
      parallelIndices,
      maxParallel,
      async (index) => {
        const value = await mapper(toolCalls[index], index);
        return { index, value };
      },
    );
    for (const item of parallelResults) {
      results[item.index] = item.value;
    }
    parallelIndices = [];
  };

  for (let index = 0; index < toolCalls.length; index += 1) {
    if (!isToolBatchExclusive(toolCalls[index].name)) {
      parallelIndices.push(index);
      continue;
    }

    await flushParallelRun();
    results[index] = await mapper(toolCalls[index], index);
  }
  await flushParallelRun();

  return results;
}

/**
 * Race a promise against a timeout. When an AbortController is provided, the
 * controller is aborted on timeout so cooperative tools can stop work.
 * Does not force-kill non-cooperative work; callers should still treat the
 * rejection as the authoritative timeout boundary.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  options?: {
    abortController?: AbortController;
    signal?: AbortSignal;
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      options.abortController?.abort();
      reject(new Error("Tool call was cancelled."));
      return;
    }

    const timer = setTimeout(() => {
      options?.abortController?.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      options?.abortController?.abort();
      reject(new Error("Tool call was cancelled."));
    };

    options?.signal?.addEventListener("abort", onAbort, { once: true });

    void promise.then(
      (value) => {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(
    1,
    Math.min(concurrency, values.length || 1),
  );
  const results = new Array<R>(values.length);
  let currentIndex = 0;

  async function runWorker() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;

      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
  return results;
}

export function isToolFailureOutput(output: string): boolean {
  // Prefer the shared structured detector (JSON ok:false + stable prefixes).
  // Local import avoided to keep this module usable in pure unit tests.
  const trimmed = output.trim();
  if (!trimmed) {
    return false;
  }

  // Full-body or trailing structured failure marker.
  const jsonCandidate = extractTrailingJsonObjectForFailure(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      if (parsed.ok === false) {
        return true;
      }
      if (parsed.ok === true) {
        return false;
      }
      if (
        parsed.status === "failed" ||
        parsed.status === "error" ||
        parsed.status === "cancelled"
      ) {
        return true;
      }
      if (parsed.fatal === true) {
        return true;
      }
    } catch {
      // fall through
    }
  }

  return /^(?:Error\b|Tool .+ failed\b|Invalid arguments\b|Workspace Trust Contract blocks\b|Policy stop\b|File not found\b|Path must remain\b|Timed? ?out\b|Cancelled\b|Canceled\b)/i.test(
    trimmed,
  );
}

function extractTrailingJsonObjectForFailure(text: string): string | null {
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }
  const lastBrace = text.lastIndexOf("\n{");
  if (lastBrace >= 0) {
    const candidate = text.slice(lastBrace + 1).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }
  return null;
}

export function appendAttachmentContext(
  prompt: string,
  attachments?: AssistantRunOptions["attachments"],
): string {
  if (!attachments || attachments.length === 0) {
    return prompt;
  }

  const renderedAttachments = attachments.map((attachment, index) => {
    const header = `Attachment ${index + 1}: ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes, ${attachment.kind})`;
    if (attachment.text) {
      return `${header}\nContent:\n\`\`\`\n${attachment.text}\n\`\`\``;
    }
    if (attachment.dataUrl) {
      return `${header}\nData URL:\n${attachment.dataUrl}`;
    }
    return header;
  });

  return `${prompt}\n\nUser attachments:\n${renderedAttachments.join("\n\n")}`;
}

export function buildChatUserContent(
  prompt: string,
  attachments?: AssistantRunOptions["attachments"],
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  const imageAttachments =
    attachments?.filter(
      (attachment) => attachment.kind === "image" && attachment.dataUrl,
    ) ?? [];

  if (imageAttachments.length === 0) {
    return appendAttachmentContext(prompt, attachments);
  }

  const nonImageAttachments = attachments?.filter(
    (attachment) => attachment.kind !== "image" || !attachment.dataUrl,
  );
  const text = appendAttachmentContext(prompt, nonImageAttachments);

  return [
    { type: "text" as const, text },
    ...imageAttachments.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.dataUrl! },
    })),
  ];
}

export function buildArtifacts(
  snapshot: RepoSnapshot,
  providerReady: boolean,
  configuredModel: string | null,
  options: AssistantRunOptions,
): MessageArtifact[] {
  return [
    {
      id: "artifact-provider",
      label: "Provider",
      value: providerReady ? "Rainy API v3" : "Local fallback",
      tone: providerReady ? "success" : "warning",
    },
    {
      id: "artifact-model",
      label: "Model",
      value: providerReady
        ? (configuredModel ?? "unknown")
        : (configuredModel ?? "not configured"),
    },
    {
      id: "artifact-mode",
      label: "Mode",
      value: options.pathKind ?? "full",
    },
    {
      id: "artifact-reasoning",
      label: "Reasoning",
      value: options.reasoning,
    },
    {
      id: "artifact-service-tier",
      label: "Service tier",
      // Requested tier only. Provider-returned effective tier is preserved
      // separately when response metadata is available (billing authority).
      value: options.serviceTier ?? "standard",
    },
    {
      id: "artifact-runbook",
      label: "Runbook",
      value: options.runbookId ?? "patch_test_verify",
      tone: "success",
    },
    {
      id: "artifact-access",
      label: "Contract",
      value: `${snapshot.trustContract.name} v${snapshot.trustContract.version}`,
      tone: "success",
    },
    {
      id: "artifact-autonomy",
      label: "Autonomy",
      value: snapshot.trustContract.autonomy,
    },
    {
      id: "artifact-branch",
      label: "Branch",
      value: snapshot.workspace.branch,
    },
    {
      id: "artifact-files",
      label: "Files indexed",
      value: String(snapshot.files.length),
    },
  ];
}

export function buildWorkspaceMemoryArtifacts(
  proposals: WorkspaceMemoryProposedUpdate[],
): MessageArtifact[] {
  const proposedTargets = proposals
    .map((proposal) => proposal.filename)
    .join(", ");

  return [
    {
      id: "artifact-workspace-memory-workstate",
      label: "Workspace memory",
      value: "WORKSTATE.md updated",
      tone: "success",
    },
    {
      id: "artifact-workspace-memory-proposals",
      label: "Memory proposals",
      value: proposedTargets || "none",
      tone: proposals.length > 0 ? "warning" : "default",
    },
  ];
}

export function buildFallbackResponse(
  prompt: string,
  snapshot: RepoSnapshot,
  error?: unknown,
): string {
  if (error instanceof Error) {
    return formatRainyApiError(error);
  }

  const matches =
    snapshot.promptMatches.length > 0
      ? snapshot.promptMatches
          .slice(0, 4)
          .map((match) => `- ${match.file}:${match.line} ${match.text}`)
          .join("\n")
      : "- No prompt-linked file matches were found.";

  const gitLines =
    snapshot.statusLines.length > 0
      ? snapshot.statusLines
          .slice(0, 6)
          .map((line) => `- ${line}`)
          .join("\n")
      : "- Working tree clean.";

  return [
    `Request: ${prompt}`,
    "",
    `Workspace: ${snapshot.workspace.name}`,
    `Path: ${snapshot.workspace.path}`,
    `Branch: ${snapshot.workspace.branch}`,
    "",
    "Relevant matches:",
    matches,
    "",
    "Git status:",
    gitLines,
    "",
    "Next move: inspect the matched files and update the active workspace flow before making changes.",
  ].join("\n");
}

function formatRainyApiError(error: Error) {
  if (error.name === "AbortError" || /\babort(?:ed)?\b|\bcancel(?:led)?\b/i.test(error.message)) {
    return "API paused: connection stopped.";
  }

  const statusCode = error.message.match(/\b(?:status(?: code)?\s*)?([45]\d{2})\b/i)?.[1];
  if (!statusCode) {
    return `API error: ${error.message}`;
  }

  const summary =
    statusCode === "403"
      ? "Access denied. Check API key, model access, or billing permissions."
      : ["500", "502", "503", "504"].includes(statusCode)
        ? "Provider unavailable. Retry later or switch model/tier."
        : statusCode === "429"
          ? "Rate limit hit. Wait briefly, then retry."
          : "Request failed.";

  return `API ${statusCode}: ${summary}`;
}

export function parseDirectSecurityPathTraceArgs(prompt: string): {
  scope: string;
  maxFiles: number;
  maxTraces: number;
} | null {
  if (!/\bsecurity_path_trace\b/.test(prompt)) {
    return null;
  }
  if (/\b(deep_analysis_pipeline|attack_surface_scan|candidate_revalidator|evidence_pack)\b/.test(prompt)) {
    return null;
  }
  if (!/\b(run|call|use|execute)\s+security_path_trace\b/i.test(prompt)
    && !/\bsecurity_path_trace\b[\s\S]{0,120}\bScope:/i.test(prompt)) {
    return null;
  }

  const scope = prompt.match(/\bScope:\s*([^\n]+)/i)?.[1]?.trim() || ".";
  const maxFiles = Number(prompt.match(/\bMax files:\s*(\d+)/i)?.[1] ?? 250);
  const maxTraces = Number(prompt.match(/\bMax traces:\s*(\d+)/i)?.[1] ?? 12);

  return {
    scope,
    maxFiles: Number.isFinite(maxFiles) ? maxFiles : 250,
    maxTraces: Number.isFinite(maxTraces) ? maxTraces : 12,
  };
}

export function parseDirectDeepAnalysisPipelineArgs(prompt: string): {
  path: string;
  limit: number;
} | null {
  if (!/\b(run|call|use|execute)\s+deep_analysis_pipeline\b/i.test(prompt)) {
    return null;
  }

  const path =
    prompt.match(/\bpath\s+["']([^"']+)["']/i)?.[1]?.trim()
    || prompt.match(/\bScope:\s*([^\n]+)/i)?.[1]?.trim()
    || "src";
  const limit = Number(prompt.match(/\blimit\s+(\d+)/i)?.[1] ?? 40);

  return {
    path,
    limit: Number.isFinite(limit) ? limit : 40,
  };
}
