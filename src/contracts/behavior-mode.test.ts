import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BEHAVIOR_MODE_DEFINITIONS,
  behaviorInstruction,
  behaviorRunOptions,
  shouldAskQuestion,
} from "./behavior-mode";

describe("behavior modes", () => {
  it("defines three distinct strategies", () => {
    assert.deepEqual(Object.keys(BEHAVIOR_MODE_DEFINITIONS), [
      "review",
      "plan",
      "execute",
    ]);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.review.allowsMutation, false);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.plan.allowsMutation, false);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.execute.allowsMutation, true);
  });

  it("routes review, plan, and execute without encoding permissions", () => {
    assert.deepEqual(behaviorRunOptions({ mode: "review" }), {
      behaviorMode: "review",
      pathKind: "verify_only",
      runbookId: "review_classify_summarize",
    });
    assert.equal(behaviorRunOptions({ mode: "plan" }).behaviorMode, "plan");
    assert.equal(behaviorRunOptions({ mode: "execute" }).pathKind, "full");
    assert.doesNotMatch(behaviorInstruction("review"), /trust|permission|policy/i);
  });

  it("asks only for material blockers", () => {
    assert.equal(shouldAskQuestion({ evidenceSufficient: true, materialAmbiguity: false, destructive: false, missingCredentials: false, policyRequiresApproval: false }), false);
    assert.equal(shouldAskQuestion({ evidenceSufficient: false, materialAmbiguity: true, destructive: false, missingCredentials: false, policyRequiresApproval: false }), true);
  });
});
