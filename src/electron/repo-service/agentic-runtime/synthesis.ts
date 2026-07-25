import { requestRainyChatCompletion, requestRainyResponsesCompletion } from "../../rainy-service";
import type { AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import { buildNoContentFinalResponse, normalizeAssistantText } from "./helpers";

export async function attemptFinalChatSynthesis({
  apiKey,
  model,
  messages,
  iterations,
  toolRounds,
  totalToolCalls,
  serviceTier,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  messages: any[];
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  serviceTier?: AssistantRunOptions["serviceTier"];
  events: ToolEvent[];
  emitProgress: () => void;
}): Promise<string> {
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
      "Tool use is now disabled. Provide a concise delta or structured summary using evidence collected. " +
      "Do not repeat prior paragraphs, full drafts, the user request, or tool output verbatim. " +
      "Use one verdict line, at most five high-value bullets, unresolved risks only when present, and one next action. " +
      "Keep casual answers to two sentences or fewer. Begin.",
  });

  try {
    const response = await requestRainyChatCompletion({
      apiKey,
      messages,
      model,
      toolChoice: "none",
      serviceTier,
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

export async function attemptFinalResponsesSynthesis({
  apiKey,
  model,
  previousResponseId,
  iterations,
  toolRounds,
  totalToolCalls,
  serviceTier,
  events,
  emitProgress,
}: {
  apiKey: string;
  model: string;
  previousResponseId?: string;
  iterations: number;
  toolRounds: number;
  totalToolCalls: number;
  serviceTier?: AssistantRunOptions["serviceTier"];
  events: ToolEvent[];
  emitProgress: () => void;
}): Promise<string> {
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
      serviceTier,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Tool use is now disabled. Provide a concise delta or structured summary using evidence collected. " +
                "Do not repeat prior paragraphs, full drafts, the user request, or tool output verbatim. " +
                "Use one verdict line, at most five high-value bullets, unresolved risks only when present, and one next action. " +
                "Keep casual answers to two sentences or fewer. Begin.",
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
