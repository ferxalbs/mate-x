import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGINEERING_TASK_STATUSES,
  ERR_CODES,
  ID_PREFIX,
  PATH_KINDS,
  READINESS_LABELS,
  canTransition,
  getTransition,
  isEngineeringTaskId,
  isIdWithPrefix,
  isLegalCommandForStatus,
  isTerminalStatus,
  parseDisplayId,
  transitionOrThrow,
  validateIdFormat,
  type EngineeringCommandType,
  type EngineeringTaskStatus,
} from "./engineering-task";

describe("EngineeringTask ID formats [NES-1.1]", () => {
  it("accepts etask_ prefix with non-empty body", () => {
    assert.equal(isEngineeringTaskId("etask_01HXYZABCDEF"), true);
    assert.equal(isEngineeringTaskId("etask_"), false);
    assert.equal(isEngineeringTaskId("unit_01HXYZ"), false);
    assert.equal(isEngineeringTaskId("etask-01HXYZ"), false);
  });

  it("validates namespaced id prefixes", () => {
    assert.equal(isIdWithPrefix("spec_01A", ID_PREFIX.specification), true);
    assert.equal(isIdWithPrefix("proof_01A", ID_PREFIX.proof), true);
    assert.equal(isIdWithPrefix("lease_01A", ID_PREFIX.lease), true);
    assert.equal(isIdWithPrefix("pol_01A", ID_PREFIX.policyPack), true);
    assert.equal(isIdWithPrefix("exe_01A", ID_PREFIX.execution), true);
    assert.equal(validateIdFormat("dec_01A", "decision").ok, true);
    assert.equal(validateIdFormat("bad", "decision").ok, false);
  });

  it("parses display ids REQ/AC/TSK/SC", () => {
    assert.deepEqual(parseDisplayId("REQ-001"), { kind: "REQ", n: 1 });
    assert.deepEqual(parseDisplayId("AC-12"), { kind: "AC", n: 12 });
    assert.deepEqual(parseDisplayId("TSK-003"), { kind: "TSK", n: 3 });
    assert.deepEqual(parseDisplayId("SC-1"), { kind: "SC", n: 1 });
    assert.equal(parseDisplayId("REQ-"), null);
    assert.equal(parseDisplayId("req-001"), null);
  });
});

describe("EngineeringTask status catalog [NES-1.1]", () => {
  it("frozen status enum has exactly collapsed statuses", () => {
    assert.deepEqual(ENGINEERING_TASK_STATUSES, [
      "captured",
      "clarifying",
      "specified",
      "planning",
      "planned",
      "awaiting_approval",
      "executing",
      "verifying",
      "converging",
      "ready",
      "blocked",
      "failed",
      "cancelled",
    ]);
  });

  it("terminal statuses are ready, failed, cancelled (blocked is resumable)", () => {
    assert.equal(isTerminalStatus("ready"), true);
    assert.equal(isTerminalStatus("failed"), true);
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("blocked"), false);
    assert.equal(isTerminalStatus("executing"), false);
  });
});

describe("EngineeringTask transition table [NES-1.1]", () => {
  const legal: Array<{
    from: EngineeringTaskStatus | null;
    command: EngineeringCommandType;
    to: EngineeringTaskStatus;
  }> = [
    { from: null, command: "CaptureTask", to: "captured" },
    { from: "captured", command: "StartClarification", to: "clarifying" },
    { from: "captured", command: "FreezeSpecification", to: "specified" },
    { from: "clarifying", command: "FreezeSpecification", to: "specified" },
    { from: "specified", command: "StartPlanCompilation", to: "planning" },
    { from: "planning", command: "CompletePlanCompilation", to: "planned" },
    { from: "planned", command: "CompileTaskGraph", to: "planned" },
    { from: "planned", command: "SubmitForApproval", to: "awaiting_approval" },
    { from: "awaiting_approval", command: "ApprovePlanAndTasks", to: "executing" },
    { from: "awaiting_approval", command: "RejectApproval", to: "planned" },
    { from: "executing", command: "BeginVerification", to: "verifying" },
    { from: "verifying", command: "BeginCoverageConvergence", to: "converging" },
    { from: "converging", command: "AcceptConvergence", to: "ready" },
    { from: "converging", command: "EnqueueRemediation", to: "executing" },
    { from: "blocked", command: "ResumeTask", to: "blocked" },
  ];

  it("legal transitions are accepted", () => {
    for (const edge of legal) {
      assert.equal(canTransition(edge.from, edge.command), true);
      const result = getTransition(edge.from, edge.command);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.to, edge.to);
      }
    }
  });

  it("illegal transitions fail closed with ERR_ILLEGAL_TRANSITION", () => {
    const illegal: Array<{
      from: EngineeringTaskStatus | null;
      command: EngineeringCommandType;
    }> = [
      { from: null, command: "FreezeSpecification" },
      { from: "captured", command: "ApprovePlanAndTasks" },
      { from: "captured", command: "AcceptConvergence" },
      { from: "specified", command: "ApprovePlanAndTasks" },
      { from: "awaiting_approval", command: "CaptureTask" },
      { from: "ready", command: "ApprovePlanAndTasks" },
      { from: "ready", command: "BeginVerification" },
      { from: "cancelled", command: "ResumeTask" },
      { from: "failed", command: "ApprovePlanAndTasks" },
      { from: "executing", command: "AcceptConvergence" },
      { from: "planned", command: "ApprovePlanAndTasks" },
    ];

    for (const edge of illegal) {
      assert.equal(canTransition(edge.from, edge.command), false);
      const result = getTransition(edge.from, edge.command);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, ERR_CODES.ERR_ILLEGAL_TRANSITION);
      }
      assert.throws(
        () => transitionOrThrow(edge.from, edge.command),
        /ERR_ILLEGAL_TRANSITION/,
      );
    }
  });

  it("RejectApproval never lands on executing", () => {
    const result = getTransition("awaiting_approval", "RejectApproval");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.to, "executing");
      assert.ok(["planned", "clarifying"].includes(result.to));
    }
    const toClarify = getTransition("awaiting_approval", "RejectApproval", {
      rejectTarget: "clarifying",
    });
    assert.equal(toClarify.ok, true);
    if (toClarify.ok) {
      assert.equal(toClarify.to, "clarifying");
    }
  });

  it("block/fail/cancel allowed from non-terminal statuses", () => {
    const nonTerminal: EngineeringTaskStatus[] = [
      "captured",
      "clarifying",
      "specified",
      "planning",
      "planned",
      "awaiting_approval",
      "executing",
      "verifying",
      "converging",
      "blocked",
    ];
    for (const status of nonTerminal) {
      assert.equal(canTransition(status, "BlockTask"), true);
      assert.equal(canTransition(status, "FailTask"), true);
      assert.equal(canTransition(status, "CancelTask"), true);
      assert.deepEqual(getTransition(status, "BlockTask"), {
        ok: true,
        to: "blocked",
      });
      assert.deepEqual(getTransition(status, "FailTask"), {
        ok: true,
        to: "failed",
      });
      assert.deepEqual(getTransition(status, "CancelTask"), {
        ok: true,
        to: "cancelled",
      });
    }

    for (const terminal of ["ready", "failed", "cancelled"] as const) {
      assert.equal(canTransition(terminal, "BlockTask"), false);
      assert.equal(canTransition(terminal, "FailTask"), false);
      assert.equal(canTransition(terminal, "CancelTask"), false);
    }
  });

  it("isLegalCommandForStatus mirrors canTransition", () => {
    assert.equal(isLegalCommandForStatus("captured", "FreezeSpecification"), true);
    assert.equal(isLegalCommandForStatus("ready", "FreezeSpecification"), false);
  });
});

describe("pathKind is not a user mode [NES-1.1]", () => {
  it("pathKind union is full | verify_only | chat_help only", () => {
    assert.deepEqual(PATH_KINDS, ["full", "verify_only", "chat_help"]);
    assert.equal((PATH_KINDS as readonly string[]).includes("factory"), false);
    assert.equal((PATH_KINDS as readonly string[]).includes("ship"), false);
    assert.equal((PATH_KINDS as readonly string[]).includes("chat"), false);
    assert.equal((PATH_KINDS as readonly string[]).includes("plan"), false);
  });
});

describe("readiness labels [NES-1.1]", () => {
  it("exactly five readiness labels", () => {
    assert.deepEqual(READINESS_LABELS, [
      "Ready",
      "Needs check",
      "Risk found",
      "Blocked",
      "Not proven",
    ]);
  });
});
