import assert from "node:assert/strict";
import { test } from "bun:test";

import { selectFinalAssistantText } from "./helpers";

test("final assistant text prefers the single final synthesis", () => {
  assert.equal(
    selectFinalAssistantText("I inspected the repo.", "Verdict: clean."),
    "Verdict: clean.",
  );
  assert.equal(
    selectFinalAssistantText("Latest draft.", ""),
    "Latest draft.",
  );
});
