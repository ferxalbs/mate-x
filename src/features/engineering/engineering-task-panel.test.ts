import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { primaryCtaForStatus } from "./engineering-task-panel";

describe("EngineeringTaskPanel CTA matrix [NES-7.1]", () => {
  it("maps statuses to primary CTA labels", () => {
    assert.equal(primaryCtaForStatus("captured"), "Continue");
    assert.equal(primaryCtaForStatus("awaiting_approval"), "Approve plan");
    assert.equal(primaryCtaForStatus("ready"), "Create Ship Proof");
    assert.equal(primaryCtaForStatus("blocked"), "Resolve blocker");
  });

  it("does not use Factory/Ship/Plan mode product language", () => {
    const labels = [
      primaryCtaForStatus("captured"),
      primaryCtaForStatus("specified"),
      primaryCtaForStatus("planned"),
      primaryCtaForStatus("ready"),
    ].join(" ");
    assert.equal(/Factory|Ship Mode|Plan Mode|Critic/i.test(labels), false);
  });
});
