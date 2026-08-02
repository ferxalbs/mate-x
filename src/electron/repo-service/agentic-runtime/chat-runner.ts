import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentOutcome, AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import type { ExecutionSynthesisStatus } from "../../../contracts/execution";
import type { RainyModelCapabilities, RainyModelCatalogEntry } from "../../../contracts/rainy";
import type { AppSettings } from "../../../contracts/settings";
import {
  requestRainyChatCompletionStream,
  resolveRainyAgentTimeoutMs,
} from "../../rainy-service";
import { toolService } from "../../tool-service";
import { createTokenEstimator } from "../../token-estimator";
import { applyContextCompressionChat } from "../../context-compression";
import type { AgentToolCall } from "./types";
import {
  buildAgentRuntimeConfig,
  resolveRainyReasoningPayload,
  resolveRainyMaxTokensForMessages,
  TOOL_BATCH_MAX_CONCURRENCY,
  TOOL_EXECUTION_TIMEOUT_MS,
} from "./config";
import {
  buildCleanCurrentChangeReviewAnswer,
  buildHistoryMessages,
  isAllowedCleanReviewToolCall,
  isAllowedCurrentChangeReviewToolCall,
  isCleanCurrentChangeReview,
  isCleanGitDiffToolResult,
  isCurrentChangeReviewPrompt,
  isPreparatoryAssistantText,
  executeToolBatchWithSafety,
  normalizeAssistantText,
  sanitizeAssistantOutput,
  summarizeCheckpoint,
  buildNoContentFinalResponse,
  buildChatUserContent,
  selectFinalAssistantText,
} from "./helpers";
import { executeAgentToolCall } from "./tool-executor";
import { finalizeCriticLoop } from "./critic";
import { attemptFinalChatSynthesis } from "./synthesis";
import { resolveAdvertisedToolNames } from "../../capability-resolver";
import type { WorkStrategy } from "../../../contracts/work-objective";
import { sanitizePublicProgress } from "../../../lib/assistant-output";
import {
  createModelToolsUnavailableResult,
  createProviderFailurePublicEvent,
  createProviderFailureResult,
  isModelToolsUnavailableError,
  recordProviderFailure,
} from "./model-tools-unavailable";

export async function requestRainyChatAgenticResponse({
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
  serviceTier,
  signal,
  engineeringTaskStatus,
  workStrategy,
  planningPhase,
}: {
  apiKey: string;
  history: string[];
  model: string;
  capabilities?: RainyModelCapabilities;
  modelCatalogEntry?: RainyModelCatalogEntry;
  prompt: string;
  runtime: ReturnType<typeof buildAgentRuntimeConfig>;
  options: AssistantRunOptions;
  systemPrompt: string;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: (content?: string) => void;
  appSettings: AppSettings;
  runId: string;
  serviceTier?: AssistantRunOptions["serviceTier"];
  signal?: AbortSignal;
  engineeringTaskStatus?: import("../../../contracts/engineering-task").EngineeringTaskStatus | null;
  workStrategy?: WorkStrategy;
  planningPhase?: boolean;
}): Promise<{
  toolExecutions: ToolExecutionRecord[];
  content: string;
  synthesisStatus: ExecutionSynthesisStatus;
  synthesisSummary?: string;
  outcome?: AgentOutcome;
}> {
  const historyMessages = buildHistoryMessages(history);
  const rainyReasoning = resolveRainyReasoningPayload(options, capabilities);
  let messages: any[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: buildChatUserContent(prompt, options.attachments) },
  ];
  const chatTools = await toolService.getChatToolDefinitions({
    names: resolveAdvertisedToolNames(options.behaviorMode, workStrategy),
  });
  const tokenEstimator = createTokenEstimator(model);
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let lastNonEmptyAssistantText = "";
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
      serviceTier,
    });

  while (iterations < runtime.maxIterations) {
    iterations++;
    const passId = `${runId}:pass:${iterations}`;
    events.push({
      id: `step-agent-loop-${iterations}`,
      label: `Agent pass ${iterations}`,
      detail:
        iterations === 1
          ? "Starting the chat-completions tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
      segmentKind: "tool",
      visibility: "technical",
    });
    emitProgress();

    messages = await applyContextCompressionChat(
      messages,
      tokenEstimator,
      apiKey,
      model,
      events,
      emitProgress,
      modelCatalogEntry?.effectiveContextLength ??
        modelCatalogEntry?.contextLength,
    );

    const maxTokens = resolveRainyMaxTokensForMessages(
      modelCatalogEntry,
      messages,
      tokenEstimator,
    );
    let streamedPassText = "";
    let responseMessage: Awaited<ReturnType<typeof requestRainyChatCompletionStream>>;
    try {
      responseMessage = await requestRainyChatCompletionStream({
        apiKey,
        messages,
        model,
        tools: chatTools,
        toolChoice:
          totalToolCalls >= runtime.maxToolCalls
            ? "none"
            : runtime.requireToolingFirst &&
                toolRounds < runtime.minToolRounds &&
                totalToolCalls < runtime.maxToolCalls
              ? "required"
              : undefined,
        reasoning: rainyReasoning.reasoning,
        includeReasoning: false,
        reasoningEffort: rainyReasoning.reasoningEffort,
        capabilities,
        maxTokens,
        serviceTier,
        signal,
        timeoutMs: resolveRainyAgentTimeoutMs({
          reasoningEnabled: options.reasoningEnabled,
          reasoning: options.reasoning,
        }),
        requireTools: runtime.executionIntent,
        onContentDelta: (delta: string) => {
          streamedPassText += delta;
          const visibleStream = sanitizeAssistantOutput(streamedPassText);
          emitProgress(
            lastNonEmptyAssistantText
              ? [lastNonEmptyAssistantText, visibleStream].filter(Boolean).join("\n\n")
              : visibleStream,
          );
        },
      });
    } catch (error) {
      const loopEvent = events.find(
        (event) => event.id === `step-agent-loop-${iterations}`,
      );
      if (loopEvent) {
        loopEvent.status = "failed";
        loopEvent.detail = "Provider request failed before this agent pass completed.";
      }
      recordProviderFailure(runId, error, iterations);
      const failureResult = isModelToolsUnavailableError(error)
        ? createModelToolsUnavailableResult(toolExecutions)
        : createProviderFailureResult(toolExecutions, error);
      events.push(createProviderFailurePublicEvent({
        runId,
        attempt: iterations,
        summary: failureResult.content,
      }));
      emitProgress();
      return failureResult;
    }

    messages.push(responseMessage);
    const toolCalls = responseMessage.tool_calls
      ?.filter((toolCall) => toolCall.type === "function")
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      }));

    const responseText = normalizeAssistantText(responseMessage.content);
    if (
      !planningPhase &&
      runtime.requireToolingFirst &&
      toolRounds < runtime.minToolRounds &&
      (!toolCalls || toolCalls.length === 0)
    ) {
      return createModelToolsUnavailableResult(toolExecutions);
    }
    if (responseText.trim()) {
      events.push({
        id: `${passId}:response`,
        segmentId: `${passId}:response`,
        passId,
        runId,
        segmentKind: toolCalls?.length ? "intermediate_response" : "final_response",
        type: "result",
        label: toolCalls?.length ? `Agent pass ${iterations} response` : "Final response",
        detail: sanitizePublicProgress(responseText),
        status: "completed",
        visibility: "public",
      });
      // Intermediate pass text is already preserved in events. Keep only the
      // latest draft visible so final output cannot accumulate repeated drafts.
      lastNonEmptyAssistantText = responseText.trim();
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
      // Planning / pre-approval phases may legitimately return specification and plan text.
      // Do not reject preparatory prose in those phases (final execution still rejects it).
      if (
        !planningPhase &&
        isPreparatoryAssistantText(responseText) &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-preparatory-nudge-${iterations}`,
          label: "Preparatory answer rejected",
          detail: "Model returned a plan/progress note without tool evidence. Requesting actual repository tool use.",
          status: "done",
          segmentKind: "tool",
          visibility: "technical",
        });
        emitProgress();

        messages.push({
          role: "user",
          content:
            "You described what you will inspect, but you did not call any tools. Call the smallest appropriate repository tools now. Do not provide another progress-only answer.",
        });
        continue;
      }

      if (
        toolRounds < runtime.minToolRounds &&
        iterations < runtime.maxIterations &&
        totalToolCalls < runtime.maxToolCalls
      ) {
        events.push({
          id: `step-agent-nudge-${iterations}`,
          label: "Continue investigation",
          segmentKind: "tool",
          visibility: "technical",
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
        segmentKind: "tool",
        visibility: "technical",
      });
      emitProgress();

      const synthesis = responseText.trim()
        ? { text: responseText.trim(), status: "valid" as const }
        : await attemptFinalChatSynthesis({
            apiKey,
            model,
            messages,
            iterations,
            toolRounds,
            totalToolCalls,
            serviceTier,
            events,
            emitProgress,
          });

      const finalContentText = selectFinalAssistantText(
        lastNonEmptyAssistantText,
        synthesis.text,
      );

      return {
        toolExecutions,
        synthesisStatus: synthesis.status,
        synthesisSummary: synthesis.summary,
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
    const budgetedToolCalls = toolCalls.slice(
      0,
      Math.max(remainingBudget, 0),
    );
    const executableToolCalls = budgetedToolCalls.filter((toolCall: AgentToolCall) =>
      cleanCurrentChangeReview
        ? isAllowedCleanReviewToolCall(toolCall)
        : !currentChangeReview || isAllowedCurrentChangeReviewToolCall(toolCall),
    );
    const executableToolCallIds = new Set(
      executableToolCalls.map((toolCall: AgentToolCall) => toolCall.id),
    );
    const rejectedToolCalls = toolCalls.filter(
      (toolCall: AgentToolCall) => !executableToolCallIds.has(toolCall.id),
    );
    const rejectedToolCallContent = (toolCall: AgentToolCall) =>
      currentChangeReview
        ? `Tool ${toolCall.name} was not executed because it is outside current-change review scope.`
        : `Tool ${toolCall.name} was not executed because the tool-call budget is exhausted.`;
    const appendRejectedToolResults = () => {
      for (const toolCall of rejectedToolCalls) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: rejectedToolCallContent(toolCall),
        });
      }
    };

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
          synthesisStatus: "valid",
          content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
        };
      }

      appendRejectedToolResults();
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
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent. Timeouts are per-tool (sandbox_run 30/45/60/120/240s; analysis tools longer; default ~${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s).`,
      status: "done",
      segmentKind: "tool",
      visibility: "technical",
    });
    emitProgress();

    const toolResults = await executeToolBatchWithSafety(
      executableToolCalls,
      TOOL_BATCH_MAX_CONCURRENCY,
      (toolCall: AgentToolCall, toolIndex: number) =>
        executeAgentToolCall({
          toolCall,
          toolIndex,
          iteration: iterations,
          snapshot,
          events,
          emitProgress,
          appSettings,
          runId,
          engineeringTaskStatus,
          behaviorMode: options.behaviorMode,
          workStrategy,
          signal,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result: any) => ({
      ...result.toolExecution,
      executionPolicy: result.executionPolicy,
    })));
    const terminalOutcome = toolResults.find(
      (result: {
        outcome?: AgentOutcome;
        executionPolicy?: { failureDisposition?: string };
      }) =>
        result.executionPolicy?.failureDisposition !== "continue" &&
        (result.outcome?.status === "blocked" ||
          result.outcome?.status === "failed"),
    )?.outcome;
    if (terminalOutcome) {
      return {
        toolExecutions,
        synthesisStatus:
          terminalOutcome.status === "failed" ? "failed" : "valid",
        synthesisSummary: terminalOutcome.summary,
        content: terminalOutcome.summary,
        outcome: terminalOutcome,
      };
    }

    if (
      cleanCurrentChangeReview &&
      toolResults.some((result: any) => isCleanGitDiffToolResult(result))
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
        synthesisStatus: "valid",
        content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
      };
    }

    const toolResultsByCallId = new Map(
      toolResults.map((result: any) => [result.toolCallId, result]),
    );
    for (const toolCall of toolCalls) {
      const result = toolResultsByCallId.get(toolCall.id) as any;
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result?.content ?? rejectedToolCallContent(toolCall),
      });
    }

    if (totalToolCalls >= runtime.maxToolCalls) {
      events.push({
        id: `step-budget-${iterations}`,
        label: "Tool budget reached",
        detail: `Collected ${totalToolCalls} tool call(s). Asking the model to conclude from the evidence.`,
        status: "done",
        segmentKind: "tool",
        visibility: "technical",
      });
      emitProgress();

      messages.push({
        role: "user",
        content:
          "You have enough evidence. Stop calling tools and provide the final answer grounded in the collected outputs.",
      });
    }
  }

  const synthesis = await attemptFinalChatSynthesis({
    apiKey,
    model,
    messages,
    iterations,
    toolRounds,
    totalToolCalls,
    serviceTier,
    events,
    emitProgress,
  });

  const finalContentText = selectFinalAssistantText(
    lastNonEmptyAssistantText,
    synthesis.text,
  );

  return {
    toolExecutions,
    synthesisStatus: synthesis.status,
    synthesisSummary: synthesis.summary,
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
