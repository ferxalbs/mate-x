import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  buildLaunchGradientCss,
  buildLaunchPresentationCssVars,
  canTryLaunchModel,
  extractEffectiveServiceTier,
  getHighContextPricingNotice,
  getLaunchFamilyNames,
  getLaunchPrimaryCtaLabel,
  isModelCallableInCatalog,
  loadDismissedLaunchIds,
  parseRainyModelLaunchesPayload,
  persistDismissedLaunchId,
  isDeclaredProVariant,
  resolveBaseVariantModelId,
  resolveProVariantModelId,
  selectUnseenLaunches,
  serializeReasoningRequest,
  serializeServiceTierRequest,
  shouldAnimateLaunchPresentation,
  type LaunchDismissalStore,
} from "./rainy-model-launches";

function memoryStore(seed: Record<string, string> = {}): LaunchDismissalStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const samplePayload = {
  success: true,
  data: {
    data: [
      {
        id: "gpt-5.6-series",
        status: "staged",
        published_at: "2026-07-09T00:00:00Z",
        title: "Introducing GPT-5.6 series",
        summary:
          "GPT-5.6 Sol, Terra, and Luna variants are being introduced with 1M context and pricing that changes above 272K input tokens.",
        variants: [
          { model_id: "openai/gpt-5.6-sol", label: "Sol" },
          { model_id: "openai/gpt-5.6-sol-pro", label: "Sol Pro" },
          { model_id: "openai/gpt-5.6-terra", label: "Terra" },
        ],
        app_controls: [
          {
            id: "reasoning",
            kind: "toggle",
            label: "Reasoning",
            availability: "staged",
            request_fields: ["reasoning", "reasoning_effort", "include_reasoning"],
          },
          {
            id: "reasoning_pro",
            kind: "model_variant",
            label: "Reasoning Pro",
            availability: "staged",
            variant_suffix: "-pro",
          },
          {
            id: "service_tier",
            kind: "select",
            label: "Service tier",
            availability: "staged",
            values: ["flex", "priority", "scale"],
          },
        ],
        pricing: {
          basis: "prompt_tokens",
          high_context_threshold: 272001,
          note: "Provider base pricing changes when input tokens exceed 272K.",
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
};

describe("parseRainyModelLaunchesPayload", () => {
  it("parses nested success envelope launch feed", () => {
    const launches = parseRainyModelLaunchesPayload(samplePayload);
    assert.equal(launches.length, 1);
    const launch = launches[0]!;
    assert.equal(launch.id, "gpt-5.6-series");
    assert.equal(launch.status, "staged");
    assert.equal(launch.title, "Introducing GPT-5.6 series");
    assert.equal(launch.variants.length, 3);
    assert.equal(launch.variants[0]?.modelId, "openai/gpt-5.6-sol");
    assert.deepEqual(
      launch.appControls.map((control) => control.id),
      ["reasoning", "reasoning_pro", "service_tier"],
    );
    assert.equal(launch.pricing.highContextThreshold, 272001);
    assert.deepEqual(launch.appControls[2]?.values, ["flex", "priority", "scale"]);
    assert.equal(launch.presentation.themeId, "electric-iris");
    assert.equal(launch.presentation.accent, "#8B5CF6");
    assert.deepEqual(launch.presentation.gradient.colors, [
      "#7C3AED",
      "#6366F1",
      "#06B6D4",
    ]);
    assert.equal(launch.presentation.gradient.angleDegrees, 125);
  });

  it("drops malformed entries and rows without presentation", () => {
    const launches = parseRainyModelLaunchesPayload({
      data: [
        { id: "broken" },
        { ...samplePayload.data.data[0], presentation: undefined },
        samplePayload.data.data[0],
      ],
    });
    assert.equal(launches.length, 1);
    assert.equal(launches[0]?.id, "gpt-5.6-series");
  });
});

describe("launch presentation helpers", () => {
  it("collapses Pro labels into clean family names", () => {
    assert.deepEqual(
      getLaunchFamilyNames([
        { label: "Sol" },
        { label: "Sol Pro" },
        { label: "Terra" },
        { label: "Terra Pro" },
        { label: "Luna" },
        { label: "Luna Pro" },
      ]),
      ["Sol", "Terra", "Luna"],
    );
  });

  it("builds gradient and CSS vars from presentation only", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    assert.equal(
      buildLaunchGradientCss(launch.presentation),
      "linear-gradient(125deg, #7C3AED, #6366F1, #06B6D4)",
    );
    const vars = buildLaunchPresentationCssVars(launch.presentation);
    assert.equal(vars["--launch-accent"], "#8B5CF6");
    assert.equal(vars["--launch-surface"], "#111827");
    assert.match(vars["--launch-gradient"] ?? "", /125deg/);
  });

  it("disables aurora animation when prefers-reduced-motion is set", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    assert.equal(
      shouldAnimateLaunchPresentation(launch.presentation, true),
      false,
    );
    assert.equal(
      shouldAnimateLaunchPresentation(launch.presentation, false),
      true,
    );
  });

  it("labels primary CTA for staged vs callable", () => {
    assert.equal(getLaunchPrimaryCtaLabel(false, false), "Not available yet");
    assert.equal(getLaunchPrimaryCtaLabel(true, false), "Try model");
    assert.equal(getLaunchPrimaryCtaLabel(true, true), "Activating…");
  });
});

describe("dismissal persistence", () => {
  it("persists dismissal per user key and launch id", () => {
    const store = memoryStore();
    assert.deepEqual(loadDismissedLaunchIds("user-a", store), []);

    persistDismissedLaunchId("user-a", "gpt-5.6-series", store);
    persistDismissedLaunchId("user-a", "gpt-5.6-series", store);
    persistDismissedLaunchId("user-b", "other", store);

    assert.deepEqual(loadDismissedLaunchIds("user-a", store), ["gpt-5.6-series"]);
    assert.deepEqual(loadDismissedLaunchIds("user-b", store), ["other"]);
  });

  it("filters unseen launches by dismissed ids", () => {
    const launches = parseRainyModelLaunchesPayload(samplePayload);
    assert.equal(selectUnseenLaunches(launches, []).length, 1);
    assert.equal(selectUnseenLaunches(launches, ["gpt-5.6-series"]).length, 0);
  });
});

describe("staged gating", () => {
  it("never treats staged launch models as callable without catalog entry", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    assert.equal(isModelCallableInCatalog("openai/gpt-5.6-sol", []), false);
    assert.equal(canTryLaunchModel(launch, []), false);
    assert.equal(
      canTryLaunchModel(launch, [{ id: "openai/gpt-5.6-sol" }]),
      true,
    );
  });
});

describe("Pro variant mapping", () => {
  it("maps base model id to declared -pro variant from launch feed only", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    assert.equal(
      resolveProVariantModelId("openai/gpt-5.6-sol", launch),
      "openai/gpt-5.6-sol-pro",
    );
    assert.equal(
      resolveBaseVariantModelId("openai/gpt-5.6-sol-pro", launch),
      "openai/gpt-5.6-sol",
    );
    assert.equal(isDeclaredProVariant("openai/gpt-5.6-sol-pro", launch), true);
    assert.equal(isDeclaredProVariant("openai/gpt-5.6-sol", launch), false);

    // luna → luna-pro only when both are declared on the launch.
    const withLuna = {
      ...launch,
      variants: [
        ...launch.variants,
        { modelId: "openai/gpt-5.6-luna", label: "Luna" },
        { modelId: "openai/gpt-5.6-luna-pro", label: "Luna Pro" },
      ],
    };
    assert.equal(
      resolveProVariantModelId("openai/gpt-5.6-luna", withLuna),
      "openai/gpt-5.6-luna-pro",
    );

    // Catalog gating still applies when provided.
    assert.equal(
      resolveProVariantModelId("openai/gpt-5.6-sol", launch, {
        catalog: [{ id: "openai/gpt-5.6-sol" }],
      }),
      null,
    );
    assert.equal(
      resolveProVariantModelId("openai/gpt-5.6-sol", launch, {
        catalog: [
          { id: "openai/gpt-5.6-sol" },
          { id: "openai/gpt-5.6-sol-pro" },
        ],
      }),
      "openai/gpt-5.6-sol-pro",
    );
  });

  it("never invents a -pro suffix for arbitrary model IDs", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    // Not in launch.variants — must not become openai/gpt-4o-pro etc.
    assert.equal(resolveProVariantModelId("openai/gpt-4o", launch), null);
    assert.equal(
      resolveProVariantModelId("anthropic/claude-sonnet-4.6", launch),
      null,
    );
    // In variants but without a declared Pro partner (sample has terra, not terra-pro).
    assert.equal(resolveProVariantModelId("openai/gpt-5.6-terra", launch), null);
    // luna not in sample variants at all — do not invent luna-pro.
    assert.equal(resolveProVariantModelId("openai/gpt-5.6-luna", launch), null);
    // Without a launch feed, never suffix-guess.
    assert.equal(resolveProVariantModelId("openai/gpt-5.6-sol"), null);
    assert.equal(resolveProVariantModelId("openai/gpt-5.6-sol", null), null);
    // Suffix-only heuristic must stay false without a launch declaration.
    assert.equal(isDeclaredProVariant("openai/gpt-4o-pro", null), false);
    assert.equal(isDeclaredProVariant("openai/gpt-4o-pro", launch), false);
  });
});

describe("reasoning request serialization", () => {
  it("sends only documented reasoning fields", () => {
    const body = serializeReasoningRequest({
      enabled: true,
      effort: "high",
      acceptedParameters: ["reasoning", "reasoning_effort", "include_reasoning", "tools"],
      requestFields: ["reasoning", "reasoning_effort", "include_reasoning"],
    });

    assert.deepEqual(body, {
      reasoning: { effort: "high" },
      reasoning_effort: "high",
      include_reasoning: true,
    });
    assert.equal("reasoning_pro" in body, false);
  });

  it("omits reasoning when disabled and never emits unknown params", () => {
    const body = serializeReasoningRequest({
      enabled: false,
      effort: "high",
      acceptedParameters: ["reasoning", "include_reasoning"],
    });
    assert.deepEqual(body, {});
  });

  it("respects accepted parameters intersection", () => {
    const body = serializeReasoningRequest({
      enabled: true,
      effort: "medium",
      acceptedParameters: ["include_reasoning"],
    });
    assert.deepEqual(body, { include_reasoning: true });
    assert.equal("reasoning" in body, false);
    assert.equal("reasoning_effort" in body, false);
  });

  it("treats explicit empty accepted parameters as no allowed fields", () => {
    const body = serializeReasoningRequest({
      enabled: true,
      effort: "high",
      acceptedParameters: [],
    });
    assert.deepEqual(body, {});
  });
});

describe("service-tier serialization", () => {
  it("omits standard and serializes listed non-default tiers only", () => {
    assert.deepEqual(serializeServiceTierRequest("standard"), {});
    assert.deepEqual(serializeServiceTierRequest("flex"), { service_tier: "flex" });
    assert.deepEqual(serializeServiceTierRequest("priority"), {
      service_tier: "priority",
    });
    assert.deepEqual(serializeServiceTierRequest("scale"), { service_tier: "scale" });
    assert.deepEqual(
      serializeServiceTierRequest("scale", ["flex", "priority", "scale"]),
      { service_tier: "scale" },
    );
    assert.deepEqual(serializeServiceTierRequest("scale", ["flex"]), {});
  });

  it("preserves provider-returned effective tier from metadata", () => {
    assert.equal(
      extractEffectiveServiceTier({
        meta: { effective_service_tier: "priority" },
      }),
      "priority",
    );
    assert.equal(
      extractEffectiveServiceTier({ service_tier: "flex" }),
      "flex",
    );
    assert.equal(extractEffectiveServiceTier({}), null);
  });

  it("prefers Rainy metadata over nested provider chat service_tier", () => {
    const providerMetaKey = ["open", "router", "_metadata"].join("");
    assert.equal(
      extractEffectiveServiceTier({
        meta: { effective_service_tier: "priority" },
        [providerMetaKey]: { service_tier: "flex" },
      }),
      "priority",
    );
    assert.equal(
      extractEffectiveServiceTier({
        [providerMetaKey]: { service_tier: "scale" },
      }),
      "scale",
    );
    assert.equal(
      extractEffectiveServiceTier({
        meta: { [providerMetaKey]: { service_tier: "flex" } },
      }),
      "flex",
    );
  });
});

describe("GPT-5.6 pricing notice", () => {
  it("surfaces threshold notice without estimating from prompt count", () => {
    const launch = parseRainyModelLaunchesPayload(samplePayload)[0]!;
    const notice = getHighContextPricingNotice({
      launch,
      modelId: "openai/gpt-5.6-sol",
    });
    assert.match(notice ?? "", /272/);
    assert.match(notice ?? "", /not estimate from message count/i);
    assert.doesNotMatch(notice ?? "", /estimated from \d+ messages/i);

    const measured = getHighContextPricingNotice({
      launch,
      modelId: "openai/gpt-5.6-sol",
      measuredInputTokens: 300_000,
    });
    assert.match(measured ?? "", /300,000/);
    assert.match(measured ?? "", /prompt tokens/i);
  });
});
