import { assert, describe, it } from "vitest";

import {
  buildChatCompletionRequest,
  isOpenAIGpt5OrNewerModel,
  listRainyModels,
  resolvePreferredRainyApiMode,
} from "./rainy-service";
import {
  getAcceptedParameters,
  getReasoningEffortValues,
  supportsImageInput,
  supportsImageOutput,
  supportsReasoning,
  supportsReasoningEffort,
  supportsStructuredOutput,
  supportsTools,
} from "../lib/rainy-model-capabilities";
import type { RainyModelCapabilities } from "../contracts/rainy";

describe("listRainyModels", () => {
  it("keeps providers returned by /models even when catalog is partial", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/models/catalog")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-5.4-mini",
                display_name: "OpenAI: GPT-5.4 Mini",
              },
              {
                id: "anthropic/claude-sonnet-4.6",
                display_name: "Anthropic: Claude Sonnet 4.6",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-5.4-mini",
                display_name: "OpenAI: GPT-5.4 Mini",
              },
              {
                id: "anthropic/claude-sonnet-4.6",
                display_name: "Anthropic: Claude Sonnet 4.6",
              },
              {
                id: "google/gemini-2.5-pro",
                display_name: "Google: Gemini 2.5 Pro",
              },
              {
                id: "meta/llama-4-maverick",
                display_name: "Meta: Llama 4 Maverick",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    }) as typeof global.fetch;

    try {
      const models = await listRainyModels({
        apiKey: "ra-test-key",
        forceRefresh: true,
      });

      assert.deepEqual(
        models.map((entry) => entry.id),
        [
          "anthropic/claude-sonnet-4.6",
          "google/gemini-2.5-pro",
          "meta/llama-4-maverick",
          "openai/gpt-5.4-mini",
        ],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("still includes catalog-only models when /models is partial", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/models/catalog")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "moonshot/kimi-k2",
                display_name: "Moonshot: Kimi K2",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-5.4-mini",
                display_name: "OpenAI: GPT-5.4 Mini",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    }) as typeof global.fetch;

    try {
      const models = await listRainyModels({
        apiKey: "ra-test-key-2",
        forceRefresh: true,
      });

      assert.deepEqual(models.map((entry) => entry.id), [
        "moonshot/kimi-k2",
        "openai/gpt-5.4-mini",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("routes OpenAI GPT-5-family models through responses when supported", () => {
    assert.equal(isOpenAIGpt5OrNewerModel("openai/gpt-5.4"), true);
    assert.equal(isOpenAIGpt5OrNewerModel("openai/gpt-5.4-mini"), true);
    assert.equal(isOpenAIGpt5OrNewerModel("openai/gpt-4.1"), false);
    assert.equal(isOpenAIGpt5OrNewerModel("anthropic/claude-sonnet-4.6"), false);

    assert.equal(
      resolvePreferredRainyApiMode("openai/gpt-5.4", {
        id: "openai/gpt-5.4",
        label: "OpenAI GPT-5.4",
        description: null,
        ownedBy: "openai",
        supportedApiModes: ["chat_completions", "responses"],
        preferredApiMode: "chat_completions",
      }),
      "responses",
    );
  });

  it("keeps non-GPT-5 models on chat completions when available", () => {
    assert.equal(
      resolvePreferredRainyApiMode("anthropic/claude-sonnet-4.6", {
        id: "anthropic/claude-sonnet-4.6",
        label: "Claude Sonnet 4.6",
        description: null,
        ownedBy: "anthropic",
        supportedApiModes: ["chat_completions", "responses"],
        preferredApiMode: "responses",
      }),
      "chat_completions",
    );
  });
});

describe("Rainy model capabilities", () => {
  const reasoningWithEffort: RainyModelCapabilities = {
    reasoning: {
      supported: true,
      controls: { reasoning_effort: true },
    },
    parameters: { accepted: ["reasoning", "include_reasoning", "tools"] },
  };

  it("resolves reasoning efforts from controls and accepted parameters", () => {
    assert.equal(supportsReasoning(reasoningWithEffort), true);
    assert.equal(supportsReasoningEffort(reasoningWithEffort), true);
    assert.deepEqual(getReasoningEffortValues(reasoningWithEffort), [
      "low",
      "medium",
      "high",
    ]);
    assert.deepEqual(getAcceptedParameters(reasoningWithEffort), [
      "reasoning",
      "include_reasoning",
      "tools",
    ]);
    assert.equal(supportsTools(reasoningWithEffort), true);
  });

  it("resolves reasoning efforts from profile metadata", () => {
    assert.deepEqual(
      getReasoningEffortValues({
        reasoning: {
          supported: true,
          profiles: [
            {
              parameter_path: "reasoning.effort",
              values: ["minimal", "low", "medium", "high", "xhigh"],
            },
          ],
        },
      }),
      ["minimal", "low", "medium", "high", "xhigh"],
    );
  });

  it("keeps unknown capabilities conservative", () => {
    assert.equal(supportsReasoning(undefined), false);
    assert.equal(supportsImageInput(undefined), false);
    assert.equal(supportsImageOutput(undefined), false);
    assert.equal(supportsTools(undefined), false);
    assert.equal(supportsStructuredOutput(undefined), false);
  });
});

describe("buildChatCompletionRequest", () => {
  const textMessage = [{ role: "user", content: "hello" }] as any[];
  const imageMessage = [
    {
      role: "user",
      content: [
        { type: "text", text: "inspect" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    },
  ] as any[];

  it("sends reasoning effort when model supports reasoning plus effort", () => {
    const request = buildChatCompletionRequest({
      model: "reasoning-effort",
      messages: textMessage,
      reasoning: { effort: "medium" },
      capabilities: {
        reasoning: {
          supported: true,
          controls: { reasoning_effort: true },
        },
        parameters: { accepted: ["reasoning"] },
      },
    });

    assert.deepEqual(request.reasoning, { effort: "medium" });
  });

  it("sends empty reasoning object when model supports reasoning without effort", () => {
    const request = buildChatCompletionRequest({
      model: "reasoning-toggle",
      messages: textMessage,
      reasoning: {},
      capabilities: {
        reasoning: { supported: true },
        parameters: { accepted: ["reasoning"] },
      },
    });

    assert.deepEqual(request.reasoning, {});
  });

  it("omits reasoning when model does not accept reasoning", () => {
    const request = buildChatCompletionRequest({
      model: "plain",
      messages: textMessage,
      reasoning: { effort: "medium" },
      capabilities: {
        reasoning: { supported: false },
        parameters: { accepted: [] },
      },
    });

    assert.equal("reasoning" in request, false);
  });

  it("does not send reasoning false when reasoning is disabled", () => {
    const request = buildChatCompletionRequest({
      model: "reasoning-disabled",
      messages: textMessage,
      capabilities: {
        reasoning: { supported: true },
        parameters: { accepted: ["reasoning"] },
      },
    });

    assert.equal("reasoning" in request, false);
    assert.equal((request as any).reasoning === false, false);
  });

  it("allows image_url content when model supports image input", () => {
    const request = buildChatCompletionRequest({
      model: "vision",
      messages: imageMessage,
      capabilities: {
        multimodal: { input: ["text", "image"] },
        parameters: { accepted: [] },
      },
    });

    assert.equal(request.messages, imageMessage);
  });

  it("rejects image_url content when model lacks image input", () => {
    let didThrow = false;
    try {
      buildChatCompletionRequest({
        model: "text-only",
        messages: imageMessage,
        capabilities: {
          multimodal: { input: ["text"] },
          parameters: { accepted: [] },
        },
      });
    } catch {
      didThrow = true;
    }

    assert.equal(didThrow, true);
  });

  it("allows image output modalities when model supports image output", () => {
    const request = buildChatCompletionRequest({
      model: "image-output",
      messages: textMessage,
      modalities: ["image", "text"],
      imageConfig: { size: "1024x1024" },
      capabilities: {
        multimodal: { output: ["text", "image"] },
        parameters: { accepted: ["modalities", "image_config"] },
      },
    });

    assert.deepEqual(request.modalities, ["image", "text"]);
    assert.deepEqual(request.image_config, { size: "1024x1024" });
  });

  it("drops image output modalities when model lacks image output", () => {
    const request = buildChatCompletionRequest({
      model: "text-output",
      messages: textMessage,
      modalities: ["image", "text"],
      imageConfig: { size: "1024x1024" },
      capabilities: {
        multimodal: { output: ["text"] },
        parameters: { accepted: ["modalities", "image_config"] },
      },
    });

    assert.equal("modalities" in request, false);
    assert.equal("image_config" in request, false);
  });

  it("drops incompatible advanced parameters after model capability changes", () => {
    const request = buildChatCompletionRequest({
      model: "limited",
      messages: textMessage,
      tools: [{ type: "function", function: { name: "scan", parameters: {} } }],
      reasoning: { effort: "medium" },
      includeReasoning: true,
      modalities: ["image", "text"],
      capabilities: {
        multimodal: { output: ["text"] },
        parameters: { accepted: [] },
      },
    } as any);

    assert.equal("tools" in request, false);
    assert.equal("reasoning" in request, false);
    assert.equal("include_reasoning" in request, false);
    assert.equal("modalities" in request, false);
  });
});
