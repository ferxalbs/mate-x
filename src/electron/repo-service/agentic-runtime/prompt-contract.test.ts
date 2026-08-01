import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  BEHAVIOR_MODE_DEFINITIONS,
  behaviorSystemContract,
} from "../../../contracts/behavior-mode";
import { buildValidationAuthoritySection } from "./prompt-contract";

const workPlan = JSON.stringify({
  validationPlan: {
    required: true,
    requirements: [{
      id: "test",
      command: "bun run test",
      availability: "resolved",
    }],
  },
});

describe("behavior-mode prompt contracts", () => {
  test("keeps Review, Plan, and Execute contracts materially distinct", () => {
    const review = behaviorSystemContract("review");
    const plan = behaviorSystemContract("plan");
    const execute = behaviorSystemContract("execute");

    assert.notEqual(review, plan);
    assert.notEqual(plan, execute);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.review.allowsCommands, false);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.plan.allowsMutation, false);
    assert.equal(BEHAVIOR_MODE_DEFINITIONS.execute.allowsCommands, true);
    assert.match(review, /evidence-only/i);
    assert.match(plan, /read-only design/i);
    assert.match(execute, /mutation-and-proof/i);
  });

  test("uses mode-specific validation authority wording", () => {
    assert.match(buildValidationAuthoritySection(workPlan, "review"), /read-only/i);
    assert.doesNotMatch(buildValidationAuthoritySection(workPlan, "review"), /bun run test/);
    assert.match(buildValidationAuthoritySection(workPlan, "plan"), /must not execute/i);
    assert.match(buildValidationAuthoritySection(workPlan, "execute"), /bun run test/);
    assert.match(buildValidationAuthoritySection(workPlan, "execute"), /exact resolved command/i);
  });
});
