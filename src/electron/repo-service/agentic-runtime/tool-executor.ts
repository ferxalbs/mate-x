import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentToolCall } from "./types";
import type { ToolEvent } from "../../../contracts/chat";
import type { AppSettings } from "../../../contracts/settings";
import { policyService } from "../../policy-service";
import { toolService } from "../../tool-service";
import { failureMemoryEngine } from "../../failure-memory-engine";
import { isToolFailureOutput, parseToolArguments, summarizeToolOutput, truncateToolOutput, withTimeout } from "./helpers";
import { resolveToolExecutionTimeoutMs } from "./config";

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
}): Promise<{
  toolCallId: string;
  content: string;
  toolExecution: ToolExecutionRecord;
}> {
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
    const parsedOutput = tryParseJsonObject(normalizedResult);
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
