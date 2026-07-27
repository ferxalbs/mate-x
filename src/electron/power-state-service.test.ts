import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_POWER_STATE } from "../contracts/power";
import { PowerStateService } from "./power-state-service";

describe("PowerStateService", () => {
  it("emits the current state only when it changes", () => {
    const service = new PowerStateService();
    const states: string[] = [];
    const unsubscribe = service.subscribe((state) => states.push(`${state.onBattery}:${state.speedLimit}`), true);

    service.update({ onBattery: true });
    service.update({ onBattery: true });
    service.update({ speedLimit: 50 });
    unsubscribe();

    assert.deepEqual(states, ["false:100", "true:100", "true:50"]);
  });

  it("clamps invalid speed limits to a safe range", () => {
    const service = new PowerStateService();

    service.update({ speedLimit: 200 });
    assert.equal(service.getState().speedLimit, 100);
    service.update({ speedLimit: Number.NaN });
    assert.deepEqual(service.getState(), DEFAULT_POWER_STATE);
  });

  it("does not expose mutable internal state through reads or listeners", () => {
    const service = new PowerStateService();
    const readState = service.getState();
    readState.onBattery = true;

    let emittedState = DEFAULT_POWER_STATE;
    service.subscribe((state) => {
      emittedState = state;
    }, true);
    emittedState.suspended = true;

    assert.deepEqual(service.getState(), DEFAULT_POWER_STATE);
    assert.equal(service.canRunBackgroundWork(), true);
  });
});
