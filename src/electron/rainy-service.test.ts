import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, it, mock } from "bun:test";
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
import {
  getRainyServiceTierOptions,
  modelSupportsServiceTiers,
  type RainyModelCapabilities,
  type RainyModelCatalogEntry,
} from "../contracts/rainy";

(mock as any).module("electron", () => ({
  app: {
    getPath: () => tmpdir(),
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => false,
  },
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: () => undefined,
  },
}));

const {
  buildChatCompletionRequest,
  isReasoningNotAllowedError,
  isToolsNotAllowedError,
  isOpenAIGpt5OrNewerModel,
  listRainyModelLaunches,
  listRainyModels,
  resolvePreferredRainyApiMode,
} = await import("./rainy-service");

describe("Rainy plan compatibility errors", () => {
  it("recognizes the structured tool entitlement rejection", () => {
    assert.equal(
      isToolsNotAllowedError({
        status: 403,
        error: {
          code: "TOOLS_NOT_ALLOWED",
          message: "Custom tools are not available on your plan",
        },
      }),
      true,
    );
  });

  it("does not downgrade unrelated access denials", () => {
    assert.equal(
      isToolsNotAllowedError({
        status: 403,
        error: {
          code: "MODEL_TIER_NOT_ALLOWED",
          message: "Model tier is not available on your plan",
        },
      }),
      false,
    );
  });

  it("recognizes only the structured reasoning entitlement rejection", () => {
    assert.equal(
      isReasoningNotAllowedError({
        status: 403,
        error: {
          code: "REASONING_NOT_ALLOWED",
          message: "Reasoning is not available on your plan",
        },
      }),
      true,
    );
    assert.equal(
      isReasoningNotAllowedError({
        status: 403,
        error: {
          code: "MODEL_TIER_NOT_ALLOWED",
          message: "Model tier is not available on your plan",
        },
      }),
      false,
    );
  });
});

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
                context_length: 1_050_000,
                rainy_effective_context_length: 272_000,
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
      assert.equal(
        models.find((entry) => entry.id === "openai/gpt-5.4-mini")
          ?.effectiveContextLength,
        272_000,
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

  it("normalizes service tier metadata from model pricing", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/models/catalog")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "provider/tiered",
                display_name: "Tiered",
                pricing: {
                  prompt: "1",
                  completion: "2",
                  service_tiers: [
                    { tier: "flex", prompt: "0.5", completion: "1" },
                    { tier: "priority", prompt: "2", completion: "4" },
                  ],
                },
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
        apiKey: "ra-tier-key",
        forceRefresh: true,
      });

      assert.deepEqual(getRainyServiceTierOptions(models[0]), [
        "standard",
        "flex",
        "priority",
      ]);
      assert.equal(modelSupportsServiceTiers(models[0]), true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("normalizes keyed service tier metadata from model pricing", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/models/catalog")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "provider/keyed-tiered",
                display_name: "Keyed Tiered",
                pricing: {
                  prompt: "1",
                  completion: "2",
                  service_tiers: {
                    flex: { prompt: "0.5", completion: "1" },
                    priority: { prompt: "2", completion: "4" },
                  },
                },
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
        apiKey: "ra-keyed-tier-key",
        forceRefresh: true,
      });

      assert.deepEqual(getRainyServiceTierOptions(models[0]), [
        "standard",
        "flex",
        "priority",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("listRainyModelLaunches", () => {
  it("parses launch feed and caches safely without treating launches as catalog", async () => {
    const originalFetch = global.fetch;
    let launchHits = 0;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/models/launches")) {
        launchHits += 1;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              data: [
                {
                  id: "gpt-5.6-series",
                  status: "staged",
                  published_at: "2026-07-09T00:00:00Z",
                  title: "Introducing GPT-5.6 series",
                  summary: "Staged GPT-5.6 rollout.",
                  variants: [
                    { model_id: "openai/gpt-5.6-sol", label: "Sol" },
                  ],
                  app_controls: [
                    {
                      id: "reasoning",
                      kind: "toggle",
                      label: "Reasoning",
                      availability: "staged",
                      request_fields: [
                        "reasoning",
                        "reasoning_effort",
                        "include_reasoning",
                      ],
                    },
                  ],
                  pricing: {
                    basis: "prompt_tokens",
                    high_context_threshold: 272001,
                    note: "Pricing changes above 272K input tokens.",
                  },
                  presentation: {
                    theme_id: "electric-iris",
                    accent: "#8B5CF6",
                    gradient: {
                      colors: ["#7C3AED", "#6366F1", "#06B6D4"],
                      angle_degrees: 125,
                    },
                    surface: "#111827",
                    on_surface: "#F8FAFC",
                    muted: "#CBD5E1",
                    animation: {
                      kind: "aurora",
                      duration_ms: 9000,
                      reduced_motion: "static",
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof global.fetch;

    try {
      const first = await listRainyModelLaunches({
        apiKey: "ra-test-key",
        forceRefresh: true,
      });
      const second = await listRainyModelLaunches({
        apiKey: "ra-test-key",
        forceRefresh: false,
      });

      assert.equal(first.length, 1);
      assert.equal(first[0]?.id, "gpt-5.6-series");
      assert.equal(first[0]?.status, "staged");
      assert.deepEqual(second, first);
      assert.equal(launchHits, 1);
    } finally {
      global.fetch = originalFetch;
    }
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
    // When controls only flag reasoning_effort without an effort enum, fall back to
    // the documented Rainy/provider effort vocabulary (not a short hard-coded trio).
    const efforts = getReasoningEffortValues(reasoningWithEffort);
    assert.ok(efforts.includes("low"));
    assert.ok(efforts.includes("medium"));
    assert.ok(efforts.includes("high"));
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

  it("omits service_tier for Standard/default requests", () => {
    const request = buildChatCompletionRequest({
      model: "tiered",
      messages: textMessage,
      serviceTier: "standard",
    });

    assert.equal("service_tier" in request, false);
  });

  it("sends Flex and Priority service tiers", () => {
    const flexRequest = buildChatCompletionRequest({
      model: "tiered",
      messages: textMessage,
      serviceTier: "flex",
    });
    const priorityRequest = buildChatCompletionRequest({
      model: "tiered",
      messages: textMessage,
      serviceTier: "priority",
    });

    assert.equal(flexRequest.service_tier, "flex");
    assert.equal(priorityRequest.service_tier, "priority");
  });

  it("sends scale service tier and rejects unknown reasoning parameters", () => {
    const scaleRequest = buildChatCompletionRequest({
      model: "tiered",
      messages: textMessage,
      serviceTier: "scale",
      allowedServiceTiers: ["flex", "priority", "scale"],
    });
    assert.equal(scaleRequest.service_tier, "scale");

    const reasoningRequest = buildChatCompletionRequest({
      model: "reasoning",
      messages: textMessage,
      reasoning: { effort: "high" },
      includeReasoning: true,
      reasoningEffort: "high",
      capabilities: {
        reasoning: { supported: true },
        parameters: {
          accepted: ["reasoning", "reasoning_effort", "include_reasoning"],
        },
      },
    });

    assert.deepEqual(reasoningRequest.reasoning, { effort: "high" });
    assert.equal(reasoningRequest.reasoning_effort, "high");
    assert.equal(reasoningRequest.include_reasoning, true);
    assert.equal("reasoning_pro" in reasoningRequest, false);
  });

  it("preserves provider reasoning details in assistant messages", () => {
    const assistantMessage = {
      role: "assistant",
      content: "There are three r letters.",
      reasoning_details: [{ type: "reasoning", text: "counted letters" }],
    } as any;
    const request = buildChatCompletionRequest({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "user", content: "How many r's are in strawberry?" },
        assistantMessage,
        { role: "user", content: "Are you sure?" },
      ] as any,
    });

    assert.equal(request.messages[1], assistantMessage);
    assert.deepEqual(
      (request.messages[1] as any).reasoning_details,
      assistantMessage.reasoning_details,
    );
  });

  it("keeps non-tiered model requests unchanged", () => {
    const request = buildChatCompletionRequest({
      model: "plain",
      messages: textMessage,
    });

    assert.deepEqual(request, { model: "plain", messages: textMessage });
  });
});

describe("Rainy service tier options", () => {
  const tieredModel: RainyModelCatalogEntry = {
    id: "provider/tiered",
    label: "Tiered",
    description: null,
    ownedBy: "provider",
    supportedApiModes: ["chat_completions"],
    preferredApiMode: "chat_completions",
    pricing: {
      service_tiers: [
        { tier: "flex" },
        { tier: "priority" },
      ],
    },
  };

  const plainModel: RainyModelCatalogEntry = {
    id: "provider/plain",
    label: "Plain",
    description: null,
    ownedBy: "provider",
    supportedApiModes: ["chat_completions"],
    preferredApiMode: "chat_completions",
  };

  it("shows Standard/Flex/Priority for tiered models", () => {
    assert.deepEqual(getRainyServiceTierOptions(tieredModel), [
      "standard",
      "flex",
      "priority",
    ]);
  });

  it("includes launch-listed scale tier when provided as extra values", () => {
    assert.deepEqual(
      getRainyServiceTierOptions(tieredModel, ["flex", "priority", "scale"]),
      ["standard", "flex", "priority", "scale"],
    );
  });

  it("hides selector for non-tiered models", () => {
    assert.deepEqual(getRainyServiceTierOptions(plainModel), ["standard"]);
    assert.equal(modelSupportsServiceTiers(plainModel), false);
  });

  it("model switch clears invalid tier by falling back to Standard options", () => {
    assert.equal(getRainyServiceTierOptions(plainModel).includes("priority"), false);
  });
});
