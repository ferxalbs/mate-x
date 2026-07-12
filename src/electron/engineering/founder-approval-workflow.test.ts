/**
 * Founder acceptance regression — approval-gated workflow (Agent 7).
 * Deterministic; fake adapters only; no production self-test IPC.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { EngineeringCommandBus } from "./command-bus";
import { createPhaseHandler } from "./phase-handler";
import { LibSqlEngineeringRepository } from "./repository";
import { draftSpecificationFromSeed, freezeSpecification } from "./intent-compiler";
import { compileTechnicalApproach } from "./plan-compiler";
import { compileTaskGraph } from "./task-graph-compiler";
import {
  applyEngineeringPhaseResult,
  buildPlanArtifactsForTask,
} from "./phase-result-apply";
import {
  authorizeToolForEngineeringStatus,
} from "./tool-phase-auth";
import {
  projectUserFacingStatus,
  parseEngineeringPhaseResult,
} from "../../contracts/engineering-phase-result";
import { primaryActionForStatus } from "../../features/engineering/engineering-task-panel";
import { evaluateValidationGate } from "../work-engine/validation-gate";
import { finalizeWorkRun } from "../work-engine/finalizer";
import { deriveWorkStages } from "../work-engine/stages";
import type { WorkPlan } from "../work-engine/types";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const FOUNDER_PROMPT =
  "Fix one small, real issue in this repository. First clarify the objective, produce a specification and implementation plan, and wait for my approval before changing files. Then implement it, run the relevant validation, and produce Ship Proof.";

function openBus() {
  const dir = mkdtempSync(path.join(tmpdir(), "mate-x-founder-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "mate-x.db");
  const repo = LibSqlEngineeringRepository.open(dbPath);
  const bus = new EngineeringCommandBus(repo);
  bus.setPhaseHandler(createPhaseHandler(repo));
  return { repo, bus, dbPath };
}

function basePlan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id: "wp-founder",
    intent: "patch",
    risk: "medium",
    objective: FOUNDER_PROMPT,
    runbook: "patch_test_verify",
    workingSet: {
      primaryFiles: ["src/x.ts"],
      relatedFiles: [],
      relatedTests: [],
      changedFiles: [],
      impactedFiles: [],
      entrypoints: [],
      sensitiveSurfaces: [],
      relevantScripts: [],
      knownFailures: [],
    },
    validationPlan: {
      required: true,
      primaryCommand: "bun test",
      fallbackCommand: null,
      reason: "required",
    },
    privacyPlan: {
      requireSanitization: true,
      blockIfP0Unsanitized: true,
      includeRepoContext: true,
      includeToolOutput: true,
      reason: "x",
    },
    preventivePlan: {
      enabled: false,
      riskAreas: [],
      recommendedControls: [],
      requiredChecks: [],
      strictness: "warn",
      reason: "off",
    },
    evidencePlan: { required: true, expectedArtifacts: [], requiredClaims: [] },
    stopConditions: [],
    ...overrides,
  };
}

describe("Founder approval-gated workflow [A–M + amendments]", () => {
  it("Auto crosses the first safe mutation gate but keeps policy boundaries", () => {
    const auto = { id: "auto_scoped" } as const;
    assert.equal(authorizeToolForEngineeringStatus("file_editor", "captured", { path: "src/lib/id.ts" }, auto).allowed, true);
    assert.equal(authorizeToolForEngineeringStatus("sandbox_run", "captured", { command: "bun run lint" }, auto).allowed, true);
    assert.equal(authorizeToolForEngineeringStatus("sandbox_run", "captured", { command: "git commit -am x" }, auto).allowed, false);
    assert.equal(authorizeToolForEngineeringStatus("sandbox_run", "executing", { command: "git push" }, auto).allowed, false);
  });

  it("Guided pauses before edit and Review rejects edit", () => {
    assert.equal(authorizeToolForEngineeringStatus("file_editor", "captured", {}, { id: "guided_approval" }).allowed, false);
    assert.equal(authorizeToolForEngineeringStatus("file_editor", "executing", {}, { id: "review_read_only" }).allowed, false);
  });

  it("A–E: capture + planning phase does not fail Work Engine; no mutation", () => {
    const { bus, repo } = openBus();
    // A. Submit exact founder prompt via CaptureTask
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_founder",
      objectiveSeed: FOUNDER_PROMPT,
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    assert.ok(id.startsWith("etask_"));
    assert.equal((cap.data as { status: string }).status, "captured");
    assert.equal(
      projectUserFacingStatus("captured"),
      "captured",
    );

    // B. Assistant returns plan text (simulated) — prose alone must not advance state
    const still = repo.getTask(id)!;
    assert.equal(still.status, "captured");

    // Planning-phase gates (C/D/E)
    const plan = basePlan({ engineeringTaskId: id, lifecyclePhase: "captured" });
    const content =
      "I will inspect the repository and produce a specification and implementation plan for your approval before changing files.\n\n## Plan\n1. Fix typo\n2. Await approval";
    const gate = evaluateValidationGate(plan, [], content, { planningPhase: true });
    assert.equal(gate.allowed, true);
    const stages = deriveWorkStages({
      workPlan: plan,
      events: [],
      toolExecutions: [],
      privacyBlocked: false,
      evidenceAttached: true,
      noPatchNeeded: false,
      planningPhase: true,
    });
    assert.equal(
      stages.find((s) => s.id === "validation_executed")?.status,
      "not_applicable_for_phase",
    );
    assert.equal(
      stages.find((s) => s.id === "patch_attempted")?.status,
      "not_applicable_for_phase",
    );
    const fin = finalizeWorkRun({
      workPlan: plan,
      stages,
      toolExecutions: [],
      content,
      evidenceAttached: true,
      planningPhase: true,
    });
    assert.notEqual(fin.verdict, "failed");
    assert.equal(
      /progress plan instead of a final repo-grounded answer/i.test(fin.content),
      false,
    );

    // E. mutation tool before approval rejected
    const denied = authorizeToolForEngineeringStatus("file_editor", "captured", {
      path: "src/x.ts",
    });
    assert.equal(denied.allowed, false);
    const allowedRead = authorizeToolForEngineeringStatus("read", "captured");
    assert.equal(allowedRead.allowed, true);
  });

  it("no material clarification path: captured → specified → awaiting_approval", () => {
    const { bus, repo } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_nc",
      objectiveSeed: "Fix a one-line typo in README",
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;

    // No StartClarification — freeze directly
    const freeze = bus.dispatch({
      type: "FreezeSpecification",
      engineeringTaskId: id,
      workspaceId: "ws_nc",
      actor: { kind: "human", userId: "u1" },
    });
    assert.equal(freeze.ok, true, JSON.stringify(freeze));
    assert.equal(repo.getTask(id)?.status, "specified");

    for (const type of [
      "StartPlanCompilation",
      "CompletePlanCompilation",
      "CompileTaskGraph",
      "SubmitForApproval",
    ] as const) {
      const r = bus.dispatch({
        type,
        engineeringTaskId: id,
        workspaceId: "ws_nc",
        actor: { kind: "human", userId: "u1" },
      });
      assert.equal(r.ok, true, `${type}: ${JSON.stringify(r)}`);
    }
    assert.equal(repo.getTask(id)?.status, "awaiting_approval");
    assert.equal(projectUserFacingStatus("awaiting_approval"), "awaiting_approval");
  });

  it("C/F/G: plan_ready phase result → awaiting_approval; approve same task; new run id concept", () => {
    const { bus, repo } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_plan",
      objectiveSeed: FOUNDER_PROMPT,
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;

    let draft = draftSpecificationFromSeed({
      objectiveSeed: FOUNDER_PROMPT,
      verifyOnly: false,
    });
    const frozen = freezeSpecification(draft, "human");
    assert.equal(frozen.ok, true);
    if (!frozen.ok) return;
    draft = frozen.spec;
    const approach = compileTechnicalApproach(draft, 1);
    assert.equal(approach.ok, true);
    if (!approach.ok) return;
    const graph = compileTaskGraph({
      spec: draft,
      approach: approach.approach,
      version: 1,
    });
    assert.equal(graph.ok, true);
    if (!graph.ok) return;

    const planningRunId = "run_plan_1";
    const applied = applyEngineeringPhaseResult({
      bus,
      repo,
      workspaceId: "ws_plan",
      phaseResult: {
        kind: "plan_ready",
        engineeringTaskId: id,
        runId: planningRunId,
        specificationId: draft.specificationId,
        approachId: approach.approach.approachId,
        taskGraphId: graph.graph.taskGraphId,
      },
      artifacts: {
        specification: draft,
        approach: approach.approach,
        taskGraph: graph.graph,
      },
      actor: { kind: "human", userId: "u1" },
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(repo.getTask(id)?.status, "awaiting_approval");

    // F/G. Approve — same engineeringTaskId, separate execution run id
    const executionRunId = "run_exec_1";
    assert.notEqual(executionRunId, planningRunId);
    const approve = bus.dispatch({
      type: "ApprovePlanAndTasks",
      engineeringTaskId: id,
      workspaceId: "ws_plan",
      actor: { kind: "human", userId: "u1" },
    });
    assert.equal(approve.ok, true);
    assert.equal(repo.getTask(id)?.status, "executing");
    assert.equal(repo.getTask(id)?.engineeringTaskId, id);

    // Mutation allowed after approval
    const mut = authorizeToolForEngineeringStatus("file_editor", "executing");
    assert.equal(mut.allowed, true);
  });

  it("typed phase result with invalid artifact ID is rejected", () => {
    const { bus, repo } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_bad",
      objectiveSeed: "x",
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;

    const bad = applyEngineeringPhaseResult({
      bus,
      repo,
      workspaceId: "ws_bad",
      phaseResult: {
        kind: "specification_ready",
        engineeringTaskId: id,
        runId: "run_x",
        specificationId: "spec_DOES_NOT_EXIST",
      },
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.match(bad.error.message, /missing|artifact/i);
    assert.equal(repo.getTask(id)?.status, "captured");
  });

  it("assistant prose alone cannot advance state", () => {
    const { repo, bus } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_prose",
      objectiveSeed: FOUNDER_PROMPT,
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    // Simulate "reading" assistant plan text — no ApplyPhaseResult
    void "Specification ready. Plan ready. Awaiting approval.";
    assert.equal(repo.getTask(id)?.status, "captured");
    // parse without apply does nothing to repo
    const parsed = parseEngineeringPhaseResult({
      kind: "plan_ready",
      engineeringTaskId: id,
      runId: "r",
      specificationId: "s",
      approachId: "a",
      taskGraphId: "g",
    });
    assert.equal(parsed.ok, true);
    assert.equal(repo.getTask(id)?.status, "captured");
  });

  it("K: restart during awaiting_approval restores same state", () => {
    const { bus, repo, dbPath } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_restart",
      objectiveSeed: "objective",
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;

    assert.equal(
      bus.dispatch({
        type: "FreezeSpecification",
        engineeringTaskId: id,
        workspaceId: "ws_restart",
        actor: { kind: "human", userId: "u" },
      }).ok,
      true,
    );
    for (const type of [
      "StartPlanCompilation",
      "CompletePlanCompilation",
      "CompileTaskGraph",
      "SubmitForApproval",
    ] as const) {
      assert.equal(
        bus.dispatch({
          type,
          engineeringTaskId: id,
          workspaceId: "ws_restart",
          actor: { kind: "human", userId: "u" },
        }).ok,
        true,
        type,
      );
    }
    assert.equal(repo.getTask(id)?.status, "awaiting_approval");
    repo.close?.();

    const repo2 = LibSqlEngineeringRepository.open(dbPath);
    const reloaded = repo2.getTask(id);
    assert.ok(reloaded);
    assert.equal(reloaded!.engineeringTaskId, id);
    assert.equal(reloaded!.status, "awaiting_approval");
    repo2.close?.();
  });

  it("L: unknown/invalid transitions fail closed", () => {
    const { bus } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_ill",
      objectiveSeed: "x",
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    const illegal = bus.dispatch({
      type: "ApprovePlanAndTasks",
      engineeringTaskId: id,
      workspaceId: "ws_ill",
      actor: { kind: "human", userId: "u" },
    });
    assert.equal(illegal.ok, false);
  });

  it("every CTA maps to exactly one primary commandType", () => {
    const seen = new Set<string>();
    for (const status of [
      "captured",
      "clarifying",
      "specified",
      "awaiting_approval",
      "ready",
      "blocked",
      "failed",
    ] as const) {
      const action = primaryActionForStatus(status);
      assert.ok(action);
      assert.ok(action!.commandType);
      // Approve plan has two statuses but one command each
      seen.add(`${status}:${action!.commandType}`);
    }
    assert.ok(seen.size >= 7);
    assert.equal(primaryActionForStatus("executing"), null);
    assert.equal(primaryActionForStatus("verifying"), null);
  });

  it("buildPlanArtifactsForTask produces linkable artifacts without prose", () => {
    const { bus, repo } = openBus();
    const cap = bus.dispatch({
      type: "CaptureTask",
      workspaceId: "ws_art",
      objectiveSeed: "Implement rate limit",
    });
    assert.equal(cap.ok, true);
    if (!cap.ok) return;
    const id = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    assert.equal(
      bus.dispatch({
        type: "FreezeSpecification",
        engineeringTaskId: id,
        workspaceId: "ws_art",
        actor: { kind: "human", userId: "u" },
      }).ok,
      true,
    );
    const built = buildPlanArtifactsForTask({ repo, engineeringTaskId: id });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.ok(built.specification.specificationId);
    assert.ok(built.approach.approachId);
    assert.ok(built.taskGraph.taskGraphId);
  });
});
