import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidencePack } from "../../../contracts/chat";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";
import {
  deriveTrustGate,
  getRepoHealthVerdict,
  getVerifiedEvidenceScore,
  hasVerifiedEvidenceSignals,
  type RepoHealthSignal,
  type ImpactSummary,
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

describe("trust gate derivation", () => {
  const cleanHealth = {
    gitDirtyState: "clean",
  } as WorkspaceHealthProfile;
  const baseSummary: ImpactSummary = {
    affectedCount: 1,
    serviceCount: 0,
    toolFanoutCount: 0,
    risk: "Low",
  };
  const verifiedPack = {
    status: "complete",
    verdict: { label: "Complete" },
    commandsExecuted: [{ command: "~/.bun/bin/bun run lint" }],
    verifiedTaskScore: {
      score: 88,
      status: "verified",
      signals: [{ id: "validation_passed", satisfied: true, weight: 1 }],
    },
  } as unknown as EvidencePack;

  it("returns ready when proof, validation, and clean git are present", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: verifiedPack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Trusted / Ready");
    assert.equal(state.nextAction, "Can ship");
    assert.equal(state.validationState, "passed");
    assert.equal(state.evidencePackState, "signed_strong");
  });

  it("returns unknown when no evidence or changed files exist", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: null,
      health: cleanHealth,
      summary: { ...baseSummary, risk: "None" },
    });

    assert.equal(state.verdict, "Unknown / Not proven");
    assert.equal(state.proofLabel, "No Ship Proof yet");
  });

  it("requires validation for a dirty repo without proof", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/features/chat.tsx"],
      commands: ["~/.bun/bin/bun run typecheck"],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Needs validation");
    assert.equal(state.nextAction, "Generate proof");
  });

  it("requires validation when proof has no verified signals", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: {
        status: "complete",
        verdict: { label: "Complete" },
        verifiedTaskScore: { score: 18, signals: [] },
      } as unknown as EvidencePack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Needs validation");
    assert.equal(state.nextAction, "Run focused validation");
  });

  it("does not trust final claims when no commands ran", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: {
        status: "complete",
        verdict: { label: "Fixed and ready" },
        commandsExecuted: [],
        verifiedTaskScore: {
          score: 92,
          status: "verified",
          signals: [{ id: "claimed_files_exist", satisfied: true, weight: 1 }],
        },
      } as unknown as EvidencePack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Needs validation");
    assert.equal(state.validationState, "not_run");
    assert.match(state.missingProof.join(" "), /Passing validation/);
  });

  it("blocks when a policy stop is recorded", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/electron/ipc.ts"],
      commands: ["~/.bun/bin/bun run lint"],
      evidencePack: {
        status: "blocked",
        verdict: { label: "Blocked" },
        policyStops: [{ reason: "requires approval" }],
      } as unknown as EvidencePack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Blocked");
    assert.equal(state.nextAction, "Resolve policy stop");
    assert.equal(state.policyStopState, "unresolved");
  });

  it("flags risky surfaces touched before proof", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/electron/session-service.ts"],
      commands: ["~/.bun/bin/bun run typecheck"],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Risky change");
    assert.equal(state.nextAction, "Review auth/session changes");
    assert.deepEqual(state.touchedRiskSurfaces, ["src/electron/session-service.ts"]);
  });

  it("elevates payment and network surfaces without strong proof", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/features/billing/payment-client.ts"],
      commands: [],
      evidencePack: {
        status: "complete",
        verdict: { label: "Complete" },
        verifiedTaskScore: {
          score: 80,
          status: "partially_verified",
          signals: [{ id: "validation_passed", satisfied: true, weight: 1 }],
        },
        commandsExecuted: [{ command: "~/.bun/bin/bun run typecheck" }],
      } as unknown as EvidencePack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Risky change");
    assert.equal(state.evidencePackState, "present_weak");
  });

  it("keeps low VTS evidence risky even after validation", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: {
        status: "complete",
        verdict: { label: "Complete" },
        commandsExecuted: [{ command: "~/.bun/bin/bun run lint" }],
        verifiedTaskScore: {
          score: 64,
          status: "partially_verified",
          signals: [{ id: "validation_passed", satisfied: true, weight: 1 }],
        },
      } as unknown as EvidencePack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Risky change");
    assert.match(state.missingProof.join(" "), /Strong VTS/);
  });

  it("shows resolving trust while a run is active", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/electron/ipc.ts"],
      commands: ["~/.bun/bin/bun run typecheck"],
      evidencePack: null,
      events: [{ id: "event-1", label: "sandbox_run", detail: "Running focused validation.", status: "active" }],
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      isRunning: true,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Resolving trust");
    assert.equal(state.status, "resolving");
  });
});

describe("repo health copy", () => {
  it("does not claim scans ran when only workspace metadata exists", () => {
    const verdict = getRepoHealthVerdict(
      [{ label: "Status", value: "ready", tone: "good" }],
      false,
    );

    assert.equal(verdict.label, "Pending");
    assert.match(verdict.detail, /Map repo signals/);
    assert.doesNotMatch(verdict.detail, /scan/i);
  });

  it("describes unresolved watch signals without implying validation passed", () => {
    const verdict = getRepoHealthVerdict(
      [{ label: "Git", value: "dirty", tone: "watch" }] as RepoHealthSignal[],
      true,
    );

    assert.equal(verdict.label, "Watch");
    assert.match(verdict.detail, /live trust signals/);
    assert.doesNotMatch(verdict.detail, /passed|trusted/i);
  });
});
