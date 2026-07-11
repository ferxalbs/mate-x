import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidencePack } from "../../../contracts/chat";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";
import {
  detectActiveGateIntent,
  deriveTrustGate,
  getShipStatusMode,
  getShipStatusHeaderLabel,
  getTopbarRepoSafetyLabel,
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
    risk: "Low risk",
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

  it("maps signed evidence and passed validation to Validated", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: verifiedPack,
      health: cleanHealth,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Validated");
    assert.equal(state.headline, "Validated");
    assert.equal(state.nextAction, "Continue");
    assert.equal(state.primaryActionLabel, "View proof");
    assert.equal(getShipStatusHeaderLabel(state), state.headline);
    assert.equal(state.validationState, "passed");
    assert.equal(state.evidencePackState, "signed_strong");
  });

  it("maps no evidence and no changes to Not proven", () => {
    const state = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: null,
      health: cleanHealth,
      summary: { ...baseSummary, risk: "None" },
    });

    assert.equal(state.verdict, "Not proven");
    assert.equal(state.headline, "Not proven");
    assert.equal(state.proofLabel, "No validation passed yet");
    assert.equal(state.primaryActionLabel, "Show details");
    assert.equal(getShipStatusHeaderLabel(state), "Not proven");
  });

  it("maps no validation and changed files to Needs check", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/features/chat.tsx"],
      commands: ["~/.bun/bin/bun run typecheck"],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Needs check");
    assert.equal(state.headline, "Needs check");
    assert.equal(getShipStatusHeaderLabel(state), "Needs check");
    assert.equal(state.explanation, "MaTE X found changed files, but no passing validation has been proven.");
    assert.equal(state.nextAction, "Run Factory verification");
    assert.deepEqual(state.reasonChips.slice(0, 3), [
      "1 file changed",
      "No validation passed",
      "Needs safety check",
    ]);
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

    assert.equal(state.verdict, "Needs check");
    assert.equal(state.nextAction, "Run Factory verification");
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

    assert.equal(state.verdict, "Needs check");
    assert.equal(state.validationState, "not_run");
    assert.equal(state.proofLabel, "No validation passed yet");
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
    assert.equal(state.headline, "Blocked");
    assert.equal(state.nextAction, "Resolve policy stop");
    assert.equal(state.policyStopState, "unresolved");
  });

  it("maps risky surface touched without proof to Risk found", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/electron/session-service.ts"],
      commands: ["~/.bun/bin/bun run typecheck"],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: baseSummary,
    });

    assert.equal(state.verdict, "Risk found");
    assert.equal(state.headline, "Risk found");
    assert.equal(state.primaryActionLabel, "Inspect risky changes");
    assert.equal(getShipStatusHeaderLabel(state), "Risk found");
    assert.equal(state.nextAction, "Run Factory verification");
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

    assert.equal(state.verdict, "Risk found");
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

    assert.equal(state.verdict, "Risk found");
    assert.match(state.missingProof.join(" "), /Strong proof/);
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

    assert.equal(state.verdict, "Needs check");
    assert.equal(state.status, "resolving");
    assert.equal(getShipStatusHeaderLabel(state), "Needs check");
  });

  it("labels changed files as changed, not repo health totals", () => {
    const state = deriveTrustGate({
      changedFiles: [
        "src/features/chat.tsx",
        "src/features/home.tsx",
        "src/electron/ipc.ts",
        "src/preload.ts",
        "src/contracts/chat.ts",
      ],
      commands: [],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: { ...baseSummary, affectedCount: 61, risk: "High" },
    });

    assert.match(state.reasonChips.join(" "), /5 files changed/);
    assert.doesNotMatch(state.reasonChips.join(" "), /61 files changed/);
  });

  it("does not offer proof export as the primary action when proof is missing", () => {
    const state = deriveTrustGate({
      changedFiles: ["src/features/chat.tsx"],
      commands: [],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: baseSummary,
    });

    assert.notEqual(state.primaryActionLabel, "Export Evidence");
    assert.notEqual(state.primaryActionLabel, "View proof");
    assert.equal(state.proofLabel, "No validation passed yet");
  });
});

describe("contextual ship status mode", () => {
  const dirtyState = deriveTrustGate({
    changedFiles: ["src/features/chat.tsx"],
    commands: [],
    evidencePack: null,
    health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
    summary: {
      affectedCount: 1,
      serviceCount: 0,
      toolFanoutCount: 0,
      risk: "Low risk",
    },
  });

  it("does not trigger active gate for casual hello prompts", () => {
    assert.equal(detectActiveGateIntent("Hello, how are you?"), false);
    assert.equal(detectActiveGateIntent("casual conversation"), false);
    assert.equal(detectActiveGateIntent("general chat about react"), false);
    assert.equal(detectActiveGateIntent("thanks"), false);
    assert.equal(
      getShipStatusMode({
        conversation: {
          id: "c1",
          title: "Chat",
          messages: [{ id: "m1", role: "user", content: "Hello, how are you?", createdAt: new Date().toISOString() }],
          runs: [],
          lastUpdatedAt: new Date().toISOString(),
        },
        state: dirtyState,
      }),
      "ambient",
    );
  });

  it("keeps casual active runs ambient when no risky action is requested", () => {
    const runningState = deriveTrustGate({
      changedFiles: [],
      commands: [],
      evidencePack: null,
      health: { gitDirtyState: "clean" } as WorkspaceHealthProfile,
      isRunning: true,
      summary: {
        affectedCount: 0,
        serviceCount: 0,
        toolFanoutCount: 0,
        risk: "None",
      },
    });

    assert.equal(runningState.status, "resolving");
    assert.equal(
      getShipStatusMode({
        conversation: {
          id: "c1",
          title: "Chat",
          messages: [{ id: "m1", role: "user", content: "hello, how are you?", createdAt: new Date().toISOString() }],
          runs: [],
          lastUpdatedAt: new Date().toISOString(),
        },
        state: runningState,
      }),
      "ambient",
    );
  });

  it("triggers active gate for can I ship prompts", () => {
    assert.equal(detectActiveGateIntent("can I ship?"), true);
    assert.equal(
      getShipStatusMode({
        conversation: {
          id: "c1",
          title: "Chat",
          messages: [{ id: "m1", role: "user", content: "can I ship?", createdAt: new Date().toISOString() }],
          runs: [],
          lastUpdatedAt: new Date().toISOString(),
        },
        state: dirtyState,
      }),
      "active",
    );
  });

  it("uses ambient safety for unvalidated changed files while idle", () => {
    assert.equal(getShipStatusMode({ conversation: null, state: dirtyState }), "ambient");
    assert.equal(getTopbarRepoSafetyLabel(dirtyState), "Needs check");
  });

  it("uses active gate for commit intent with unvalidated changes", () => {
    assert.equal(
      getShipStatusMode({
        activeGateRequested: true,
        conversation: null,
        state: dirtyState,
      }),
      "active",
    );
    assert.equal(dirtyState.headline, "Needs check");
  });

  it("uses active gate when risky surfaces changed after agent file modifications", () => {
    const riskyState = deriveTrustGate({
      changedFiles: ["src/electron/ipc-service.ts"],
      commands: [],
      evidencePack: null,
      health: { gitDirtyState: "dirty" } as WorkspaceHealthProfile,
      summary: {
        affectedCount: 1,
        serviceCount: 1,
        toolFanoutCount: 0,
        risk: "Low risk",
      },
    });

    assert.equal(riskyState.status, "risky");
    assert.equal(getShipStatusMode({ conversation: null, state: riskyState }), "active");
    assert.equal(riskyState.primaryActionLabel, "Inspect risky changes");
  });

  it("uses active gate after assistant tool events modify files", () => {
    assert.equal(
      getShipStatusMode({
        conversation: {
          id: "c1",
          title: "Chat",
          messages: [
            { id: "m1", role: "user", content: "fix the issue", createdAt: new Date().toISOString() },
            {
              id: "m2",
              role: "assistant",
              content: "Updated the file.",
              createdAt: new Date().toISOString(),
              events: [{ id: "e1", label: "file_editor", detail: "Edited src/app.ts", status: "done" }],
            },
          ],
          runs: [],
          lastUpdatedAt: new Date().toISOString(),
        },
        state: dirtyState,
      }),
      "active",
    );
  });

  it("never labels unvalidated changes as Validated in the topbar", () => {
    assert.equal(getTopbarRepoSafetyLabel(dirtyState), "Needs check");
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
