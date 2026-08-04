import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  getImmediateConversationalResponse,
  isConversationalPrompt,
} from "./conversational-intent";

test("recognizes concise repository questions as conversational", () => {
  assert.equal(isConversationalPrompt("umm explain the repo in 3 words"), true);
  assert.equal(isConversationalPrompt("What changed?"), true);
  assert.equal(isConversationalPrompt("Fix the failing test"), false);
});

test("returns immediate local responses for social turns", () => {
  assert.equal(
    getImmediateConversationalResponse("Hi", "acme-demo"),
    "Hey — what do you want to inspect or change in acme-demo?",
  );
  assert.match(
    getImmediateConversationalResponse("Thanks!", "acme-demo") ?? "",
    /You’re welcome/,
  );
  assert.equal(
    getImmediateConversationalResponse("What changed?", "acme-demo"),
    null,
  );
});
