import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canRunBackgroundWork,
  DEFAULT_POWER_STATE,
  shouldReduceBackgroundWork,
} from "./power";

describe("power policy", () => {
  it("keeps background work on AC at a healthy thermal state", () => {
    assert.equal(canRunBackgroundWork(DEFAULT_POWER_STATE), true);
    assert.equal(shouldReduceBackgroundWork(DEFAULT_POWER_STATE), false);
  });

  it("pauses background work on battery and during suspend", () => {
    assert.equal(canRunBackgroundWork({ ...DEFAULT_POWER_STATE, onBattery: true }), false);
    assert.equal(canRunBackgroundWork({ ...DEFAULT_POWER_STATE, suspended: true }), false);
  });

  it("pauses work under thermal pressure or CPU speed limiting", () => {
    assert.equal(canRunBackgroundWork({ ...DEFAULT_POWER_STATE, thermalState: "serious" }), false);
    assert.equal(canRunBackgroundWork({ ...DEFAULT_POWER_STATE, speedLimit: 50 }), false);
    assert.equal(shouldReduceBackgroundWork({ ...DEFAULT_POWER_STATE, thermalState: "fair" }), true);
  });
});
