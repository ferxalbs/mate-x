import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { document?: Document }).document) {
  GlobalRegistrator.register();
}

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { RainyModelLaunch } from "../../../contracts/rainy";
import { LAUNCH_STAGED_AVAILABILITY_MESSAGE } from "../../../lib/rainy-model-launches";
import { ModelLaunchCardContent } from "./model-launch-card";

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  cleanup();
});

const presentation: RainyModelLaunch["presentation"] = {
  themeId: "electric-iris",
  accent: "#8B5CF6",
  gradient: {
    colors: ["#7C3AED", "#6366F1", "#06B6D4"],
    angleDegrees: 125,
  },
  surface: "#111827",
  onSurface: "#F8FAFC",
  muted: "#CBD5E1",
  animation: {
    kind: "aurora",
    durationMs: 9000,
    reducedMotion: "static",
  },
};

const stagedLaunch: RainyModelLaunch = {
  id: "gpt-5.6-series",
  status: "staged",
  publishedAt: "2026-07-09T00:00:00Z",
  title: "A faster way to get work done",
  summary:
    "Meet GPT-5.6: a new family built for quick everyday work, deep projects, and more room to think.",
  variants: [
    { modelId: "openai/gpt-5.6-sol", label: "Sol" },
    { modelId: "openai/gpt-5.6-sol-pro", label: "Sol Pro" },
    { modelId: "openai/gpt-5.6-terra", label: "Terra" },
    { modelId: "openai/gpt-5.6-terra-pro", label: "Terra Pro" },
    { modelId: "openai/gpt-5.6-luna", label: "Luna" },
    { modelId: "openai/gpt-5.6-luna-pro", label: "Luna Pro" },
  ],
  appControls: [
    {
      id: "reasoning",
      kind: "toggle",
      label: "Reasoning",
      availability: "staged",
    },
  ],
  pricing: {
    basis: "prompt_tokens",
    highContextThreshold: 272001,
    note: "Longer projects can use a different rate.",
  },
  presentation,
};

function renderCard(
  overrides: Partial<ComponentProps<typeof ModelLaunchCardContent>> = {},
) {
  const props: ComponentProps<typeof ModelLaunchCardContent> = {
    launch: stagedLaunch,
    catalog: [],
    onDismiss: () => {},
    onTry: () => {},
    asDialog: false,
    ...overrides,
  };
  return render(<ModelLaunchCardContent {...props} />);
}

describe("ModelLaunchCardContent", () => {
  it("desktop: renders title/summary from launch, presentation theme, no raw staged chips", () => {
    const view = renderCard({ layout: "desktop", prefersReducedMotion: false });

    const card = view.getByTestId("model-launch-card");
    assert.equal(card.getAttribute("data-layout"), "desktop");
    assert.equal(card.getAttribute("data-theme"), "electric-iris");
    assert.equal(card.getAttribute("data-motion"), "aurora");
    assert.match(card.getAttribute("style") ?? "", /--launch-accent:\s*#8B5CF6/i);

    assert.ok(view.getByText("A faster way to get work done"));
    assert.ok(
      view.getByText(/Meet GPT-5\.6: a new family built for quick everyday work/),
    );

    assert.ok(view.getByRole("listitem", { name: /^Sol$/i }));
    assert.ok(view.getByRole("listitem", { name: /^Terra$/i }));
    assert.ok(view.getByRole("listitem", { name: /^Luna$/i }));
    assert.equal(view.queryByText(/· staged/i), null);
    assert.equal(view.queryByText(/COMING SOON/i), null);

    assert.equal(view.queryByTestId("model-launch-pricing-detail"), null);
    assert.ok(view.getByRole("button", { name: /pricing details/i }));

    assert.ok(view.getByTestId("model-launch-availability"));
    assert.match(
      view.getByTestId("model-launch-availability").textContent ?? "",
      new RegExp(LAUNCH_STAGED_AVAILABILITY_MESSAGE),
    );

    const cta = view.getByTestId("model-launch-primary-cta");
    assert.equal(cta.textContent, "Not available yet");
    assert.ok((cta as HTMLButtonElement).disabled);
    assert.ok(view.getByRole("button", { name: /continue with current model/i }));
  });

  it("mobile: uses mobile layout branch without clipping primary actions", () => {
    const view = renderCard({ layout: "mobile", prefersReducedMotion: false });

    const card = view.getByTestId("model-launch-card");
    assert.equal(card.getAttribute("data-layout"), "mobile");
    assert.ok(view.getByTestId("model-launch-primary-cta"));
    assert.ok(view.getByRole("button", { name: /continue with current model/i }));
  });

  it("reduced-motion: static gradient, no aurora motion flag", () => {
    const view = renderCard({ layout: "desktop", prefersReducedMotion: true });

    const card = view.getByTestId("model-launch-card");
    assert.equal(card.getAttribute("data-motion"), "static");
    assert.ok(view.getByTestId("model-launch-aurora"));
  });

  it("staged vs callable: enables Try model only when catalog lists a variant", () => {
    const view = renderCard({
      layout: "desktop",
      catalog: [{ id: "openai/gpt-5.6-sol" }],
      prefersReducedMotion: true,
    });

    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Try model");
    assert.equal(cta.disabled, false);
  });

  it("reveals family availability only on interaction", () => {
    const view = renderCard({ layout: "desktop", prefersReducedMotion: true });

    assert.equal(view.queryByText(/Preparing/i), null);
    fireEvent.click(view.getByRole("listitem", { name: /^Sol$/i }));
    assert.ok(view.getByText(/Preparing/i));
  });

  it("keeps technical pricing behind disclosure", () => {
    const view = renderCard({ layout: "desktop", prefersReducedMotion: true });

    assert.equal(view.queryByTestId("model-launch-pricing-detail"), null);
    fireEvent.click(view.getByRole("button", { name: /pricing details/i }));
    assert.ok(view.getByTestId("model-launch-pricing-detail"));
    assert.match(
      view.getByTestId("model-launch-pricing-detail").textContent ?? "",
      /272|prompt tokens|input tokens/i,
    );
  });

  it("exposes accessible title semantics for keyboard users", () => {
    const view = renderCard({ layout: "desktop", prefersReducedMotion: true });

    assert.ok(view.getByRole("heading", { name: /faster way to get work done/i }));
    assert.ok(view.getByRole("dialog"));
  });
});
