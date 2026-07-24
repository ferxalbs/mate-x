import { requestRainyChatCompletion } from "./rainy-service";
import type { TokenEstimator } from "./token-estimator";
import type { ToolEvent } from "../contracts/chat";

const DEFAULT_CONTEXT_CAPACITY = 272_000;
const DEFAULT_CONTEXT_TARGET = 252_000;
const MAX_COMPLETION_RESERVE = 20_000;

/** Per-item character budget for Responses function_call_output / long text. */
const RESPONSES_ITEM_TRUNCATE_CHARS = 4000;

export function resolveContextCompressionLimits(modelContextTokens?: number): {
  truncateThreshold: number;
  compactThreshold: number;
  maxLimit: number;
} {
  const capacity =
    typeof modelContextTokens === "number" &&
    Number.isFinite(modelContextTokens) &&
    modelContextTokens > 0
      ? Math.floor(modelContextTokens)
      : DEFAULT_CONTEXT_CAPACITY;
  const completionReserve = Math.min(
    MAX_COMPLETION_RESERVE,
    Math.floor(capacity * 0.25),
  );
  const maxLimit = Math.max(
    1,
    Math.min(DEFAULT_CONTEXT_TARGET, capacity - completionReserve),
  );

  return {
    truncateThreshold: Math.floor(maxLimit * 0.8),
    compactThreshold: Math.floor(maxLimit * 0.9),
    maxLimit,
  };
}

function estimateMessagesTokens(
  messages: any[],
  estimator: TokenEstimator,
): number {
  return messages.reduce((acc, msg) => {
    let tokens = 0;
    if (msg.content && typeof msg.content === "string") {
      tokens += estimator.estimateTokens(msg.content);
    }
    if (msg.tool_calls) {
      tokens += msg.tool_calls.reduce(
        (tAcc: number, call: any) =>
          tAcc + estimator.estimateTokens(call.function?.arguments || ""),
        0,
      );
    }
    return acc + tokens;
  }, 0);
}

export async function applyContextCompressionChat(
  messages: any[],
  estimator: TokenEstimator,
  apiKey: string,
  model: string,
  events: ToolEvent[],
  emitProgress: () => void,
  modelContextTokens?: number,
): Promise<any[]> {
  const limits = resolveContextCompressionLimits(modelContextTokens);
  let tokenCount = estimateMessagesTokens(messages, estimator);

  if (tokenCount <= limits.truncateThreshold) {
    return messages;
  }

  events.push({
    id: `step-context-compress-${Date.now()}`,
    label: "Context limits",
    detail: `Context approaching limits (${tokenCount} tokens). Cleaning up...`,
    status: "active",
  });
  emitProgress();

  // Phase 1: Truncate large tool outputs (keep some context, but remove bulk)
  const compressedMessages = [...messages];
  for (let i = 0; i < compressedMessages.length; i++) {
    const msg = compressedMessages[i];
    if (
      msg.role === "tool" &&
      typeof msg.content === "string" &&
      msg.content.length > 2000
    ) {
      // Keep only first 1000 and last 1000 chars to represent start/end of logs
      msg.content =
        msg.content.substring(0, 1000) +
        "\n...[TRUNCATED BY CONTEXT COMPRESSION]...\n" +
        msg.content.slice(-1000);
    }
  }

  tokenCount = estimateMessagesTokens(compressedMessages, estimator);

  if (tokenCount <= limits.compactThreshold) {
    const event = events[events.length - 1];
    event.status = "done";
    event.detail = `Truncated tool outputs. New size: ${tokenCount} tokens.`;
    emitProgress();
    return compressedMessages;
  }

  // Phase 2: Compact old history via LLM if still too large
  const systemMsg = compressedMessages.find((m) => m.role === "system");
  const userPrompt = compressedMessages.find(
    (m) => m.role === "user" && compressedMessages.indexOf(m) === 1,
  ); // Assuming the second msg is the main user prompt
  const recentMessages = compressedMessages.slice(-5); // Keep recent interaction intact

  // Find messages to compact (everything between initial prompt and recent)
  const toCompact = compressedMessages.slice(
    systemMsg && userPrompt ? 2 : 1,
    compressedMessages.length - 5,
  );

  if (toCompact.length > 0) {
    events[events.length - 1].detail =
      `Context still large (${tokenCount} tokens). Compacting history via LLM...`;
    emitProgress();

    const compactPrompt = `
      Please summarize the following conversation history.
      Preserve: current objective, branch/repo/path, files touched, key decisions, executed commands, relevant errors, failed tests, next steps, and user constraints.
      Do NOT omit important findings. Make it concise but structured.

      History to compact:
      ${JSON.stringify(toCompact.map((m) => ({ role: m.role, content: m.content ? m.content.toString().substring(0, 500) : m.content, tool_calls: m.tool_calls ? "yes" : "no" })))}
      `;

    try {
      const response = await requestRainyChatCompletion({
        apiKey,
        model,
        messages: [
          {
            role: "system",
            content: "You are a context compaction assistant.",
          },
          { role: "user", content: compactPrompt },
        ],
        toolChoice: "none",
      });

      const summary = response.choices[0]?.message?.content;
      if (summary) {
        const newMessages = [];
        if (systemMsg) newMessages.push(systemMsg);
        if (userPrompt) newMessages.push(userPrompt);

        newMessages.push({
          role: "system",
          content: `[PREVIOUS HISTORY COMPACTED]:\n${summary}`,
        });

        newMessages.push(...recentMessages);

        tokenCount = estimateMessagesTokens(newMessages, estimator);
        if (tokenCount <= limits.maxLimit) {
          events[events.length - 1].status = "done";
          events[events.length - 1].detail =
            `History compacted. New size: ${tokenCount} tokens.`;
          emitProgress();
          return newMessages;
        }

        compressedMessages.splice(0, compressedMessages.length, ...newMessages);
        events[events.length - 1].detail =
          `Compacted history is still large (${tokenCount} tokens). Applying final trim...`;
        emitProgress();
      }
    } catch (_e) {
      events[events.length - 1].detail =
        `LLM compaction failed. Hard-truncating instead.`;
      emitProgress();
    }
  }

  // Phase 3: Hard cut if still over max limit
  if (tokenCount > limits.maxLimit) {
    events[events.length - 1].detail =
      `Context over hard limit. Slicing oldest messages.`;
    emitProgress();
    // Keep system, keep prompt, keep last N messages until within limit
    const finalMessages = [];
    if (systemMsg) finalMessages.push(systemMsg);
    if (userPrompt) finalMessages.push(userPrompt);

    const currentTokens = estimateMessagesTokens(finalMessages, estimator);
    const allowedRemaining = limits.maxLimit - currentTokens;

    const allowedRecent = [];
    let recentTokens = 0;
    for (let i = compressedMessages.length - 1; i >= 0; i--) {
      const msg = compressedMessages[i];
      if (msg === systemMsg || msg === userPrompt) continue;
      const msgTokens = estimateMessagesTokens([msg], estimator);
      if (recentTokens + msgTokens > allowedRemaining) break;
      allowedRecent.unshift(msg);
      recentTokens += msgTokens;
    }
    finalMessages.push(...allowedRecent);

    events[events.length - 1].status = "done";
    return finalMessages;
  }

  events[events.length - 1].status = "done";
  return compressedMessages;
}

/**
 * Cheap Responses-path context hygiene: shrink large function_call_output and
 * message text items so multi-turn tool loops do not grow without bound.
 * Does not call the LLM (chat path still owns LLM compaction).
 */
export function compressResponsesInputItems<T>(items: T[]): T[] {
  return items.map((raw) => {
    const item = raw as {
      type?: string;
      output?: unknown;
      content?: unknown;
    };

    if (
      item.type === "function_call_output" &&
      typeof item.output === "string" &&
      item.output.length > RESPONSES_ITEM_TRUNCATE_CHARS
    ) {
      const output = item.output;
      const head = Math.floor(RESPONSES_ITEM_TRUNCATE_CHARS / 2);
      const tail = Math.floor(RESPONSES_ITEM_TRUNCATE_CHARS / 2);
      return {
        ...(raw as object),
        output:
          output.slice(0, head) +
          "\n...[TRUNCATED BY CONTEXT COMPRESSION]...\n" +
          output.slice(-tail),
      } as T;
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      const content = (item.content as Array<Record<string, unknown>>).map(
        (part) => {
          if (
            (part.type === "input_text" || part.type === "output_text") &&
            typeof part.text === "string" &&
            part.text.length > RESPONSES_ITEM_TRUNCATE_CHARS
          ) {
            const text = part.text as string;
            const head = Math.floor(RESPONSES_ITEM_TRUNCATE_CHARS / 2);
            const tail = Math.floor(RESPONSES_ITEM_TRUNCATE_CHARS / 2);
            return {
              ...part,
              text:
                text.slice(0, head) +
                "\n...[TRUNCATED BY CONTEXT COMPRESSION]...\n" +
                text.slice(-tail),
            };
          }
          return part;
        },
      );
      return { ...(raw as object), content } as T;
    }

    return raw;
  });
}
