import assert from "node:assert/strict";
import { test } from "bun:test";

import { getOnboardingMotion, ONBOARDING_STEPS } from "./onboarding-steps";

test("onboarding uses compact typed progress metadata", () => {
  assert.equal(ONBOARDING_STEPS.length, 7);
  assert.deepEqual(
    ONBOARDING_STEPS.map((step) => step.id),
    [
      "welcome",
      "preferences",
      "privacy",
      "api-key",
      "workspace",
      "trust",
      "verification",
    ],
  );
});

test("reduced motion is a 150ms opacity crossfade without translation", () => {
  const motion = getOnboardingMotion(true, 1);

  assert.equal(motion.transition.duration, 0.15);
  assert.deepEqual(motion.variants.enter, { opacity: 0 });
  assert.deepEqual(motion.variants.exit, { opacity: 0 });
  assert.equal("x" in (motion.variants.enter as object), false);
  assert.equal("x" in (motion.variants.exit as object), false);
});

test("standard onboarding motion remains below 250ms", () => {
  const motion = getOnboardingMotion(false, -1);

  assert.equal(motion.transition.duration, 0.22);
});
