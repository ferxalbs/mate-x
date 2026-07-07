import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ambientSafetyActions } from "./ambient-safety-actions";
import { getGitGateBlockedCopy, shouldGateGitAction } from "./git-safety";

describe("git safety gate", () => {
  it("blocks commit and push actions when safety state is missing", () => {
    assert.equal(shouldGateGitAction("commit", undefined), true);
    assert.equal(shouldGateGitAction("commit-push", undefined), true);
    assert.equal(shouldGateGitAction("push-pr", undefined), true);
    assert.equal(shouldGateGitAction("push", undefined), true);
  });

  it("blocks commit and push actions until validation is proven", () => {
    const needsCheck = { validated: false, status: "needs_validation" };

    assert.equal(shouldGateGitAction("commit", needsCheck), true);
    assert.equal(shouldGateGitAction("commit-push", needsCheck), true);
    assert.equal(shouldGateGitAction("push-pr", needsCheck), true);
    assert.equal(shouldGateGitAction("push", needsCheck), true);
  });

  it("allows commit and push actions only after the canonical gate is validated", () => {
    const validated = { validated: true, status: "trusted" };

    assert.equal(shouldGateGitAction("commit", validated), false);
    assert.equal(shouldGateGitAction("commit-push", validated), false);
    assert.equal(shouldGateGitAction("push-pr", validated), false);
    assert.equal(shouldGateGitAction("push", validated), false);
  });

  it("routes blocked git actions to Factory verification CTA", () => {
    assert.deepEqual(getGitGateBlockedCopy(), {
      reason: "Blocked because this change has no proof yet.",
      primaryCta: "Run Factory verification",
    });
  });

  it("starts Factory verification from the blocked git CTA action", () => {
    assert.equal(ambientSafetyActions.runSafetyCheck.label, "Run Factory verification");
    assert.equal(ambientSafetyActions.runSafetyCheck.overrides.mode, "factory");
    assert.equal(ambientSafetyActions.runSafetyCheck.overrides.access, "approval");
    assert.equal(ambientSafetyActions.runSafetyCheck.overrides.runbookId, "patch_test_verify");
  });
});
