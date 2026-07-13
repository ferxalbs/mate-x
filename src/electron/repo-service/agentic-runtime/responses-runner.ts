import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import type { AppSettings } from "../../../contracts/settings";
import { buildResponsesMessageInput, extractResponseThought, extractResponseFunctionCalls, requestRainyResponsesCompletion } from "../../rainy-service";
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
  mapWithConcurrency,
  summarizeCheckpoint,
  appendAssistantPass,
} from "./helpers";
import { executeAgentToolCall } from "./tool-executor";
import { finalizeCriticLoop } from "./critic";
import { attemptFinalResponsesSynthesis } from "./synthesis";

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
  planningPhase: _planningPhase,
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
  emitProgress: (content?: string, thought?: string) => void;
  appSettings: AppSettings;
  runId: string;
  serviceTier?: AssistantRunOptions["serviceTier"];
  signal?: AbortSignal;
  engineeringTaskStatus?: import("../../../contracts/engineering-task").EngineeringTaskStatus | null;
  planningPhase?: boolean;
}): Promise<{
  thought?: string;
  toolExecutions: ToolExecutionRecord[];
  content: string;
}> {
  void _planningPhase;
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
      serviceTier,
      signal,
    });

    previousResponseId = response.id;
    const responseText = response.output_text || "";
    const responseThought = extractResponseThought(response);
    if (responseThought) {
      events.push({
        id: `${passId}:reasoning`, segmentId: `${passId}:reasoning`, passId, runId,
        segmentKind: "reasoning", type: "reasoning", label: `Reasoning pass ${iterations}`,
        detail: responseThought, status: "completed",
      });
    }
    if (responseText.trim()) {
      lastContent = appendAssistantPass(lastContent, responseText);
    }
    lastThought = responseThought || lastThought;
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
      (toolCall: any) => ({
        id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }),
    );
    if (responseText.trim()) {
      events.push({
        id: `${passId}:response`, segmentId: `${passId}:response`, passId, runId,
        segmentKind: toolCalls.length ? "intermediate_response" : "final_response",
        type: "result", label: toolCalls.length ? `Agent pass ${iterations} response` : "Final response",
        detail: responseText, status: "completed",
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

      const forcedFinalText = response.output_text?.trim()
        ? ""
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
    ).filter((toolCall: AgentToolCall) =>
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
      detail: `Executing ${executableToolCalls.length} tool call(s), up to ${TOOL_BATCH_MAX_CONCURRENCY} concurrent. Timeouts are per-tool (sandbox_run 30/45/60/120/240s; analysis tools longer; default ~${Math.round(TOOL_EXECUTION_TIMEOUT_MS / 1000)}s).`,
      status: "done",
    });
    emitProgress();

    const toolResults = await mapWithConcurrency(
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
        thought: lastThought,
        toolExecutions,
        content: await finalizeContent(buildCleanCurrentChangeReviewAnswer()),
      };
    }
    nextInput = toolResults.map((result: any) => ({
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
    serviceTier,
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
