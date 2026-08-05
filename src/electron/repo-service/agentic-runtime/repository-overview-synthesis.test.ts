import assert from "node:assert/strict";
import { mock, test } from "bun:test";

import type { AssistantRunOptions } from "../../../contracts/chat";

const requests: Array<{ toolChoice?: string }> = [];

(mock as any).module("../../rainy-service", () => ({
  buildResponsesMessageInput: (messages: unknown[]) => messages,
  listRainyModels: async () => [],
  requestRainyChatCompletionStream: async () => undefined,
  requestRainyResponsesCompletion: async (input: { toolChoice?: string }) => {
    requests.push(input);
    return { output_text: "A bounded repository overview." };
  },
  resolveRainyAgentTimeoutMs: () => 1_000,
  resolvePreferredRainyApiMode: () => "responses",
}));

const { requestRepositoryOverviewSynthesis } = await import(
  "./repository-overview-synthesis"
);

test("repository overview makes one tool-disabled synthesis request", async () => {
  requests.length = 0;
  const progress: string[] = [];
  const options: AssistantRunOptions = {
    reasoningEnabled: false,
    reasoning: "none",
    behaviorMode: "execute",
  };

  const content = await requestRepositoryOverviewSynthesis({
    apiKey: "test-key",
    apiMode: "responses",
    history: [],
    model: "test-model",
    options,
    promptWithEvidence: "bounded evidence",
    systemPrompt: "synthesize only",
    emitProgress: (value) => {
      if (value) progress.push(value);
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.toolChoice, "none");
  assert.equal(content, "A bounded repository overview.");
  assert.deepEqual(progress, ["A bounded repository overview."]);
});
