import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { requiresSensitiveIpcApproval } from "./approval-policy";

describe("requiresSensitiveIpcApproval", () => {
  it("does not route a user-entered API key through the agent approval queue", () => {
    assert.equal(requiresSensitiveIpcApproval("settings:set-api-key"), false);
  });

  it("keeps non-settings sensitive actions approval-gated by default", () => {
    assert.equal(requiresSensitiveIpcApproval("mobile:start-pairing"), true);
  });
});
