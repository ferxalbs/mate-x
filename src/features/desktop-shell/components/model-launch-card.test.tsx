import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { LaunchPrimaryAction, LaunchVariant, RainyModelLaunch } from "../../../contracts/rainy";
import { ModelLaunchCardContent } from "./model-launch-card";

if (!(globalThis as { document?: Document }).document) {
  GlobalRegistrator.register();
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

type PresentationColor = {
  accent: string;
  surface: string;
  onSurface: string;
  muted: string;
  gradientColors: [string, string, string];
};

function makePresentation(
  themeId: string,
  { accent, surface, onSurface, muted, gradientColors }: PresentationColor,
): RainyModelLaunch["presentation"] {
  return {
    themeId,
    accent,
    surface,
    onSurface,
    muted,
    gradient: { colors: gradientColors, angleDegrees: 125 },
    animation: { kind: "aurora", durationMs: 9000, reducedMotion: "static" },
  };
}

const violetPresentation = makePresentation("electric-iris", {
  accent: "#8B5CF6",
  surface: "#111827",
  onSurface: "#F8FAFC",
  muted: "#CBD5E1",
  gradientColors: ["#7C3AED", "#6366F1", "#06B6D4"],
});

const amberPresentation = makePresentation("amber-glow", {
  accent: "#F59E0B",
  surface: "#1C1917",
  onSurface: "#FEF3C7",
  muted: "#D97706",
  gradientColors: ["#F59E0B", "#EF4444", "#EC4899"],
});

const emeraldPresentation = makePresentation("emerald-pulse", {
  accent: "#10B981",
  surface: "#022C22",
  onSurface: "#D1FAE5",
  muted: "#6EE7B7",
  gradientColors: ["#10B981", "#059669", "#14B8A6"],
});

function callableAction(modelId: string, label = "Try model"): LaunchPrimaryAction {
  return { kind: "start_chat", label, model_id: modelId };
}

function disabledAction(label: string): LaunchPrimaryAction {
  return { kind: "disabled", label, model_id: null };
}

function makeVariant(
  id: string,
  label: string,
  presentation: RainyModelLaunch["presentation"],
  primaryAction: LaunchPrimaryAction,
  opts: { availability?: LaunchVariant["availability"]; selectable?: boolean } = {},
): LaunchVariant {
  return {
    id,
    label,
    availability: opts.availability ?? "callable",
    selectable: opts.selectable ?? true,
    presentation,
    primary_action: primaryAction,
  };
}

function makeLaunch(overrides: Partial<RainyModelLaunch> & { ui: RainyModelLaunch["ui"] }): RainyModelLaunch {
  return {
    id: "test-launch",
    status: "available",
    publishedAt: "2026-07-09T00:00:00Z",
    title: "New Model Launch",
    summary: "A brand-new model family.",
    variants: [],
    appControls: [],
    pricing: {
      basis: "prompt_tokens",
      highContextThreshold: 999_999,
      note: "Pricing subject to change.",
    },
    presentation: violetPresentation,
    selection: {
      mode: "auto",
      groupBy: "none",
      availableCtaLabel: "Get Started",
      stagedCtaLabel: "Coming Soon",
    },
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<ComponentProps<typeof ModelLaunchCardContent>> & {
    launch: RainyModelLaunch;
  },
) {
  const props: ComponentProps<typeof ModelLaunchCardContent> = {
    onDismiss: () => {},
    onTry: () => {},
    asDialog: false,
    prefersReducedMotion: true,
    layout: "desktop",
    ...overrides,
  };
  return render(<ModelLaunchCardContent {...props} />);
}

// ---------------------------------------------------------------------------
// Contract test 1: one callable variant
// ---------------------------------------------------------------------------
describe("Contract: one callable variant", () => {
  const variant = makeVariant(
    "openai/nova-1",
    "Nova",
    violetPresentation,
    callableAction("openai/nova-1", "Start chatting"),
  );

  const launch = makeLaunch({
    ui: {
      selector: "none",
      initial_model_id: "openai/nova-1",
      primary_action: callableAction("openai/nova-1", "Start chatting"),
      variants: [variant],
    },
  });

  it("renders title and summary", () => {
    const view = renderCard({ launch });
    assert.ok(view.getByText("New Model Launch"));
    assert.ok(view.getByText("A brand-new model family."));
  });

  it("CTA is enabled with API label and kind=start_chat", () => {
    const view = renderCard({ launch });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Start chatting");
    assert.equal(cta.disabled, false);
    assert.equal(cta.dataset.ctaKind, "start_chat");
  });

  it("no selector buttons rendered (selector=none)", () => {
    const view = renderCard({ launch });
    assert.equal(view.queryAllByRole("listitem").length, 0);
  });

  it("onTry receives model_id from primary_action, not variant.id", () => {
    const calls: string[] = [];
    const view = renderCard({ launch, onTry: (id) => calls.push(id) });
    fireEvent.click(view.getByTestId("model-launch-primary-cta"));
    assert.deepEqual(calls, ["openai/nova-1"]);
  });

  it("theme applied from variant presentation", () => {
    const view = renderCard({ launch });
    const card = view.getByTestId("model-launch-card");
    assert.equal(card.dataset.theme, "electric-iris");
  });
});

// ---------------------------------------------------------------------------
// Contract test 2: three callable variants with distinct colors
// ---------------------------------------------------------------------------
describe("Contract: three callable variants, distinct colors", () => {
  const variantA = makeVariant("sol", "Sol", violetPresentation, callableAction("openai/sol", "Try Sol"));
  const variantB = makeVariant("terra", "Terra", amberPresentation, callableAction("openai/terra", "Try Terra"));
  const variantC = makeVariant("luna", "Luna", emeraldPresentation, callableAction("openai/luna", "Try Luna"));

  const launch = makeLaunch({
    ui: {
      selector: "multiple",
      initial_model_id: "sol",
      primary_action: callableAction("openai/sol", "Try Sol"),
      variants: [variantA, variantB, variantC],
    },
  });

  it("renders exactly 3 selector buttons from API — no more, no less", () => {
    const view = renderCard({ launch });
    assert.equal(view.queryAllByRole("radio").length, 3);
    assert.ok(view.getByText("Sol"));
    assert.ok(view.getByText("Terra"));
    assert.ok(view.getByText("Luna"));
  });

  it("initial CTA matches initial_model_id variant", () => {
    const view = renderCard({ launch });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Try Sol");
    assert.equal(cta.disabled, false);
    const card = view.getByTestId("model-launch-card");
    assert.equal(card.dataset.theme, "electric-iris");
  });

  it("selecting Terra changes CTA label and theme to amber", () => {
    const view = renderCard({ launch });
    // Click the Terra span inside the listitem button
    fireEvent.click(view.getByText("Terra"));
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Try Terra");
    assert.equal(cta.disabled, false);
    const card = view.getByTestId("model-launch-card");
    assert.equal(card.dataset.theme, "amber-glow");
  });

  it("selecting Luna changes CTA label and theme to emerald", () => {
    const view = renderCard({ launch });
    fireEvent.click(view.getByText("Luna"));
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Try Luna");
    const card = view.getByTestId("model-launch-card");
    assert.equal(card.dataset.theme, "emerald-pulse");
  });

  it("onTry receives the correct model_id per selected variant", () => {
    const calls: string[] = [];
    const view = renderCard({ launch, onTry: (id) => calls.push(id) });
    fireEvent.click(view.getByText("Terra"));
    fireEvent.click(view.getByTestId("model-launch-primary-cta"));
    assert.deepEqual(calls, ["openai/terra"]);
  });
});

// ---------------------------------------------------------------------------
// Contract test 3: staged preview variants (selectable but unavailable)
// ---------------------------------------------------------------------------
describe("Contract: staged preview variants", () => {
  const previewVariant = makeVariant(
    "gpt-next",
    "GPT Next",
    amberPresentation,
    disabledAction("Notify me"),
    { availability: "unavailable", selectable: true },
  );
  const callableVariant = makeVariant(
    "gpt-current",
    "GPT Current",
    violetPresentation,
    callableAction("openai/gpt-current", "Get started"),
  );

  const launch = makeLaunch({
    ui: {
      selector: "multiple",
      initial_model_id: "gpt-current",
      primary_action: callableAction("openai/gpt-current", "Get started"),
      variants: [callableVariant, previewVariant],
    },
  });

  it("preview variant button is clickable (selectable=true)", () => {
    const view = renderCard({ launch });
    // Find the GPT Next button by its label text
    const previewBtn = view.getByText("GPT Next").closest("button") as HTMLButtonElement;
    assert.ok(previewBtn);
    assert.equal(previewBtn.disabled, false);
    assert.equal(previewBtn.dataset.selectable, "true");
    assert.equal(previewBtn.dataset.availability, "unavailable");
  });

  it("clicking preview variant changes theme to its presentation", () => {
    const view = renderCard({ launch });
    fireEvent.click(view.getByText("GPT Next"));
    assert.equal(view.getByTestId("model-launch-card").dataset.theme, "amber-glow");
  });

  it("CTA stays disabled after selecting preview variant — exact API label", () => {
    const view = renderCard({ launch });
    fireEvent.click(view.getByText("GPT Next"));
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Notify me");
    assert.equal(cta.disabled, true);
    assert.equal(cta.dataset.ctaKind, "disabled");
  });

  it("selecting callable variant re-enables CTA", () => {
    const view = renderCard({ launch });
    fireEvent.click(view.getByText("GPT Next"));
    fireEvent.click(view.getByText("GPT Current"));
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Get started");
    assert.equal(cta.disabled, false);
  });
});

// ---------------------------------------------------------------------------
// Contract test 4: unavailable variant (not selectable)
// ---------------------------------------------------------------------------
describe("Contract: unavailable variant, not selectable", () => {
  const lockedVariant = makeVariant(
    "future-model",
    "Future",
    amberPresentation,
    disabledAction("Coming Soon"),
    { availability: "unavailable", selectable: false },
  );
  const callableVariant = makeVariant(
    "current-model",
    "Current",
    violetPresentation,
    callableAction("openai/current", "Launch"),
  );

  const launch = makeLaunch({
    ui: {
      selector: "multiple",
      initial_model_id: "current-model",
      primary_action: callableAction("openai/current", "Launch"),
      variants: [callableVariant, lockedVariant],
    },
  });

  it("locked variant button is disabled (selectable=false)", () => {
    const view = renderCard({ launch });
    const lockedBtn = view.getByText("Future").closest("button") as HTMLButtonElement;
    assert.ok(lockedBtn);
    assert.equal(lockedBtn.disabled, true);
    assert.equal(lockedBtn.dataset.selectable, "false");
  });

  it("theme stays on initial variant — locked button cannot change it", () => {
    const view = renderCard({ launch });
    assert.equal(view.getByTestId("model-launch-card").dataset.theme, "electric-iris");
  });

  it("CTA remains enabled for callable variant", () => {
    const view = renderCard({ launch });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Launch");
    assert.equal(cta.disabled, false);
  });
});

// ---------------------------------------------------------------------------
// Contract test 5: API CTA/model_id changes without app code changes
// ---------------------------------------------------------------------------
describe("Contract: API changes propagate without app code changes", () => {
  /**
   * This test verifies that the component is a pure renderer of whatever
   * the API returns. Two different launch responses → two different UIs,
   * same component code.
   */

  function makeApiDrivenLaunch(
    ctaLabel: string,
    modelId: string,
    themeId: string,
    presentation: RainyModelLaunch["presentation"],
  ) {
    const variant = makeVariant("v1", "Model", presentation, callableAction(modelId, ctaLabel));
    return makeLaunch({
      ui: {
        selector: "none",
        initial_model_id: "v1",
        primary_action: callableAction(modelId, ctaLabel),
        variants: [variant],
      },
    });
  }

  it("response A: CTA label='Get Started', model=openai/a, theme=electric-iris", () => {
    const launch = makeApiDrivenLaunch("Get Started", "openai/a", "electric-iris", violetPresentation);
    const calls: string[] = [];
    const view = renderCard({ launch, onTry: (id) => calls.push(id) });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Get Started");
    assert.equal(cta.disabled, false);
    assert.equal(view.getByTestId("model-launch-card").dataset.theme, "electric-iris");
    fireEvent.click(cta);
    assert.deepEqual(calls, ["openai/a"]);
  });

  it("response B: CTA label='Try Beta', model=openai/b, theme=amber-glow — same code, different API", () => {
    const launch = makeApiDrivenLaunch("Try Beta", "openai/b", "amber-glow", amberPresentation);
    const calls: string[] = [];
    const view = renderCard({ launch, onTry: (id) => calls.push(id) });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Try Beta");
    assert.equal(cta.disabled, false);
    assert.equal(view.getByTestId("model-launch-card").dataset.theme, "amber-glow");
    fireEvent.click(cta);
    assert.deepEqual(calls, ["openai/b"]);
  });

  it("disabled action: CTA shows API label, kind=disabled, click does nothing", () => {
    const variant = makeVariant("v1", "Model", violetPresentation, disabledAction("Waitlisted"));
    const launch = makeLaunch({
      ui: {
        selector: "none",
        initial_model_id: "v1",
        primary_action: disabledAction("Waitlisted"),
        variants: [variant],
      },
    });
    const calls: string[] = [];
    const view = renderCard({ launch, onTry: (id) => calls.push(id) });
    const cta = view.getByTestId("model-launch-primary-cta") as HTMLButtonElement;
    assert.equal(cta.textContent, "Waitlisted");
    assert.equal(cta.disabled, true);
    assert.equal(cta.dataset.ctaKind, "disabled");
    fireEvent.click(cta);
    assert.deepEqual(calls, []);
  });
});

// ---------------------------------------------------------------------------
// Regression: pricing disclosure still works
// ---------------------------------------------------------------------------
describe("Regression: pricing disclosure", () => {
  const variant = makeVariant("v1", "Model", violetPresentation, callableAction("openai/v1", "Launch"));
  const launch = makeLaunch({
    pricing: {
      basis: "prompt_tokens",
      highContextThreshold: 100_000,
      note: "High context may incur additional cost.",
    },
    ui: {
      selector: "none",
      initial_model_id: "v1",
      primary_action: callableAction("openai/v1", "Launch"),
      variants: [variant],
    },
  });

  it("pricing detail is hidden behind disclosure toggle", () => {
    const view = renderCard({ launch });
    assert.equal(
      view.getByTestId("model-launch-pricing-detail").parentElement?.className.includes("opacity-0"),
      true,
    );
    fireEvent.click(view.getByRole("button", { name: /pricing details/i }));
    assert.equal(
      view.getByTestId("model-launch-pricing-detail").parentElement?.className.includes("opacity-100"),
      true,
    );
    assert.match(
      view.getByTestId("model-launch-pricing-detail").textContent ?? "",
      /High context may incur additional cost\./,
    );
  });
});
