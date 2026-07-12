import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BEHAVIOR_PREFERENCE,
  behaviorInstruction,
  behaviorRunOptions,
  shouldAskQuestion,
} from "./behavior-mode";
import type { BehaviorMode, BehaviorPreference } from "./behavior-mode";

function preference(mode: BehaviorMode): BehaviorPreference {
  return { ...DEFAULT_BEHAVIOR_PREFERENCE, mode };
}

describe("behavior modes", () => {
  it("Auto permits low-risk execution and validation", () => {
    assert.deepEqual(behaviorRunOptions(DEFAULT_BEHAVIOR_PREFERENCE), {
      access: "scoped",
      pathKind: "full",
      runbookId: "patch_test_verify",
      autonomyPolicy: { id: "auto_scoped" },
    });
    assert.match(behaviorInstruction(DEFAULT_BEHAVIOR_PREFERENCE), /edit and validate without ceremony/);
  });

  it("Guided requires inline approval", () => {
    const value = preference("guided");
    assert.equal(behaviorRunOptions(value).access, "approval");
    assert.match(behaviorInstruction(value), /Run fix and Review details/);
  });

  it("Review enforces read-only routing", () => {
    const value = preference("review");
    assert.deepEqual(behaviorRunOptions(value), {
      access: "approval",
      pathKind: "verify_only",
      runbookId: "review_classify_summarize",
      autonomyPolicy: { id: "review_read_only" },
    });
    assert.match(behaviorInstruction(value), /Never edit files/);
  });

  it("Custom maps edit or command gates to approval", () => {
    const value = preference("custom");
    assert.equal(behaviorRunOptions(value).access, "approval");
    assert.match(behaviorInstruction(value), /autoValidate=true/);
    assert.deepEqual(behaviorRunOptions(value).autonomyPolicy, {
      id: "custom",
      custom: DEFAULT_BEHAVIOR_PREFERENCE.custom,
    });
  });

  it("Custom preserves every autonomy toggle", () => {
    const custom = {
      askBeforeEdits: false,
      askBeforeCommands: true,
      askBeforeNetwork: false,
      askBeforeGit: true,
      autoValidate: false,
    };
    const value: BehaviorPreference = { mode: "custom", custom };
    assert.deepEqual(behaviorRunOptions(value).autonomyPolicy, { id: "custom", custom });
  });

  it("suppresses questions when evidence gives safe interpretation", () => {
    assert.equal(shouldAskQuestion({ evidenceSufficient: true, materialAmbiguity: false, destructive: false, missingCredentials: false, policyRequiresApproval: false }), false);
  });

  it("asks one blocking question for material unresolved ambiguity", () => {
    assert.equal(shouldAskQuestion({ evidenceSufficient: false, materialAmbiguity: true, destructive: false, missingCredentials: false, policyRequiresApproval: false }), true);
  });
});
