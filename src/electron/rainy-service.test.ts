import { assert, describe, it } from "vitest";

import { listRainyModels } from "./rainy-service";

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
});
