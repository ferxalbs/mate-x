import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  resolveAssistantRunOptions,
  toAssistantRunbookId,
} from "./assistant-runbooks";

describe("resolveAssistantRunOptions", () => {
  it("defaults to Execute strategy", () => {
    const options = resolveAssistantRunOptions();
    assert.equal(options.behaviorMode, "execute");
    assert.equal(options.pathKind, "full");
  });

  it("preserves explicit strategy and runbook", () => {
    const options = resolveAssistantRunOptions({
      reasoningEnabled: true,
      reasoning: "high",
      behaviorMode: "review",
      pathKind: "verify_only",
      runbookId: "review_classify_summarize",
    });
    assert.equal(options.behaviorMode, "review");
    assert.equal(options.runbookId, "review_classify_summarize");
  });

  it("maps chat_help to review runbook", () => {
    const options = resolveAssistantRunOptions({
      reasoningEnabled: true,
      reasoning: "medium",
      behaviorMode: "plan",
      pathKind: "chat_help",
      runbookId: "patch_test_verify",
    });
    assert.equal(options.runbookId, "review_classify_summarize");
  });

  it("maps executable WorkPlan runbooks to executable assistant runbooks", () => {
    assert.equal(toAssistantRunbookId("validate_only"), "patch_test_verify");
    assert.equal(
      toAssistantRunbookId("trace_source_to_sink"),
      "audit_reproduce_remediate",
    );
  });
});
