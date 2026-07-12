import { listRainyModels, resolvePreferredRainyApiMode } from "../../rainy-service";
import { getAcceptedParameters, getReasoningEffortValues, supportsReasoning } from "../../../lib/rainy-model-capabilities";
import type { AssistantRunOptions } from "../../../contracts/chat";
import type { RainyModelCapabilities, RainyModelCatalogEntry } from "../../../contracts/rainy";
import type { AgentRuntimeConfig } from "./types";
import { isExecutionIntentPrompt } from "./helpers";

export const TOOL_BATCH_MAX_CONCURRENCY = 8;
export const TOOL_EXECUTION_TIMEOUT_MS = 20_000;
export const SANDBOX_RUN_ALLOWED_TIMEOUT_SECONDS = new Set([30, 45, 60, 120, 240]);
export const TOOL_TIMEOUT_GRACE_MS = 5_000;

export function buildAgentRuntimeConfig(
  options: AssistantRunOptions,
  prompt = "",
): AgentRuntimeConfig {
  const pathKind = options.pathKind ?? "full";
  const executionIntent =
    (pathKind === "full" || pathKind === "verify_only") &&
    isExecutionIntentPrompt(prompt);
  const requireToolingFirst = executionIntent;
  const minToolRounds = executionIntent ? 1 : 0;
  const planLikeMode = pathKind === "chat_help";

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

export function resolveToolExecutionTimeoutMs(
  toolName: string,
  args: Record<string, unknown>,
): number {
  if (toolName !== "sandbox_run") {
    return TOOL_EXECUTION_TIMEOUT_MS;
  }

  const timeoutSeconds = Number(args.timeoutSeconds);
  if (!SANDBOX_RUN_ALLOWED_TIMEOUT_SECONDS.has(timeoutSeconds)) {
    return 30_000 + TOOL_TIMEOUT_GRACE_MS;
  }

  return timeoutSeconds * 1000 + TOOL_TIMEOUT_GRACE_MS;
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
      catalog.find((item: RainyModelCatalogEntry) => item.id === modelId);
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
      catalog.some((entry: RainyModelCatalogEntry) => entry.id === normalizedStoredModel)
    ) {
      return resolveConfig(normalizedStoredModel);
    }

    for (const preferredModel of preferredModels) {
      if (catalog.some((entry: RainyModelCatalogEntry) => entry.id === preferredModel)) {
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

export function resolveRainyMaxTokensForMessages(
  modelCatalogEntry: RainyModelCatalogEntry | undefined,
  messages: Array<{ content?: unknown }>,
  tokenEstimator: { estimateTokens: (text: string) => number },
): number | undefined {
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

export function estimateChatMessagesTokens(
  messages: Array<{ content?: unknown }>,
  tokenEstimator: { estimateTokens: (text: string) => number },
): number {
  return messages.reduce((total, message) => {
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    return total + tokenEstimator.estimateTokens(content);
  }, 0);
}

export function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

export function resolveRainyReasoningPayload(
  options: AssistantRunOptions,
  capabilities?: RainyModelCapabilities,
): {
  reasoning?: { exclude?: true; effort?: string; enabled?: boolean };
  includeReasoning?: boolean;
  reasoningEffort?: string;
} {
  if (!options.reasoningEnabled || !supportsReasoning(capabilities)) {
    return {};
  }

  const accepted = getAcceptedParameters(capabilities);
  const canSendReasoning = accepted.includes("reasoning");
  const canIncludeReasoning = accepted.includes("include_reasoning");
  const canSendReasoningEffort = accepted.includes("reasoning_effort");
  const effortValues = getReasoningEffortValues(capabilities);
  const canSendEffort = effortValues.includes(options.reasoning);
  const effort = canSendEffort ? options.reasoning : undefined;

  return {
    reasoning: canSendReasoning
      ? effort
        ? { effort }
        : { enabled: true }
      : undefined,
    includeReasoning: canIncludeReasoning,
    // Top-level Rainy/provider field when accepted — never invent reasoning_pro.
    reasoningEffort: canSendReasoningEffort && effort ? effort : undefined,
  };
}
