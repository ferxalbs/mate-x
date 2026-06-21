import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { getProofEntitlementForWorkspace } from "./proof-entitlements";

describe("proof entitlements", () => {
  test("requires a MaTE X workspace before enabling Proof Mode", () => {
    const entitlement = getProofEntitlementForWorkspace(null);

    assert.equal(entitlement.proofMode.enabled, false);
    assert.equal(entitlement.proofCapsules.monthlyLimit, 0);
  });

  test("exposes Proof Mode product gates for an active workspace", () => {
    const entitlement = getProofEntitlementForWorkspace("workspace-1");

    assert.equal(entitlement.proofMode.enabled, true);
    assert.equal(entitlement.proofCapsules.private, false);
    assert.equal(entitlement.githubChecks.enabled, false);
  });
});
