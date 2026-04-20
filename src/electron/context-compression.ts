import { requestRainyChatCompletion } from "./rainy-service";
import type { TokenEstimator } from "./token-estimator";
import type { ToolEvent } from "../contracts/chat";

const CONTEXT_TRUNCATE_THRESHOLD = 60000;
const CONTEXT_COMPACT_THRESHOLD = 75000;
const CONTEXT_MAX_LIMIT = 80000;

function estimateMessagesTokens(messages: any[], estimator: TokenEstimator): number {
  return messages.reduce((acc, msg) => {
    let tokens = 0;
    if (msg.content && typeof msg.content === "string") {
      tokens += estimator.estimateTokens(msg.content);
    }
    if (msg.tool_calls) {
      tokens += msg.tool_calls.reduce((tAcc: number, call: any) =>
        tAcc + estimator.estimateTokens(call.function?.arguments || ""), 0);
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
  emitProgress: () => void
): Promise<any[]> {
  let tokenCount = estimateMessagesTokens(messages, estimator);

  if (tokenCount <= CONTEXT_TRUNCATE_THRESHOLD) {
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
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 2000) {
      // Keep only first 1000 and last 1000 chars to represent start/end of logs
      msg.content = msg.content.substring(0, 1000) + "\n...[TRUNCATED BY CONTEXT COMPRESSION]...\n" + msg.content.slice(-1000);
    }
  }

  tokenCount = estimateMessagesTokens(compressedMessages, estimator);

  if (tokenCount <= CONTEXT_COMPACT_THRESHOLD) {
      const event = events[events.length - 1];
      event.status = "done";
      event.detail = `Truncated tool outputs. New size: ${tokenCount} tokens.`;
      emitProgress();
      return compressedMessages;
  }

  // Phase 2: Compact old history via LLM if still too large
  const systemMsg = compressedMessages.find(m => m.role === "system");
  const userPrompt = compressedMessages.find(m => m.role === "user" && compressedMessages.indexOf(m) === 1); // Assuming the second msg is the main user prompt
  const recentMessages = compressedMessages.slice(-5); // Keep recent interaction intact

  // Find messages to compact (everything between initial prompt and recent)
  const toCompact = compressedMessages.slice(
      systemMsg && userPrompt ? 2 : 1,
      compressedMessages.length - 5
  );

  if (toCompact.length > 0) {
      events[events.length - 1].detail = `Context still large (${tokenCount} tokens). Compacting history via LLM...`;
      emitProgress();

      const compactPrompt = `
      Please summarize the following conversation history.
      Preserve: current objective, branch/repo/path, files touched, key decisions, executed commands, relevant errors, failed tests, next steps, and user constraints.
      Do NOT omit important findings. Make it concise but structured.

      History to compact:
      ${JSON.stringify(toCompact.map(m => ({ role: m.role, content: m.content ? m.content.toString().substring(0, 500) : m.content, tool_calls: m.tool_calls ? "yes" : "no" })))}
      `;

      try {
          const response = await requestRainyChatCompletion({
            apiKey,
            model,
            messages: [{ role: "system", content: "You are a context compaction assistant." }, { role: "user", content: compactPrompt }],
            toolChoice: "none"
          });

          const summary = response.choices[0]?.message?.content;
          if (summary) {
              const newMessages = [];
              if (systemMsg) newMessages.push(systemMsg);
              if (userPrompt) newMessages.push(userPrompt);

              newMessages.push({
                  role: "system",
                  content: `[PREVIOUS HISTORY COMPACTED]:\n${summary}`
              });

              newMessages.push(...recentMessages);

              tokenCount = estimateMessagesTokens(newMessages, estimator);
              events[events.length - 1].status = "done";
              events[events.length - 1].detail = `History compacted. New size: ${tokenCount} tokens.`;
              emitProgress();

              return newMessages;
          }
      } catch (_e) {
         events[events.length - 1].detail = `LLM compaction failed. Hard-truncating instead.`;
         emitProgress();
      }
  }

  // Phase 3: Hard cut if still over max limit
  if (tokenCount > CONTEXT_MAX_LIMIT) {
     events[events.length - 1].detail = `Context over hard limit. Slicing oldest messages.`;
     emitProgress();
     // Keep system, keep prompt, keep last N messages until within limit
     const finalMessages = [];
     if (systemMsg) finalMessages.push(systemMsg);
     if (userPrompt) finalMessages.push(userPrompt);

     const currentTokens = estimateMessagesTokens(finalMessages, estimator);
     const allowedRemaining = CONTEXT_MAX_LIMIT - currentTokens;

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
