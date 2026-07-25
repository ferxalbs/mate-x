import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

if (!window.matchMedia) {
  window.matchMedia = () =>
    ({
      addEventListener: () => {},
      matches: false,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

describe("HomePage submit options", () => {
  it("uses approval-required defaults without product mode selectors", async () => {
    const { buildHomePageSubmitOptions } = await import("./home-page-submit-options");

    assert.deepEqual(buildHomePageSubmitOptions({ runbookId: "scan_contain_report" }), {
      access: "approval",
      pathKind: "verify_only",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    });
  });

  it("preserves review/diff intent overrides", async () => {
    const { buildHomePageSubmitOptions } = await import("./home-page-submit-options");

    assert.equal(
      buildHomePageSubmitOptions({ runbookId: "review_classify_summarize" })
        .runbookId,
      "review_classify_summarize",
    );
  });

  it("keeps user input separate from behavior policy", async () => {
    const { buildHomePageSubmission } = await import("./home-page-submit-options");
    const { DEFAULT_BEHAVIOR_PREFERENCE } = await import("../contracts/behavior-mode");

    const submission = buildHomePageSubmission("Hi", DEFAULT_BEHAVIOR_PREFERENCE);

    assert.equal(submission.prompt, "Hi");
    assert.equal(submission.options.autonomyPolicy?.id, "auto_scoped");
    assert.doesNotMatch(submission.prompt, /AUTO:|User request:/);
  });

  it("serializes distinct routing for every behavior mode", async () => {
    const { buildHomePageSubmission } = await import("./home-page-submit-options");
    const { DEFAULT_CUSTOM_BEHAVIOR } = await import("../contracts/behavior-mode");

    const auto = buildHomePageSubmission("Fix it", {
      mode: "auto",
      custom: DEFAULT_CUSTOM_BEHAVIOR,
    }).options;
    const guided = buildHomePageSubmission("Fix it", {
      mode: "guided",
      custom: DEFAULT_CUSTOM_BEHAVIOR,
    }).options;
    const review = buildHomePageSubmission("Explain it", {
      mode: "review",
      custom: DEFAULT_CUSTOM_BEHAVIOR,
    }).options;
    const custom = buildHomePageSubmission("Fix it", {
      mode: "custom",
      custom: {
        ...DEFAULT_CUSTOM_BEHAVIOR,
        askBeforeEdits: false,
        askBeforeCommands: false,
        askBeforeNetwork: false,
      },
    }).options;

    assert.deepEqual(auto.autonomyPolicy, { id: "auto_scoped" });
    assert.deepEqual(guided.autonomyPolicy, { id: "guided_approval" });
    assert.deepEqual(review.autonomyPolicy, { id: "review_read_only" });
    assert.deepEqual(custom.autonomyPolicy, {
      id: "custom",
      custom: {
        ...DEFAULT_CUSTOM_BEHAVIOR,
        askBeforeEdits: false,
        askBeforeCommands: false,
        askBeforeNetwork: false,
      },
    });
    assert.equal(auto.access, "scoped");
    assert.equal(guided.access, "approval");
    assert.equal(review.runbookId, "review_classify_summarize");
    assert.equal(custom.access, "scoped");
  });
});
