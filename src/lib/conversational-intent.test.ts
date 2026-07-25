import assert from "node:assert/strict";
import { test } from "bun:test";

import { isConversationalPrompt } from "./conversational-intent";

test("recognizes concise repository questions as conversational", () => {
  assert.equal(isConversationalPrompt("umm explain the repo in 3 words"), true);
  assert.equal(isConversationalPrompt("What changed?"), true);
  assert.equal(isConversationalPrompt("Fix the failing test"), false);
});
