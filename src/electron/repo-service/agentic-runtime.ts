import { type ToolExecutionRecord } from "../evidence-pack";
import { appendVerificationWarnings, buildCriticReviewPrompt, buildCriticRevisionPrompt, criticFoundMajorIssue, verifyCriticLoop } from "../critic-loop";
import { policyService } from "../policy-service";
import { buildResponsesMessageInput, extractResponseThought, extractResponseFunctionCalls, listRainyModels, requestRainyChatCompletion, requestRainyChatCompletionStream, requestRainyResponsesCompletion, resolvePreferredRainyApiMode } from "../rainy-service";
import { toolService } from "../tool-service";
import { failureMemoryEngine } from "../failure-memory-engine";
import { repoGraphService } from "../repo-graph-service";
import { renderWorkingSetForPrompt } from "../working-set-compiler";
import { renderWorkPlanForPrompt } from "../work-engine/work-engine";
import { buildSecurityProofRules } from "../work-engine/security-proof-gate";
import { renderFailureMemoryInstruction } from "../work-engine/failure-memory-gate";
import type { WorkPlan } from "../work-engine/types";
import { createTokenEstimator } from "../token-estimator";
import type { AssistantRunbookDefinition, AssistantRunOptions, MessageArtifact, ToolEvent } from "../../contracts/chat";
import type { RainyApiMode, RainyModelCapabilities, RainyModelCatalogEntry } from "../../contracts/rainy";
import { getAcceptedParameters, getReasoningEffortValues, supportsReasoning, supportsTools } from "../../lib/rainy-model-capabilities";
import type { WorkspaceMemoryProposedUpdate } from "../../contracts/workspace";
import { MATE_AGENT_SYSTEM_PROMPT } from "../../config/mate-agent";
import { renderRunbookForPrompt } from "../assistant-runbooks";
import { renderTrustContractForPrompt } from "../workspace-trust";
import type { AppSettings } from "../../contracts/settings";
import type { RepoSnapshot } from "./workspace";

interface AgentRuntimeConfig {
  maxIterations: number;
  minToolRounds: number;
  maxToolCalls: number;
  requireToolingFirst: boolean;
  executionIntent: boolean;
}

interface AgentToolCall {
  id: string;
  name: string;
  arguments?: string;
}

const TOOL_BATCH_MAX_CONCURRENCY = 8;
const TOOL_EXECUTION_TIMEOUT_MS = 20_000;
const MAX_TOOL_OUTPUT_CHARS = 80_000;
const SANDBOX_RUN_ALLOWED_TIMEOUT_SECONDS = new Set([30, 45, 60, 120, 240]);
const TOOL_TIMEOUT_GRACE_MS = 5_000;

function buildAgentRuntimeConfig(
  options: AssistantRunOptions,
  prompt = "",
): AgentRuntimeConfig {
  const executionIntent =
    (options.mode === "build" || options.mode === "critic_loop") &&
    isExecutionIntentPrompt(prompt);
  const requireToolingFirst = executionIntent;
  const minToolRounds = executionIntent ? 1 : 0;
  const planLikeMode = options.mode === "plan";

  switch (options.reasoning) {
    case "low":
      return {
        maxIterations: planLikeMode ? 5 : 6,
        minToolRounds,
        maxToolCalls: 20,
        requireToolingFirst,
        executionIntent,
      };
    case "xhigh":
      return {
        maxIterations: planLikeMode ? 10 : 12,
        minToolRounds,
        maxToolCalls: 200,
        requireToolingFirst,
        executionIntent,
      };
    default:
      return {
        maxIterations: planLikeMode ? 8 : 9,
        minToolRounds,
        maxToolCalls: 100,
        requireToolingFirst,
        executionIntent,
      };
  }
}

function isExecutionIntentPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return [
    /\b(run|rerun|retry|continue|execute|apply|update|install|fix|verify|test|commit|push)\b/,
    /\b(reintenta|intenta|continua|continúa|ejecuta|aplica|actualiza|instala|arregla|verifica|prueba)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function summarizeCheckpoint(content: unknown) {
  const collapsed = normalizeAssistantText(content).replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  return collapsed.length <= 220
    ? collapsed
    : `${collapsed.slice(0, 217).trimEnd()}...`;
}

function summarizeToolOutput(content: unknown) {
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

function isCleanCurrentChangeReview(prompt: string, snapshot: RepoSnapshot) {
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

function isCurrentChangeReviewPrompt(prompt: string) {
  return (
    /\breview\b/.test(prompt) &&
    /\bcurrent changes?\b/.test(prompt) &&
    /\brisk\b/.test(prompt)
  );
}

function isAllowedCleanReviewToolCall(toolCall: AgentToolCall) {
  if (toolCall.name !== "git_diag") return false;
  const args = parseToolCallArguments(toolCall.arguments);
  return args?.operation === "diff";
}

function isAllowedCurrentChangeReviewToolCall(toolCall: AgentToolCall) {
  if (toolCall.name === "git_diag") {
    const args = parseToolCallArguments(toolCall.arguments);
    return args?.operation === "diff";
  }

  return toolCall.name === "read" || toolCall.name === "read_many" || toolCall.name === "rg";
}

function isCleanGitDiffToolResult(result: {
  toolExecution: ToolExecutionRecord;
  content: string;
}) {
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

function buildCleanCurrentChangeReviewAnswer() {
  return [
    "Verdict: no current changes to review.",
    "Verdict summary: git status/diff show 0 changed files, 0 insertions, and 0 deletions.",
    "Confidence: high.",
    "Final recommendation: risk N/A; no validation or extra inspection needed for a clean current-change review.",
  ].join("\n");
}

function parseToolCallArguments(argumentsJson?: string) {
  return tryParseJsonObject(argumentsJson || "{}");
}

function tryParseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeAssistantText(content: unknown): string {
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

function parseJsonObject(value: string): Record<string, unknown> | null {
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

function buildNoContentFinalResponse(params: {
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
}) {
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

async function attemptFinalChatSynthesis({
  apiKey,
  model,
  messages,
  iterations,
  toolRounds,
  totalToolCalls,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  messages: any[];
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
  emitProgress: () => void;
}) {
  const eventId = "step-agent-final-synthesis";
  events.push({
    id: eventId,
    label: "Final synthesis",
    detail:
      "Tool loop ended without a clear final answer. Requesting one final synthesis.",
    status: "active",
  });
  emitProgress();

  messages.push({
    role: "user",
    content:
      "Tool use is now disabled. You must write the final answer using only the evidence already collected above. " +
      "Do not request any tool calls. Structure your response with: a one-line verdict, key findings with evidence references, " +
      "unresolved risks, and recommended next steps. Begin your answer now.",
  });

  try {
    const response = await requestRainyChatCompletion({
      apiKey,
      messages,
      model,
      toolChoice: "none",
    });
    const finalMessage = response.choices[0]?.message;
    if (finalMessage) {
      messages.push(finalMessage);
    }

    const finalText = normalizeAssistantText(finalMessage?.content).trim();
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail = finalText
        ? "Final synthesis generated."
        : `No text returned. Ending after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`;
    }
    emitProgress();

    return (
      finalText ||
      buildNoContentFinalResponse({ iterations, toolRounds, totalToolCalls, events })
    );
  } catch (error) {
    const fallbackText = buildNoContentFinalResponse({
      iterations,
      toolRounds,
      totalToolCalls,
      events,
    });
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail =
        error instanceof Error
          ? `Final synthesis unavailable: ${error.message}. Returned local run summary.`
          : "Final synthesis unavailable. Returned local run summary.";
    }
    emitProgress();
    return fallbackText;
  }
}

async function attemptFinalResponsesSynthesis({
  apiKey,
  model,
  previousResponseId,
  iterations,
  toolRounds,
  totalToolCalls,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  previousResponseId?: string;
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  events: ToolEvent[];
  emitProgress: () => void;
}) {
  const eventId = "step-agent-final-synthesis";
  events.push({
    id: eventId,
    label: "Final synthesis",
    detail:
      "Tool loop ended without a clear final answer. Requesting one final synthesis.",
    status: "active",
  });
  emitProgress();

  try {
    const response = await requestRainyResponsesCompletion({
      apiKey,
      model,
      previousResponseId,
      toolChoice: "none",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Tool use is now disabled. You must write the final answer using only the evidence already collected above. " +
                "Do not request any tool calls. Structure your response with: a one-line verdict, key findings with evidence references, " +
                "unresolved risks, and recommended next steps. Begin your answer now.",
            },
          ],
        },
      ],
    });
    const finalText = normalizeAssistantText(response.output_text).trim();

    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail = finalText
        ? "Final synthesis generated."
        : `No text returned. Ending after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`;
    }
    emitProgress();

    return (
      finalText ||
      buildNoContentFinalResponse({ iterations, toolRounds, totalToolCalls, events })
    );
  } catch (error) {
    const fallbackText = buildNoContentFinalResponse({
      iterations,
      toolRounds,
      totalToolCalls,
      events,
    });
    const event = events.find((item) => item.id === eventId);
    if (event) {
      event.status = "done";
      event.detail =
        error instanceof Error
          ? `Final synthesis unavailable: ${error.message}. Returned local run summary.`
          : "Final synthesis unavailable. Returned local run summary.";
    }
    emitProgress();
    return fallbackText;
  }
}

function buildHistoryMessages(
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

    return content ? [{ role, content }] : [];
  });
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
      value: options.mode,
    },
    {
      id: "artifact-reasoning",
      label: "Reasoning",
      value: options.reasoning,
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
) {
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

  const errorLine =
    error instanceof Error ? `\n\nRainy API error: ${error.message}` : "";

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
    errorLine,
  ].join("\n");
}

export function parseDirectSecurityPathTraceArgs(prompt: string) {
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

export function parseDirectDeepAnalysisPipelineArgs(prompt: string) {
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

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
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

function extractFirstBalancedJsonObject(value: string): string | null {
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

function truncateToolOutput(content: string) {
  if (content.length <= MAX_TOOL_OUTPUT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... (truncated ${content.length - MAX_TOOL_OUTPUT_CHARS} characters)`;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );

    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolveToolExecutionTimeoutMs(
  toolName: string,
  args: Record<string, unknown>,
) {
  if (toolName !== "sandbox_run") {
    return TOOL_EXECUTION_TIMEOUT_MS;
  }

  const timeoutSeconds = Number(args.timeoutSeconds);
  if (!SANDBOX_RUN_ALLOWED_TIMEOUT_SECONDS.has(timeoutSeconds)) {
    return 30_000 + TOOL_TIMEOUT_GRACE_MS;
  }

  return timeoutSeconds * 1000 + TOOL_TIMEOUT_GRACE_MS;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
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

export async function executeAgentToolCall({
  toolCall,
  toolIndex,
  iteration,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  toolCall: AgentToolCall;
  toolIndex: number;
  iteration: number;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const toolName = toolCall.name;
  const eventId = `tool-${iteration}-${toolIndex}-${toolName}`;
  const rawArguments = toolCall.arguments;
  let toolArgs: Record<string, unknown>;

  try {
    toolArgs = parseToolArguments(rawArguments);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Invalid tool arguments.";
    events.push({
      id: eventId,
      label: `Failed ${toolName}`,
      detail: reason,
      status: "error",
    });
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool argument parsing failed for ${toolName}: ${reason}`,
      toolExecution: {
        toolName,
        args: {},
        output: `Tool argument parsing failed for ${toolName}: ${reason}`,
      } satisfies ToolExecutionRecord,
    };
  }

  const policyStop = policyService.evaluateToolCall({
    runId,
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });
  const toolPolicy = policyService.classifyToolCall({
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });

  if (policyStop) {
    events.push({
      id: eventId,
      label: policyStop.title,
      detail: `${policyStop.explanation} Policy: ${policyStop.policyId}.`,
      status: "error",
      policy: toolPolicy,
    });
    emitProgress();

    const resolvedStop = await policyService.waitForResolution(policyStop.id);
    const toolEvent = events.find((event) => event.id === eventId);
    if (resolvedStop.resolution?.action !== "approve_once") {
      const declinedMessage = `Policy stop ${policyStop.id} was ${resolvedStop.resolution?.action ?? "declined"}. Continue with allowed safer alternatives; do not execute ${toolName}.`;
      if (toolEvent) {
        toolEvent.status = "done";
        toolEvent.detail = declinedMessage;
      }
      policyService.markStopCompleted(policyStop.id);
      emitProgress();

      return {
        toolCallId: toolCall.id,
        content: declinedMessage,
        toolExecution: {
          toolName,
          args: toolArgs,
          output: declinedMessage,
          parsedOutput: {
            policyStop: resolvedStop,
            status: "declined",
          },
        } satisfies ToolExecutionRecord,
      };
    }

    policyService.markStopResumed(policyStop.id);
    if (toolEvent) {
      toolEvent.label = `Executing approved ${toolName}`;
      toolEvent.detail = `Approval received for policy stop ${policyStop.id}.`;
      toolEvent.status = "active";
    }
    emitProgress();
  }

  if (!policyStop) {
    events.push({
      id: eventId,
      label: `Executing ${toolName}`,
      detail: `Running ${toolName} with arguments: ${JSON.stringify(toolArgs)}`,
      status: "active",
      policy: toolPolicy,
    });
    emitProgress();
  }

  try {
    const toolTimeoutMs = resolveToolExecutionTimeoutMs(toolName, toolArgs);
    const result = await withTimeout(
      toolService.callTool(toolName, toolArgs, {
        workspacePath: snapshot.workspace.path,
        trustContract: snapshot.trustContract,
        settings: appSettings,
      }),
      toolTimeoutMs,
      `Tool ${toolName} timed out after ${Math.round(toolTimeoutMs / 1000)}s.`,
    );

    const normalizedResult = truncateToolOutput(String(result ?? ""));
    const parsedOutput = parseJsonObject(normalizedResult);
    const outputIndicatesFailure = isToolFailureOutput(normalizedResult);
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = outputIndicatesFailure ? "error" : "done";
      toolEvent.detail = summarizeToolOutput(normalizedResult);
    }
    if (policyStop) {
      if (outputIndicatesFailure) {
        policyService.markStopFailed(policyStop.id);
      } else {
        policyService.markStopCompleted(policyStop.id);
      }
    }
    if (outputIndicatesFailure && (toolName === "run_tests" || toolName === "sandbox_run")) {
      await failureMemoryEngine.recordFailure({
        workspaceId: snapshot.workspace.id,
        command: String(toolArgs.command ?? toolArgs.script ?? toolName),
        output: normalizedResult,
      }).catch((error) => {
        console.warn("Failure memory record failed:", error);
      });
    }
    if (!outputIndicatesFailure && (toolName === "run_tests" || toolName === "sandbox_run")) {
      await failureMemoryEngine.recordResolution({
        workspaceId: snapshot.workspace.id,
        command: String(toolArgs.command ?? toolArgs.script ?? toolName),
        retryFixed: true,
      }).catch((error) => {
        console.warn("Failure memory resolution failed:", error);
      });
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: normalizedResult,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: normalizedResult,
        parsedOutput: parsedOutput ?? undefined,
      } satisfies ToolExecutionRecord,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Tool ${toolName} failed.`;
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "error";
      toolEvent.detail = message;
    }
    if (policyStop) {
      policyService.markStopFailed(policyStop.id);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool ${toolName} failed: ${message}`,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: `Tool ${toolName} failed: ${message}`,
      } satisfies ToolExecutionRecord,
    };
  }
}

function isToolFailureOutput(output: string) {
  return /^(?:Error|Tool .+ failed|Workspace Trust Contract blocks|Policy stop)\b/i.test(output.trim());
}

export async function requestRainyAgenticResponse({
  apiKey,
  history,
  model,
  apiMode,
  capabilities,
  modelCatalogEntry,
  prompt,
  snapshot,
  workingSet,
  workPlan,
  events,
  options,
  runbookDefinition,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  apiMode: RainyApiMode;
  capabilities?: RainyModelCapabilities;
  modelCatalogEntry?: RainyModelCatalogEntry;
  prompt: string;
  snapshot: RepoSnapshot;
  workingSet: import("../../contracts/working-set").WorkingSet;
  workPlan: WorkPlan;
  events: ToolEvent[];
  options: AssistantRunOptions;
  runbookDefinition: AssistantRunbookDefinition;
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const runtime = buildAgentRuntimeConfig(options, prompt);
  if (runtime.executionIntent && !supportsTools(capabilities)) {
    events.push({
      id: "step-model-tools-unsupported",
      label: "Model tools unsupported",
      detail:
        `Model ${model} does not advertise tool-calling support in the Rainy catalog. ` +
        "This task requires repository tools for patching or validation, so MaTE X will not treat this run as verified.",
      status: "error",
    });
    emitProgress();

    return {
      toolExecutions: [],
      content:
        `Model ${model} cannot run repository tools for this task. ` +
        "Choose a model with tool-calling support, then retry patch/validation.",
    };
  }
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join("\n");
  const gitStatus = snapshot.statusLines.slice(0, 40).join("\n");
  const repoGraphSummary = await repoGraphService.getPromptSummary(
    snapshot.workspace,
  );
  const similarFailures = await failureMemoryEngine.findSimilarFailures({
    workspaceId: snapshot.workspace.id,
    output: prompt,
    limit: 1,
  });
  const failureMemoryContext = [
    failureMemoryEngine.renderPromptSection(similarFailures),
    renderFailureMemoryInstruction(similarFailures),
  ].filter(Boolean).join("\n\n");

  const systemPrompt = `${MATE_AGENT_SYSTEM_PROMPT}

Workspace: ${snapshot.workspace.name}
Path: ${snapshot.workspace.path}
Branch: ${snapshot.workspace.branch}
Stack: ${snapshot.workspace.stack.join(", ") || "unknown"}
Operating mode: ${options.mode}
Reasoning level: ${options.reasoning}
Reasoning enabled: ${options.reasoningEnabled ? "yes" : "no"}
Filesystem access policy: ${options.access}
Execution intent detected: ${runtime.executionIntent ? "yes - at least one tool-backed pass is required before the final answer" : "no"}

${renderTrustContractForPrompt(snapshot.trustContract)}

Runtime truth and permissions:
- Current workspace path is the real project root: ${snapshot.workspace.path}
- Treat package-manager mutations, generated files, lockfiles, git operations, and source edits as real workspace effects when a tool is allowed to run them.
- The sandbox_run tool time-limits a child process and defaults to test-like env vars; it does not create a disposable copy of the repository and must not be described as changing only a fake project.
- For sandbox_run, choose timeoutSeconds from 30, 45, 60, 120, or 240 based on expected duration. Use longer timeouts for slow tests/builds instead of letting checks freeze or reporting runtime blocked. You may also set port, nodeEnv, maxOutputChars, keepAwake, and powerSaveBlockerType when needed. For long or interactive Electron/browser checks, use keepAwake with prevent-app-suspension or prevent-display-sleep.
- If a tool returns a Workspace Trust Contract block, the product can surface approval. State what was blocked and continue with permitted alternatives if approval is declined.
- When contract autonomy is ${snapshot.trustContract.autonomy}, allowed actions are: ${snapshot.trustContract.allowedActions.join(", ") || "none"}.
- Blocked actions are: ${snapshot.trustContract.blockedActions.join(", ") || "none"}.
- Do not ask the user to run a command manually unless MaTE X lacks a permitted or approvable path to perform it.

Working Set:
${renderWorkingSetForPrompt(workingSet)}

WorkPlan:
${renderWorkPlanForPrompt(workPlan)}

Work Engine mandatory gates:
- Intent: ${workPlan.intent}; runbook: ${workPlan.runbook}; risk: ${workPlan.risk}.
- Follow WorkPlan working set before any broad search.
- Validation required: ${workPlan.validationPlan.required ? "yes" : "no"}. Primary: ${workPlan.validationPlan.primaryCommand ?? "none"}. Fallback: ${workPlan.validationPlan.fallbackCommand ?? "none"}.
- Evidence required: ${workPlan.evidencePlan.required ? "yes" : "no"}. Missing evidence must be named in final response.
- Privacy preflight is mandatory before repo context, tool output, memory, or evidence crosses cloud boundary.
- Final fixed/ready/works/merge-ready claims require runtime validation evidence and validation persistence.
- Evidence-only runbook can package existing runtime records only; never invent evidence.

Security proof rules:
${buildSecurityProofRules().map((rule) => `- ${rule}`).join("\n")}

Working set discipline:
- Treat the working set as the authoritative starting context for this run.
- Do not read primary target files just to restate that they are relevant; first use the ranked paths, git diff snippets, recent failures, and relevant scripts already supplied.
- If the objective is a failing validation command, run the narrow validation command before reading files unless the working set already contains the exact error.
- If the narrow validation command exits 0, treat the reported failure as resolved or unreproduced. Do not claim pending type errors, mismatches, or failures without a nonzero command result or exact diagnostic text.
- Inspect files only when the working set, graph context, diffs, or command output identifies a concrete unresolved question.
- Prefer Repo Intelligence Graph tools over grep or broad file listing when selecting any additional files.

Git status:
${gitStatus || "(clean)"}

Prompt-linked matches:
${matches || "(none)"}

Workspace memory:
${snapshot.memoryContext?.context || "(none)"}

${failureMemoryContext}

Repo Intelligence Graph:
${repoGraphSummary}

You are running in an agent loop, not a single reply.
First, use the working set, workspace metadata, git status, prompt-linked matches, and conversation history already provided here.
Before broad file search, use Repo Intelligence Graph APIs for entrypoints, impacted files, tests, import chains, IPC surface, env usage, and dependency surface when they fit the task.
Security tool playbook:
- For secret exposure, call secret_scan first. Keep evidence redacted; use source_map_analyzer for built bundles/maps and client env leakage.
- For broad repo triage, use attack_surface_scan or deep_analysis_pipeline, then candidate_revalidator before calling a finding confirmed.
- For exploitability, use security_path_trace for source-to-sink proof; use flow_trace only for narrow named variable/term tracing.
- For container configs, use container_audit. For dependency CVEs, use cve_audit. For ReDoS, use redos_analyzer.
- For locating files, prefer RepoGraph, then glob/find; use ast_grep when you need exact code-block evidence around a risky pattern.
Fast search/read playbook:
- Use rg before read when you need exact symbols, text, imports, config keys, or error strings. Prefer path/paths and include to keep search scoped.
- Use rg maxResults and maxOutputChars for broad terms; raise them only after narrowing. Use contextLines 1-3 for nearby evidence, sort path only when stable output matters.
- Use rg paths for multiple likely directories/files in one call instead of repeated single-path searches.
- Use read_many after rg when you need several files or line ranges. Prefer one read_many call over many read calls.
- Avoid ls/tree/find for code discovery when rg, RepoGraph, glob, or read_many can answer faster.
For review_classify_summarize, stay read-only: inspect git diff/status and needed file context, classify risk, then stop. Do not call plan_validation, run_tests, sandbox_run, evidence_pack, or patch tools for a pure current-change review.
Before running validation for code changes, create a validation plan with plan_validation using the task objective, changed files, RepoGraph impacted files, package scripts, detected framework, and previous failure context already available. plan_validation only plans and its executionState is not_run/not_verified; never report primary run, fallback run, persistence, PROVEN, GO, production-ready, or validation complete from plan_validation alone. When a validation plan exists, use it; do not choose validation commands ad hoc. If run_tests returns nextRequiredAction, perform it before finalizing. After run_tests, call verify_validation_persistence before claiming the plan was persisted with a run or validation is complete.
For review current changes/classify risk tasks with a clean git status and zero diff churn, stop after git status/diff evidence. Do not call plan_validation, run_tests, sandbox_run, git show, or extra ls/read tools for clean current-change review.
Before retrying a failed command, validation, or patch loop, call find_similar_failures unless the "Known similar failure from this workspace" section already gives an exact match. If the same failure repeats, warn the user and change approach. After new failures call record_failure; after a retry clears a known failure call record_resolution.
Reproduction harness contract:
- Before patching suspicious behavior or a bug, attempt the smallest useful reproduction first.
- Prefer non-invasive checks in this order when practical: existing unit/integration test, validation run, new temporary or repo-local minimal test/script, HTTP request, browser scenario, static proof.
- Use repo-local locations only when they match project conventions; otherwise use a temporary workspace-safe path and record it.
- For runtime repros, record whether the check existed before patch, pre-patch outcome, and post-patch outcome after remediation.
- If runtime repro is impossible, provide a static proof with exact code/config references and mark pre/post outcomes blocked or unknown.
- Do not claim root cause unless reproduction failed before patch and passed after patch, or strong static proof exists.
Reproduction evidence integrity:
- If no runtime tool call actually executed, do not report "Type: minimal script", "unit test", "integration test", "HTTP request", "browser scenario", or "validation run"; use "static proof" and explain why runtime was unavailable.
- If the runtime evidence is a validation command such as typecheck, lint, test, build, package, or make, report "Type: validation run" rather than "minimal script".
- Do not invent temp paths, commands, exit codes, timings, or pre/post outcomes. Only report a command as executed when a tool result exists for that exact command.
- If multiple tool calls executed separate commands, list each command separately. Do not combine them into a shell-looking command with ;, &&, ||, or pipes unless that exact command string was accepted and executed by a tool.
- When multiple commands are part of one reproduction, format the Command field as separate lines: "Command:\n- first command\n- second command". Never compress separate tool calls into one semicolon-separated command.
- If sandbox_run executed, final answer must not say runtime execution was blocked. If runtime was blocked, name the blocker and avoid fabricated runtime evidence.
Sandbox timeout facts:
- sandbox_run accepts timeoutSeconds 30, 45, 60, 120, or 240. The orchestration wrapper allows the requested sandbox timeout plus grace; do not claim a fixed 20s wrapper kills sandbox_run without current code evidence.
If that context is enough for the user's request, answer directly without calling tools.
If more evidence is needed, first emit a brief assistant progress update explaining what you will inspect, then call the smallest useful set of tools, then continue from the tool results.
Prefer one focused tool batch over broad exploration. Do not call tools just to satisfy the loop.
Stop investigating once you can give a grounded answer. Do not continue until the tool budget unless the user explicitly asks for exhaustive analysis.
If a tool fails or access is blocked, adapt to the available context and explain the limitation once.
In your final answer, include these explicit headings when applicable: "Verdict:", "Verdict summary:", "Confidence:", "Warnings:", "Unresolved risks:", and "Final recommendation:".
When a bug, suspicious behavior, or code patch is involved, include "Reproduction:" with lines: "Type:", "Status:", "Existed before patch:", "Pre-patch outcome:", "Post-patch outcome:", "Location:", "Command:", and "Summary:".
When you need to search for something, use the rg tool first with the narrowest path/include you know, then read_many only the matched files or line ranges.

Structured runbook contract (must follow):
${renderRunbookForPrompt(runbookDefinition)}`;
  const promptWithAttachments = appendAttachmentContext(prompt, options.attachments);

  if (apiMode === "responses") {
    return requestRainyResponsesAgenticResponse({
      apiKey,
      model,
      prompt: promptWithAttachments,
      history,
      runtime,
      options,
      systemPrompt,
      snapshot,
      events,
      emitProgress,
      appSettings,
      runId,
    });
  }

  return requestRainyChatAgenticResponse({
    apiKey,
    model,
    capabilities,
    modelCatalogEntry,
    prompt,
    history,
    runtime,
    options,
    systemPrompt,
    snapshot,
    events,
    emitProgress,
    appSettings,
    runId,
  });
}

function appendAttachmentContext(
  prompt: string,
  attachments?: AssistantRunOptions["attachments"],
) {
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

function buildChatUserContent(
  prompt: string,
  attachments?: AssistantRunOptions["attachments"],
) {
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
    { type: "text", text },
    ...imageAttachments.map((attachment) => ({
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    })),
  ];
}

async function finalizeCriticLoop({
  apiKey,
  model,
  options,
  snapshot,
  events,
  toolExecutions,
  prompt,
  finalContent,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  options: AssistantRunOptions;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  toolExecutions: ToolExecutionRecord[];
  prompt: string;
  finalContent: string;
  emitProgress: (content?: string, thought?: string) => void;
}) {
  if (options.mode !== "critic_loop") {
    return finalContent;
  }

  events.push({
    id: "step-critic-review",
    label: "Critic review",
    detail: "Reviewing final draft against existing evidence without tools.",
    status: "active",
  });
  emitProgress(finalContent);

  const criticInput = {
    workspacePath: snapshot.workspace.path,
    prompt,
    finalContent,
    statusLines: snapshot.statusLines,
    events,
    toolExecutions,
  };
  const criticResponse = await requestRainyChatCompletion({
    apiKey,
    model,
    messages: [
      { role: "system", content: "You are a strict internal critic. Do not call tools." },
      { role: "user", content: buildCriticReviewPrompt(criticInput) },
    ],
  });
  const criticNotes = normalizeAssistantText(
    criticResponse.choices[0]?.message?.content,
  );
  const criticEvent = events.find((event) => event.id === "step-critic-review");
  if (criticEvent) {
    criticEvent.status = "done";
    criticEvent.detail = criticFoundMajorIssue(criticNotes)
      ? "Major issue found; forcing revision before final response."
      : "No major issue found.";
  }
  emitProgress(finalContent);

  let reviewedContent = finalContent;
  if (criticFoundMajorIssue(criticNotes)) {
    events.push({
      id: "step-critic-revision",
      label: "Critic revision",
      detail: "Revising final answer to remove unsupported or risky claims.",
      status: "active",
    });
    emitProgress(finalContent);

    const revisionResponse = await requestRainyChatCompletion({
      apiKey,
      model,
      messages: [
        { role: "system", content: "You revise final answers using only supplied evidence." },
        { role: "user", content: buildCriticRevisionPrompt(finalContent, criticNotes) },
      ],
    });
    reviewedContent =
      normalizeAssistantText(revisionResponse.choices[0]?.message?.content).trim() ||
      finalContent;
    const revisionEvent = events.find((event) => event.id === "step-critic-revision");
    if (revisionEvent) {
      revisionEvent.status = "done";
      revisionEvent.detail = "Revision completed.";
    }
  }

  events.push({
    id: "step-critic-verifier",
    label: "Verifier check",
    detail: "Checking validation state, modified files, claimed files, and executed commands.",
    status: "active",
  });
  emitProgress(reviewedContent);

  const verification = await verifyCriticLoop({
    ...criticInput,
    finalContent: reviewedContent,
  });
  const verifierEvent = events.find((event) => event.id === "step-critic-verifier");
  if (verifierEvent) {
    verifierEvent.status = verification.warnings.length > 0 ? "error" : "done";
    verifierEvent.detail =
      verification.warnings.length > 0
        ? verification.warnings.join(" ")
        : "Verifier checks passed.";
  }

  return appendVerificationWarnings(reviewedContent, verification);
}

async function requestRainyChatAgenticResponse({
  apiKey,
  history,
  model,
  capabilities,
  modelCatalogEntry,
  prompt,
  runtime,
  options,
  systemPrompt,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  capabilities?: RainyModelCapabilities;
  modelCatalogEntry?: RainyModelCatalogEntry;
  prompt: string;
  runtime: AgentRuntimeConfig;
  options: AssistantRunOptions;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const historyMessages = buildHistoryMessages(history);
  const rainyReasoning = resolveRainyReasoningPayload(options, capabilities);
  let messages: any[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: buildChatUserContent(prompt, options.attachments) },
  ];
  const chatTools = await toolService.getChatToolDefinitions();
  const tokenEstimator = createTokenEstimator(model);
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let lastNonEmptyAssistantText = "";
  const toolExecutions: ToolExecutionRecord[] = [];

  const { applyContextCompressionChat } = await import("../context-compression");

  const finalizeContent = (finalContent: string) =>
    finalizeCriticLoop({
      apiKey,
      model,
      options,
      snapshot,
      events,
      toolExecutions,
      prompt,
      finalContent,
      emitProgress,
    });

  while (iterations < runtime.maxIterations) {
    iterations++;

    events.push({
      id: `step-agent-loop-${iterations}`,
      label: `Agent pass ${iterations}`,
      detail:
        iterations === 1
          ? "Starting the chat-completions tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
    });
    emitProgress();

    messages = await applyContextCompressionChat(
      messages,
      tokenEstimator,
      apiKey,
      model,
      events,
      emitProgress,
    );

    const maxTokens = resolveRainyMaxTokensForMessages(
      modelCatalogEntry,
      messages,
      tokenEstimator,
    );
    let streamedPassText = "";
    let streamedThought = "";
    const responseMessage = await requestRainyChatCompletionStream({
      apiKey,
      messages,
      model,
      tools: chatTools,
      toolChoice:
        runtime.requireToolingFirst &&
        toolRounds < runtime.minToolRounds &&
        totalToolCalls < runtime.maxToolCalls
          ? "required"
          : undefined,
      reasoning: rainyReasoning.reasoning,
      includeReasoning: rainyReasoning.includeReasoning,
      capabilities,
      maxTokens,
      onReasoningDelta: (delta) => {
        streamedThought += delta;
        emitProgress(
          lastNonEmptyAssistantText
            ? `${lastNonEmptyAssistantText}\n\n${streamedPassText}`
            : streamedPassText || undefined,
          streamedThought,
        );
      },
      onContentDelta: (delta) => {
        streamedPassText += delta;
        emitProgress(
          lastNonEmptyAssistantText
            ? `${lastNonEmptyAssistantText}\n\n${streamedPassText}`
            : streamedPassText,
          streamedThought || undefined,
        );
      },
    });

    messages.push(responseMessage);
    const toolCalls = responseMessage.tool_calls
      ?.filter((toolCall) => toolCall.type === "function")
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      }));

    const responseText = normalizeAssistantText(responseMessage.content);
    if (responseText.trim()) {
      lastNonEmptyAssistantText +=
        (lastNonEmptyAssistantText ? "\n\n" : "") + responseText;
      emitProgress(lastNonEmptyAssistantText);
    }

    const loopEvent = events.find(
      (event) => event.id === `step-agent-loop-${iterations}`,
    );
    const checkpoint = summarizeCheckpoint(responseText);
    if (loopEvent) {
      loopEvent.status = "done";
      loopEvent.detail = checkpoint
        ? `Checkpoint: ${checkpoint}`
        : `Pass ${iterations} completed.`;
      emitProgress();
    }

    if (!toolCalls || toolCalls.length === 0) {
      if (
        toolRounds < runtime.minToolRounds &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-nudge-${iterations}`,
          label: "Continue investigation",
          detail: runtime.executionIntent
            ? "Model produced text for an execution request without running a tool. Requesting the required tool-backed pass."
            : "Model tried to conclude early. Requesting another tool-backed pass.",
          status: "done",
        });
        emitProgress();

        messages.push({
          role: "user",
          content: runtime.executionIntent
            ? "The user asked you to perform an action. Do not answer with only text. Call the smallest appropriate tool now, then continue from the result."
            : "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
        });
        continue;
      }

      events.push({
        id: `step-agent-done-${iterations}`,
        label: "Response complete",
        detail: `Agent finished after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`,
        status: "done",
      });
      emitProgress();

      const forcedFinalText = responseText.trim()
        ? ""
        : await attemptFinalChatSynthesis({
            apiKey,
            model,
            messages,
            iterations,
            toolRounds,
            totalToolCalls,
            events,
            emitProgress,
          });

      const finalContentText = forcedFinalText
        ? lastNonEmptyAssistantText
          ? `${lastNonEmptyAssistantText}\n\n${forcedFinalText}`
          : forcedFinalText
        : lastNonEmptyAssistantText;

      return {
        toolExecutions,
        content: await finalizeContent(
          finalContentText ||
            buildNoContentFinalResponse({
              iterations,
              toolRounds,
              totalToolCalls,
              events,
            }),
        ),
      };
    }

    toolRounds++;
    const remainingBudget = runtime.maxToolCalls - totalToolCalls;
    const currentChangeReview = isCurrentChangeReviewPrompt(prompt.toLowerCase());
    const cleanCurrentChangeReview = isCleanCurrentChangeReview(prompt, snapshot);
    const executableToolCalls = toolCalls.slice(
      0,
      Math.max(remainingBudget, 0),
    ).filter((toolCall) =>
      cleanCurrentChangeReview
        ? isAllowedCleanReviewToolCall(toolCall)
        : !currentChangeReview || isAllowedCurrentChangeReviewToolCall(toolCall),
    );

    if (executableToolCalls.length === 0) {
      if (cleanCurrentChangeReview) {
        events.push({
          id: `step-clean-review-stop-${iterations}`,
          label: "Clean current-change review",
          detail: "Git status/diff evidence shows no current changes. Stopping without extra inspection.",
          status: "done",
        });
        emitProgress();

        return {
          toolExecutions,
          content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
        };
      }

      if (currentChangeReview) {
        messages.push({
          role: "user",
          content:
            "Extra tools outside current-change review scope were skipped. Synthesize the git diff and file-read evidence already collected; do not call more tools.",
        });
        continue;
      }

      messages.push({
        role: "user",
        content:
          "Tool budget is exhausted. Synthesize the evidence you already collected and conclude.",
      });
      continue;
    }

    events.push({
      id: `step-tool-batch-${iterations}`,
      label: `Tool batch ${toolRounds}`,
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent. sandbox_run may request 30/45/60/120/240s; other tools use ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s.`,
      status: "done",
    });
    // Insert markers for the current batch of tool calls
    for (let i = 0; i < executableToolCalls.length; i++) {
      const toolCall = executableToolCalls[i];
      const eventId = `tool-${iterations}-${i}-${toolCall.name}`;
      lastNonEmptyAssistantText += `\n\n<!-- mate-trace:${eventId} -->`;
    }

    emitProgress(lastNonEmptyAssistantText);

    const toolResults = await mapWithConcurrency(
      executableToolCalls,
      TOOL_BATCH_MAX_CONCURRENCY,
      (toolCall, toolIndex) =>
        executeAgentToolCall({
          toolCall,
          toolIndex,
          iteration: iterations,
          snapshot,
          events,
          emitProgress,
          appSettings,
          runId,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result) => result.toolExecution));

    if (
      cleanCurrentChangeReview &&
      toolResults.some((result) => isCleanGitDiffToolResult(result))
    ) {
      events.push({
        id: `step-clean-review-stop-${iterations}`,
        label: "Clean current-change review",
        detail: "Git diff confirms zero changed files, insertions, and deletions. Stopping without validation or extra inspection.",
        status: "done",
      });
      emitProgress();

      return {
        toolExecutions,
        content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
      };
    }

    for (const result of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.content,
      });
    }

    if (totalToolCalls >= runtime.maxToolCalls) {
      events.push({
        id: `step-budget-${iterations}`,
        label: "Tool budget reached",
        detail: `Collected ${totalToolCalls} tool call(s). Asking the model to conclude from the evidence.`,
        status: "done",
      });
      emitProgress();

      messages.push({
        role: "user",
        content:
          "You have enough evidence. Stop calling tools and provide the final answer grounded in the collected outputs.",
      });
    }
  }

  const forcedFinalText = await attemptFinalChatSynthesis({
    apiKey,
    model,
    messages,
    iterations,
    toolRounds,
    totalToolCalls,
    events,
    emitProgress,
  });

  const finalContentText = forcedFinalText
    ? lastNonEmptyAssistantText
      ? `${lastNonEmptyAssistantText}\n\n${forcedFinalText}`
      : forcedFinalText
    : lastNonEmptyAssistantText;

  return {
    toolExecutions,
    content: await finalizeContent(
      finalContentText ||
        buildNoContentFinalResponse({
          iterations,
          toolRounds,
          totalToolCalls,
          events,
        }),
    ),
  };
}

async function requestRainyResponsesAgenticResponse({
  apiKey,
  history,
  model,
  prompt,
  runtime,
  options,
  systemPrompt,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
}: {
  apiKey: string;
  history: string[];
  model: string;
  prompt: string;
  runtime: AgentRuntimeConfig;
  options: AssistantRunOptions;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
}) {
  const initialInput = buildResponsesMessageInput([
    ...buildHistoryMessages(history),
    { role: "user", content: prompt },
  ]);
  const responseTools = await toolService.getResponsesToolDefinitions();
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let previousResponseId: string | undefined;
  let nextInput = initialInput;
  let lastContent = "";
  let lastThought = "";
  const toolExecutions: ToolExecutionRecord[] = [];
  const finalizeContent = (finalContent: string) =>
    finalizeCriticLoop({
      apiKey,
      model,
      options,
      snapshot,
      events,
      toolExecutions,
      prompt,
      finalContent,
      emitProgress,
    });

  while (iterations < runtime.maxIterations) {
    iterations++;

    events.push({
      id: `step-agent-loop-${iterations}`,
      label: `Agent pass ${iterations}`,
      detail:
        iterations === 1
          ? "Starting the responses tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
    });
    emitProgress();

    const response = await requestRainyResponsesCompletion({
      apiKey,
      model,
      instructions: iterations === 1 ? systemPrompt : undefined,
      input: nextInput,
      previousResponseId,
      tools: responseTools,
      toolChoice:
        runtime.requireToolingFirst &&
        toolRounds < runtime.minToolRounds &&
        totalToolCalls < runtime.maxToolCalls
          ? "required"
          : totalToolCalls >= runtime.maxToolCalls
            ? "none"
            : "auto",
    });

    previousResponseId = response.id;
    const responseText = response.output_text || "";
    if (responseText.trim()) {
      lastContent += (lastContent ? "\n\n" : "") + responseText;
    }
    lastThought = extractResponseThought(response) || lastThought;
    emitProgress(lastContent, lastThought);

    const loopEvent = events.find(
      (event) => event.id === `step-agent-loop-${iterations}`,
    );
    const checkpoint = summarizeCheckpoint(response.output_text);
    if (loopEvent) {
      loopEvent.status = "done";
      loopEvent.detail = checkpoint
        ? `Checkpoint: ${checkpoint}`
        : `Pass ${iterations} completed.`;
      emitProgress();
    }

    const toolCalls = extractResponseFunctionCalls(response).map(
      (toolCall) => ({
        id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }),
    );

    if (toolCalls.length === 0) {
      if (
        toolRounds < runtime.minToolRounds &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-nudge-${iterations}`,
          label: "Continue investigation",
          detail: runtime.executionIntent
            ? "Model produced text for an execution request without running a tool. Requesting the required tool-backed pass."
            : "Model tried to conclude early. Requesting another tool-backed pass.",
          status: "done",
        });
        emitProgress();

        nextInput = [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: runtime.executionIntent
                  ? "The user asked you to perform an action. Do not answer with only text. Call the smallest appropriate tool now, then continue from the result."
                  : "Continue investigating with repository tools before answering. Gather more evidence, then conclude.",
              },
            ],
          },
        ];
        continue;
      }

      events.push({
        id: `step-agent-done-${iterations}`,
        label: "Response complete",
        detail: `Agent finished after ${iterations} passes, ${toolRounds} tool rounds, and ${totalToolCalls} tool calls.`,
        status: "done",
      });
      emitProgress();

      const forcedFinalText = response.output_text?.trim()
        ? ""
        : await attemptFinalResponsesSynthesis({
            apiKey,
            model,
            previousResponseId,
            iterations,
            toolRounds,
            totalToolCalls,
            events,
            emitProgress,
          });

      const finalContentText = forcedFinalText
        ? lastContent
          ? `${lastContent}\n\n${forcedFinalText}`
          : forcedFinalText
        : lastContent;

      return {
        thought: lastThought,
        toolExecutions,
        content: await finalizeContent(
          finalContentText ||
            "The model completed the tool loop without returning text.",
        ),
      };
    }

    toolRounds++;
    const remainingBudget = runtime.maxToolCalls - totalToolCalls;
    const currentChangeReview = isCurrentChangeReviewPrompt(prompt.toLowerCase());
    const cleanCurrentChangeReview = isCleanCurrentChangeReview(prompt, snapshot);
    const executableToolCalls = toolCalls.slice(
      0,
      Math.max(remainingBudget, 0),
    ).filter((toolCall) =>
      cleanCurrentChangeReview
        ? isAllowedCleanReviewToolCall(toolCall)
        : !currentChangeReview || isAllowedCurrentChangeReviewToolCall(toolCall),
    );

    if (executableToolCalls.length === 0) {
      if (cleanCurrentChangeReview) {
        events.push({
          id: `step-clean-review-stop-${iterations}`,
          label: "Clean current-change review",
          detail: "Git status/diff evidence shows no current changes. Stopping without extra inspection.",
          status: "done",
        });
        emitProgress();

        return {
          thought: lastThought,
          toolExecutions,
          content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
        };
      }

      if (currentChangeReview) {
        nextInput = [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extra tools outside current-change review scope were skipped. Synthesize the git diff and file-read evidence already collected; do not call more tools.",
              },
            ],
          },
        ];
        continue;
      }

      nextInput = [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Tool budget is exhausted. Synthesize the evidence you already collected and conclude.",
            },
          ],
        },
      ];
      continue;
    }

    events.push({
      id: `step-tool-batch-${iterations}`,
      label: `Tool batch ${toolRounds}`,
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent. sandbox_run may request 30/45/60/120/240s; other tools use ${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s.`,
      status: "done",
    });
    // Insert markers for the current batch of tool calls
    for (let i = 0; i < executableToolCalls.length; i++) {
      const toolCall = executableToolCalls[i];
      const eventId = `tool-${iterations}-${i}-${toolCall.name}`;
      lastContent += `\n\n<!-- mate-trace:${eventId} -->`;
    }

    emitProgress(lastContent);

    const toolResults = await mapWithConcurrency(
      executableToolCalls,
      TOOL_BATCH_MAX_CONCURRENCY,
      (toolCall, toolIndex) =>
        executeAgentToolCall({
          toolCall,
          toolIndex,
          iteration: iterations,
          snapshot,
          events,
          emitProgress,
          appSettings,
          runId,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result) => result.toolExecution));
    if (
      cleanCurrentChangeReview &&
      toolResults.some((result) => isCleanGitDiffToolResult(result))
    ) {
      events.push({
        id: `step-clean-review-stop-${iterations}`,
        label: "Clean current-change review",
        detail: "Git diff confirms zero changed files, insertions, and deletions. Stopping without validation or extra inspection.",
        status: "done",
      });
      emitProgress();

      return {
        thought: lastThought,
        toolExecutions,
        content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
      };
    }
    nextInput = toolResults.map((result) => ({
      type: "function_call_output" as const,
      call_id: result.toolCallId,
      output: result.content,
    }));

    if (totalToolCalls >= runtime.maxToolCalls) {
      nextInput.push({
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "You have enough evidence. Stop calling tools and provide the final answer grounded in the collected outputs.",
          },
        ],
      });

      events.push({
        id: `step-budget-${iterations}`,
        label: "Tool budget reached",
        detail: `Collected ${totalToolCalls} tool call(s). Asking the model to conclude from the evidence.`,
        status: "done",
      });
      emitProgress();
    }
  }

  const forcedFinalText = await attemptFinalResponsesSynthesis({
    apiKey,
    model,
    previousResponseId,
    iterations,
    toolRounds,
    totalToolCalls,
    events,
    emitProgress,
  });

  const finalContentText = forcedFinalText
    ? lastContent
      ? `${lastContent}\n\n${forcedFinalText}`
      : forcedFinalText
    : lastContent;

  return {
    thought: lastThought,
    toolExecutions,
    content: await finalizeContent(
      finalContentText ||
        "Maximum agent iterations reached without a final response.",
    ),
  };
}

export async function resolveDefaultRainyRuntimeConfig(
  apiKey: string,
  preferredStoredModel: string | null,
): Promise<{
  model: string;
  apiMode: "chat_completions" | "responses";
  capabilities?: RainyModelCapabilities;
  modelCatalogEntry?: RainyModelCatalogEntry;
} | null> {
  const preferredModels = [
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4-pro",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "anthropic/claude-sonnet-4.6",
  ];

  try {
    const catalog = await listRainyModels({ apiKey });
    if (catalog.length === 0) {
      return null;
    }

    const normalizedStoredModel = preferredStoredModel?.trim() ?? "";
    const findEntry = (modelId: string) =>
      catalog.find((item) => item.id === modelId);
    const pickApiMode = (modelId: string): "chat_completions" | "responses" =>
      resolvePreferredRainyApiMode(modelId, findEntry(modelId));
    const resolveConfig = (modelId: string) => ({
      model: modelId,
      apiMode: pickApiMode(modelId),
      capabilities: findEntry(modelId)?.capabilities,
      modelCatalogEntry: findEntry(modelId),
    });

    if (
      normalizedStoredModel &&
      catalog.some((entry) => entry.id === normalizedStoredModel)
    ) {
      return resolveConfig(normalizedStoredModel);
    }

    for (const preferredModel of preferredModels) {
      if (catalog.some((entry) => entry.id === preferredModel)) {
        return resolveConfig(preferredModel);
      }
    }

    const fallbackModel = catalog[0]?.id;
    if (!fallbackModel) {
      return null;
    }

    return resolveConfig(fallbackModel);
  } catch {
    return null;
  }
}

function resolveRainyMaxTokensForMessages(
  modelCatalogEntry: RainyModelCatalogEntry | undefined,
  messages: Array<{ content?: unknown }>,
  tokenEstimator: { estimateTokens: (text: string) => number },
) {
  if (!modelCatalogEntry) {
    return undefined;
  }

  const explicitOutputLimit = firstFiniteNumber(
    modelCatalogEntry.perRequestLimits?.max_completion_tokens,
    modelCatalogEntry.perRequestLimits?.max_output_tokens,
    modelCatalogEntry.perRequestLimits?.completion_tokens,
    modelCatalogEntry.perRequestLimits?.output_tokens,
    modelCatalogEntry.topProvider?.max_completion_tokens,
    modelCatalogEntry.topProvider?.max_tokens,
  );
  const contextLength = modelCatalogEntry.contextLength;
  const promptTokens = estimateChatMessagesTokens(messages, tokenEstimator);
  const remainingContext =
    typeof contextLength === "number" && Number.isFinite(contextLength)
      ? Math.max(1, Math.floor(contextLength - promptTokens))
      : undefined;

  if (explicitOutputLimit === undefined) {
    return undefined;
  }

  return remainingContext === undefined
    ? explicitOutputLimit
    : Math.min(explicitOutputLimit, remainingContext);
}

function estimateChatMessagesTokens(
  messages: Array<{ content?: unknown }>,
  tokenEstimator: { estimateTokens: (text: string) => number },
) {
  return messages.reduce((total, message) => {
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    return total + tokenEstimator.estimateTokens(content);
  }, 0);
}

function firstFiniteNumber(...values: Array<number | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function resolveRainyReasoningPayload(
  options: AssistantRunOptions,
  capabilities?: RainyModelCapabilities,
): {
  reasoning?: { exclude?: true; effort?: string };
  includeReasoning?: boolean;
} {
  if (!options.reasoningEnabled || !supportsReasoning(capabilities)) {
    return {};
  }

  const accepted = getAcceptedParameters(capabilities);
  const canSendReasoning = accepted.includes("reasoning");
  const canIncludeReasoning = accepted.includes("include_reasoning");
  const effortValues = getReasoningEffortValues(capabilities);
  const canSendEffort = effortValues.includes(options.reasoning);

  return {
    reasoning: canSendReasoning
      ? canSendEffort
        ? { effort: options.reasoning }
        : {}
      : undefined,
    includeReasoning: canIncludeReasoning,
  };
}
