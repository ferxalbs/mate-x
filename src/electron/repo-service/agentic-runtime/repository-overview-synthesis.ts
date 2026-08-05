import type { AssistantRunOptions } from "../../../contracts/chat";
import type {
  RainyApiMode,
  RainyModelCapabilities,
} from "../../../contracts/rainy";
import {
  buildResponsesMessageInput,
  requestRainyChatCompletionStream,
  requestRainyResponsesCompletion,
  resolveRainyAgentTimeoutMs,
} from "../../rainy-service";
import { resolveRainyReasoningPayload } from "./config";
import { buildHistoryMessages, normalizeAssistantText } from "./helpers";

export async function requestRepositoryOverviewSynthesis(input: {
  apiKey: string;
  apiMode: RainyApiMode;
  capabilities?: RainyModelCapabilities;
  history: string[];
  model: string;
  options: AssistantRunOptions;
  promptWithEvidence: string;
  systemPrompt: string;
  emitProgress: (content?: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const timeoutMs = resolveRainyAgentTimeoutMs({
    reasoningEnabled: input.options.reasoningEnabled,
    reasoning: input.options.reasoning,
  });
  const serviceTier = input.options.serviceTier;

  if (input.apiMode === "responses") {
    const response = await requestRainyResponsesCompletion({
      apiKey: input.apiKey,
      model: input.model,
      instructions: input.systemPrompt,
      input: buildResponsesMessageInput([
        ...buildHistoryMessages(input.history),
        { role: "user", content: input.promptWithEvidence },
      ]),
      toolChoice: "none",
      serviceTier,
      signal: input.signal,
      timeoutMs,
    });
    const content = normalizeAssistantText(response.output_text);
    input.emitProgress(content);
    return content;
  }

  const rainyReasoning = resolveRainyReasoningPayload(
    input.options,
    input.capabilities,
  );
  let content = "";
  await requestRainyChatCompletionStream({
    apiKey: input.apiKey,
    model: input.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      ...buildHistoryMessages(input.history),
      { role: "user", content: input.promptWithEvidence },
    ],
    toolChoice: "none",
    reasoning: rainyReasoning.reasoning,
    includeReasoning: false,
    reasoningEffort: rainyReasoning.reasoningEffort,
    capabilities: input.capabilities,
    serviceTier,
    signal: input.signal,
    timeoutMs,
    onContentDelta(delta) {
      content += delta;
      input.emitProgress(content);
    },
  });
  return normalizeAssistantText(content);
}
