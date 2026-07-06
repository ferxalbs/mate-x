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
  it("uses the same approval-required defaults for composer and contextual submissions", async () => {
    const { buildHomePageSubmitOptions } = await import("./home-page");

    assert.deepEqual(buildHomePageSubmitOptions({ runbookId: "scan_contain_report" }), {
      access: "approval",
      mode: "build",
      reasoning: "high",
      reasoningEnabled: true,
      runbookId: "scan_contain_report",
      serviceTier: "standard",
    });
  });

  it("preserves review/diff intent overrides", async () => {
    const { buildHomePageSubmitOptions } = await import("./home-page");

    assert.equal(
      buildHomePageSubmitOptions({ runbookId: "review_classify_summarize" })
        .runbookId,
      "review_classify_summarize",
    );
  });
});
