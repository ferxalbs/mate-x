import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentOutcome, AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import type { ExecutionSynthesisStatus } from "../../../contracts/execution";
import type { AppSettings } from "../../../contracts/settings";
import {
  buildResponsesMessageInput,
  extractResponseFunctionCalls,
  requestRainyResponsesCompletion,
  resolveRainyAgentTimeoutMs,
} from "../../rainy-service";
import { compressResponsesInputItems } from "../../context-compression";
import { toolService } from "../../tool-service";
import type { AgentToolCall } from "./types";
import {
  buildAgentRuntimeConfig,
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
  executeToolBatchWithSafety,
  normalizeAssistantText,
  summarizeCheckpoint,
  selectFinalAssistantText,
} from "./helpers";
import { executeAgentToolCall } from "./tool-executor";
import { finalizeCriticLoop } from "./critic";
import { attemptFinalResponsesSynthesis } from "./synthesis";
import { resolveAdvertisedToolNames } from "../../capability-resolver";
import { sanitizePublicProgress } from "../../../lib/assistant-output";
import {
  createModelToolsUnavailableResult,
  createProviderFailurePublicEvent,
  createProviderFailureResult,
  isModelToolsUnavailableError,
  recordProviderFailure,
} from "./model-tools-unavailable";

export async function requestRainyResponsesAgenticResponse({
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
  serviceTier,
  signal,
  engineeringTaskStatus,
  planningPhase,
}: {
  apiKey: string;
  history: string[];
  model: string;
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
  planningPhase?: boolean;
}): Promise<{
  toolExecutions: ToolExecutionRecord[];
  content: string;
  synthesisStatus: ExecutionSynthesisStatus;
  synthesisSummary?: string;
  outcome?: AgentOutcome;
}> {
  void planningPhase;
  const initialInput = buildResponsesMessageInput([
    ...buildHistoryMessages(history),
    { role: "user", content: prompt },
  ]);
  const responseTools = await toolService.getResponsesToolDefinitions({
    names: resolveAdvertisedToolNames(options.behaviorMode),
  });
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let previousResponseId: string | undefined;
  let nextInput = initialInput;
  let lastContent = "";
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
          ? "Starting the responses tool loop."
          : `Continuing agent loop after ${toolRounds} tool round(s).`,
      status: "active",
    });
    emitProgress();

    // Truncate large function_call_output items before the next Responses turn
    // (chat path has applyContextCompressionChat; Responses needs local parity).
    if (Array.isArray(nextInput)) {
      nextInput = compressResponsesInputItems(nextInput);
    }

    let response: Awaited<ReturnType<typeof requestRainyResponsesCompletion>>;
    try {
      response = await requestRainyResponsesCompletion({
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
        serviceTier,
        signal,
        timeoutMs: resolveRainyAgentTimeoutMs({
          reasoningEnabled: options.reasoningEnabled,
          reasoning: options.reasoning,
        }),
        requireTools: runtime.executionIntent,
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

    previousResponseId = response.id;
    const responseText = normalizeAssistantText(response.output_text);
    if (responseText.trim()) {
      // Keep intermediate drafts in the event trace, not in the final answer.
      lastContent = responseText.trim();
    }
    emitProgress(lastContent);

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

    const toolCalls = extractResponseFunctionCalls(response).map(
      (toolCall: any) => ({
        id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }),
    );
    if (
      !planningPhase &&
      runtime.requireToolingFirst &&
      toolRounds < runtime.minToolRounds &&
      toolCalls.length === 0
    ) {
      return createModelToolsUnavailableResult(toolExecutions);
    }
    if (responseText.trim()) {
      events.push({
        id: `${passId}:response`, segmentId: `${passId}:response`, passId, runId,
        segmentKind: toolCalls.length ? "intermediate_response" : "final_response",
        type: "result", label: toolCalls.length ? `Agent pass ${iterations} response` : "Final response",
        detail: sanitizePublicProgress(responseText), status: "completed",
        visibility: "public",
      });
      emitProgress();
    }

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

      const synthesis = responseText
        ? { text: responseText, status: "valid" as const }
        : await attemptFinalResponsesSynthesis({
            apiKey,
            model,
            previousResponseId,
            iterations,
            toolRounds,
            totalToolCalls,
            serviceTier,
            events,
            emitProgress,
          });

      const finalContentText = selectFinalAssistantText(lastContent, synthesis.text);

      return {
        toolExecutions,
        synthesisStatus: synthesis.status,
        synthesisSummary: synthesis.summary,
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
    const buildRejectedToolResults = () =>
      rejectedToolCalls.map((toolCall: AgentToolCall) => ({
        type: "function_call_output" as const,
        call_id: toolCall.id,
        output: rejectedToolCallContent(toolCall),
      }));

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

      if (currentChangeReview) {
        nextInput = [
          ...buildRejectedToolResults(),
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
        ...buildRejectedToolResults(),
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
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent. Timeouts are per-tool (sandbox_run 30/45/60/120/240s; analysis tools longer; default ~${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s).`,
      status: "done",
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
    nextInput = toolCalls.map((toolCall: AgentToolCall) => {
      const result = toolResultsByCallId.get(toolCall.id) as any;
      return {
        type: "function_call_output" as const,
        call_id: toolCall.id,
        output: result?.content ?? rejectedToolCallContent(toolCall),
      };
    });

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

  const synthesis = await attemptFinalResponsesSynthesis({
    apiKey,
    model,
    previousResponseId,
    iterations,
    toolRounds,
    totalToolCalls,
    serviceTier,
    events,
    emitProgress,
  });

  const finalContentText = selectFinalAssistantText(lastContent, synthesis.text);

  return {
    toolExecutions,
    synthesisStatus: synthesis.status,
    synthesisSummary: synthesis.summary,
    content: await finalizeContent(
      finalContentText ||
        "Maximum agent iterations reached without a final response.",
    ),
  };
}
