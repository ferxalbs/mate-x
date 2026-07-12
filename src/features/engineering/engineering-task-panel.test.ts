import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  primaryActionForStatus,
  primaryCtaForStatus,
} from "./engineering-task-panel";
import type { EngineeringTaskStatus } from "../../contracts/engineering-task";
import { ENGINEERING_TASK_STATUSES } from "../../contracts/engineering-task";

describe("EngineeringTaskPanel CTA matrix [NES-7.1][founder-incident]", () => {
  it("maps statuses to explicit CTAs — never generic Continue", () => {
    assert.equal(primaryCtaForStatus("captured"), "Review specification");
    assert.equal(primaryCtaForStatus("clarifying"), "Answer clarification");
    assert.equal(primaryCtaForStatus("awaiting_approval"), "Approve plan");
    assert.equal(primaryCtaForStatus("ready"), "View Ship Proof");
    assert.equal(primaryCtaForStatus("blocked"), "Resolve blocker");
    assert.notEqual(primaryCtaForStatus("captured"), "Continue");
  });

  it("never offers duplicate execution actions while work is active", () => {
    for (const status of ["executing", "verifying", "converging"] as const) {
      assert.equal(primaryActionForStatus(status), null);
    }
  });

  it("every rendered action has a real commandType", () => {
    for (const status of ENGINEERING_TASK_STATUSES) {
      const action = primaryActionForStatus(status as EngineeringTaskStatus);
      if (!action) continue;
      assert.ok(action!.commandType.length > 0, `empty command for ${status}`);
      assert.ok(action!.label.length > 0);
      assert.notEqual(action!.label, "Continue");
    }
  });

  it("does not use Factory/Ship/Plan mode product language", () => {
    const labels = ENGINEERING_TASK_STATUSES.map(
      (s) => primaryCtaForStatus(s),
    ).join(" ");
    assert.equal(/Factory|Ship Mode|Plan Mode|Critic/i.test(labels), false);
  });
});
