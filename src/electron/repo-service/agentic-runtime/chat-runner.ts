import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import type { RainyModelCapabilities, RainyModelCatalogEntry } from "../../../contracts/rainy";
import type { AppSettings } from "../../../contracts/settings";
import {
  requestRainyChatCompletionStream,
  resolveRainyAgentTimeoutMs,
} from "../../rainy-service";
import { toolService } from "../../tool-service";
import { createTokenEstimator } from "../../token-estimator";
import { repoGraphService } from "../../repo-graph-service";
import { failureMemoryEngine } from "../../failure-memory-engine";
import { renderTrustContractForPrompt } from "../../workspace-trust";
import { renderWorkingSetForPrompt } from "../../working-set-compiler";
import { renderWorkPlanForPrompt } from "../../work-engine/work-engine";
import { renderFailureMemoryInstruction } from "../../work-engine/failure-memory-gate";
import { MATE_AGENT_SYSTEM_PROMPT } from "../../../config/mate-agent";
import { renderRunbookForPrompt } from "../../assistant-runbooks";
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
  isRainyConnectionTimeout,
  isPreparatoryAssistantText,
  executeToolBatchWithSafety,
  normalizeAssistantText,
  summarizeCheckpoint,
  buildTimeoutFinalResponse,
  buildNoContentFinalResponse,
  buildChatUserContent,
  appendAssistantPass,
} from "./helpers";
import { executeAgentToolCall } from "./tool-executor";
import { finalizeCriticLoop } from "./critic";
import { attemptFinalChatSynthesis } from "./synthesis";

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
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
  serviceTier?: AssistantRunOptions["serviceTier"];
  signal?: AbortSignal;
  engineeringTaskStatus?: import("../../../contracts/engineering-task").EngineeringTaskStatus | null;
  planningPhase?: boolean;
}): Promise<{
  toolExecutions: ToolExecutionRecord[];
  content: string;
}> {
  const historyMessages = buildHistoryMessages(history);
  const rainyReasoning = resolveRainyReasoningPayload(options, capabilities);
  let messages: any[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: buildChatUserContent(prompt, options.attachments) },
  ];
  // Full catalog: capable models choose tools; system prompt steers preference.
  const chatTools = await toolService.getChatToolDefinitions();
  const tokenEstimator = createTokenEstimator(model);
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let lastNonEmptyAssistantText = "";
  const toolExecutions: ToolExecutionRecord[] = [];

  const { applyContextCompressionChat } = await import("../../context-compression");

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

  // Reference these unused imports dynamically or declare them so linter is happy
  if (process.env.DEBUG_MATE_RUNTIME === "true") {
    console.debug(
      repoGraphService,
      failureMemoryEngine,
      renderTrustContractForPrompt,
      renderWorkingSetForPrompt,
      renderWorkPlanForPrompt,
      renderFailureMemoryInstruction,
      MATE_AGENT_SYSTEM_PROMPT,
      renderRunbookForPrompt,
    );
  }

  while (iterations < runtime.maxIterations) {
    iterations++;
    const passId = `${runId}:pass:${iterations}`;
    const reasoningSegment: ToolEvent = {
      id: `${passId}:reasoning`,
      segmentId: `${passId}:reasoning`,
      passId,
      runId,
      segmentKind: "reasoning",
      type: "reasoning",
      label: `Reasoning pass ${iterations}`,
      detail: "",
      status: "active",
    };
    events.push(reasoningSegment);

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
    );

    const maxTokens = resolveRainyMaxTokensForMessages(
      modelCatalogEntry,
      messages,
      tokenEstimator,
    );
    let streamedPassText = "";
    let streamedThought = "";
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
        includeReasoning: rainyReasoning.includeReasoning,
        reasoningEffort: rainyReasoning.reasoningEffort,
        capabilities,
        maxTokens,
        serviceTier,
        signal,
        timeoutMs: resolveRainyAgentTimeoutMs({
          reasoningEnabled: options.reasoningEnabled,
          reasoning: options.reasoning,
        }),
        onReasoningDelta: (delta: string) => {
          streamedThought += delta;
          reasoningSegment.detail += delta;
          emitProgress(
            lastNonEmptyAssistantText
              ? `${lastNonEmptyAssistantText}\n\n${streamedPassText}`
              : streamedPassText || undefined,
            streamedThought,
          );
        },
        onContentDelta: (delta: string) => {
          streamedPassText += delta;
          emitProgress(
            lastNonEmptyAssistantText
              ? `${lastNonEmptyAssistantText}\n\n${streamedPassText}`
              : streamedPassText,
            streamedThought || undefined,
          );
        },
      });
    } catch (error) {
      if (!isRainyConnectionTimeout(error)) {
        throw error;
      }

      const partialText = [lastNonEmptyAssistantText, streamedPassText]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      events.push({
        id: `step-agent-timeout-${iterations}`,
        label: "Rainy timeout recovery",
        detail:
          error instanceof Error
            ? `${error.name || "Error"}: ${error.message}. Returned partial local synthesis.`
            : "Rainy request timed out. Returned partial local synthesis.",
        status: "error",
      });
      emitProgress(partialText || undefined, streamedThought || undefined);

      return {
        toolExecutions,
        content: await finalizeContent(
          buildTimeoutFinalResponse({
            iterations,
            toolRounds,
            totalToolCalls,
            events,
            lastText: partialText,
          }),
        ),
      };
    }

    reasoningSegment.status = "completed";
    if (!reasoningSegment.detail.trim()) {
      const index = events.indexOf(reasoningSegment);
      if (index >= 0) events.splice(index, 1);
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
    if (responseText.trim()) {
      events.push({
        id: `${passId}:response`,
        segmentId: `${passId}:response`,
        passId,
        runId,
        segmentKind: toolCalls?.length ? "intermediate_response" : "final_response",
        type: "result",
        label: toolCalls?.length ? `Agent pass ${iterations} response` : "Final response",
        detail: responseText,
        status: "completed",
      });
      lastNonEmptyAssistantText = appendAssistantPass(lastNonEmptyAssistantText, responseText);
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

      const forcedFinalText = responseText.trim()
        ? ""
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
          autonomyPolicy: options.autonomyPolicy,
        }),
    );

    totalToolCalls += toolResults.length;
    toolExecutions.push(...toolResults.map((result: any) => result.toolExecution));

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

  const forcedFinalText = await attemptFinalChatSynthesis({
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
