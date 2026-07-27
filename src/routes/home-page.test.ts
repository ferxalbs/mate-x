import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  buildHomePageSubmission,
  buildHomePageSubmitOptions,
} from "./home-page-submit-options";

describe("HomePage submit options", () => {
  it("uses review defaults for ambient safety", () => {
    assert.equal(buildHomePageSubmitOptions().behaviorMode, "review");
  });

  it("keeps user input separate from behavior strategy", () => {
    const submission = buildHomePageSubmission("Hi", { mode: "execute" });
    assert.equal(submission.prompt, "Hi");
    assert.equal(submission.options.behaviorMode, "execute");
    assert.doesNotMatch(submission.prompt, /Behavior:|policy/i);
  });

  it("serializes distinct routing for every behavior mode", () => {
    const review = buildHomePageSubmission("Review it", { mode: "review" }).options;
    const plan = buildHomePageSubmission("Plan it", { mode: "plan" }).options;
    const execute = buildHomePageSubmission("Fix it", { mode: "execute" }).options;
    assert.equal(review.pathKind, "verify_only");
    assert.equal(plan.behaviorMode, "plan");
    assert.equal(execute.runbookId, "patch_test_verify");
  });
});
