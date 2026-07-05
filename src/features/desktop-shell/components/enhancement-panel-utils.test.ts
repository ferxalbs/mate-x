import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidencePack } from "../../../contracts/chat";
import {
  getVerifiedEvidenceScore,
  hasVerifiedEvidenceSignals,
} from "./enhancement-panel-utils";

describe("enhancement panel evidence scoring", () => {
  it("does not return a numeric score without an evidence pack", () => {
    assert.equal(getVerifiedEvidenceScore(null), null);
    assert.equal(hasVerifiedEvidenceSignals(null), false);
  });

  it("does not return a numeric score without verified signals", () => {
    const evidencePack = {
      verifiedTaskScore: {
        score: 18,
        signals: [],
      },
    } as unknown as EvidencePack;

    assert.equal(getVerifiedEvidenceScore(evidencePack), null);
    assert.equal(hasVerifiedEvidenceSignals(evidencePack), false);
  });

  it("returns score when verified signals exist", () => {
    const evidencePack = {
      verifiedTaskScore: {
        score: 82,
        signals: [{ satisfied: true, weight: 1 }],
      },
    } as unknown as EvidencePack;

    assert.equal(getVerifiedEvidenceScore(evidencePack), 82);
    assert.equal(hasVerifiedEvidenceSignals(evidencePack), true);
  });
});
