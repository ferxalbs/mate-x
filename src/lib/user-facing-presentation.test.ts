import assert from "node:assert/strict";
import { test } from "bun:test";

import type {
  UserFacingPresentation,
  UserFacingPresentationInput,
} from "../contracts/presentation";
import { presentUserFacingResponse } from "./user-facing-presentation";

const INTERNAL_TERMS =
  /WorkPlan|objective\s+satisfied|no-op|changed_unverified|validation\s+not\s+applicable|tool\s+round|agent\s+pass|repository\s+assertion|execution\s+outcome|internal\s+error|ERR_[A-Z0-9_]+/i;

const requiredValidationContract = (status: "passed" | "failed" | "not_run") => ({
  schemaVersion: 1 as const,
  items: [{
    id: "typecheck",
    signal: "typecheck" as const,
    obligation: "required" as const,
    trigger: "after_mutation" as const,
    applicability: "applicable" as const,
    availability: status === "not_run" ? "unavailable" as const : "resolved" as const,
    command: "repository-local typecheck",
    commandSource: "repository_script" as const,
    evidence: { status: status === "not_run" ? "not_run" as const : status },
    reason: "The changed repository requires a typecheck.",
  }],
  actualMutation: true,
  objectiveAlreadySatisfied: false,
  validationIsPrimaryObjective: false,
  compiledAt: "2026-08-04T00:00:00.000Z",
  source: "canonical_compiler" as const,
});

const scenarios: Array<{
  name: string;
  input: UserFacingPresentationInput;
  state: UserFacingPresentation["presentationState"];
  card: boolean;
  responseIncludes?: string;
  responseEquals?: string;
  nextAction?: boolean;
}> = [
  {
    name: "conversation",
    input: {
      presentationIntent: "conversation",
      naturalSynthesis: "Here is the short answer to your question.",
      synthesisStatus: "valid",
    },
    state: "conversation",
    card: false,
    responseEquals: "Here is the short answer to your question.",
  },
  {
    name: "repository explanation",
    input: {
      presentationIntent: "repository_overview",
      naturalSynthesis: "This project starts in the desktop entry point and loads the renderer.",
      synthesisStatus: "valid",
      completionKind: "inspection_completed",
      terminalState: "completed",
    },
    state: "repository_overview",
    card: false,
    responseEquals: "This project starts in the desktop entry point and loads the renderer.",
  },
  {
    name: "read-only review with findings",
    input: {
      presentationIntent: "review",
      naturalSynthesis: "I found one candidate issue in the inspected scope.",
      synthesisStatus: "valid",
      completionKind: "inspection_completed",
      terminalState: "completed",
      findingsCount: 1,
    },
    state: "review_complete",
    card: false,
  },
  {
    name: "read-only review without findings",
    input: {
      presentationIntent: "review",
      naturalSynthesis: "No findings were produced for the inspected scope.",
      synthesisStatus: "valid",
      completionKind: "inspection_completed",
      terminalState: "completed",
      findingsCount: 0,
    },
    state: "review_complete",
    card: false,
  },
  {
    name: "successful modification",
    input: {
      presentationIntent: "change",
      naturalSynthesis: "Updated the requested configuration.",
      synthesisStatus: "valid",
      completionKind: "changed_verified",
      terminalState: "completed",
      changedFiles: [{ path: "src/config.ts", operation: "modified" }],
      validation: { status: "passed", freshness: "current_run" },
    },
    state: "change_applied",
    card: false,
    responseEquals: "Updated the requested configuration.",
  },
  {
    name: "requested state already present",
    input: {
      presentationIntent: "change",
      synthesisStatus: "missing",
      completionKind: "already_satisfied",
      terminalState: "completed",
    },
    state: "already_present",
    card: false,
    responseIncludes: "already present",
  },
  {
    name: "validation success",
    input: {
      presentationIntent: "validation",
      synthesisStatus: "missing",
      completionKind: "validation_completed",
      terminalState: "completed",
      validation: { status: "passed", freshness: "current_run" },
    },
    state: "validation_complete",
    card: false,
    responseIncludes: "checks passed",
  },
  {
    name: "validation failure",
    input: {
      presentationIntent: "validation",
      synthesisStatus: "missing",
      completionKind: "failed",
      terminalState: "failed",
      validation: {
        status: "failed",
        contract: requiredValidationContract("failed"),
      },
    },
    state: "failed",
    card: true,
    responseIncludes: "couldn't complete",
    nextAction: true,
  },
  {
    name: "partial result",
    input: {
      presentationIntent: "change",
      synthesisStatus: "missing",
      completionKind: "changed_unverified",
      terminalState: "partial",
      changedFiles: [{ path: "src/partial.ts", operation: "modified" }],
      validation: { status: "not_run", cause: "required check unavailable" },
    },
    state: "partial",
    card: true,
    responseIncludes: "not complete",
    nextAction: true,
  },
  {
    name: "blocked operation",
    input: {
      presentationIntent: "change",
      synthesisStatus: "missing",
      terminalState: "blocked",
      completionKind: "blocked",
      blocker: { kind: "blocked", summary: "The workspace needs permission to continue." },
    },
    state: "blocked",
    card: true,
    responseIncludes: "couldn't continue",
    nextAction: true,
  },
  {
    name: "approval required",
    input: {
      presentationIntent: "change",
      synthesisStatus: "missing",
      terminalState: "blocked",
      completionKind: "awaiting_approval",
      approvalRequired: true,
    },
    state: "approval_required",
    card: true,
    responseIncludes: "approval",
    nextAction: true,
  },
  {
    name: "runtime failure",
    input: {
      presentationIntent: "change",
      synthesisStatus: "failed",
      terminalState: "failed",
      completionKind: "failed",
    },
    state: "failed",
    card: true,
    responseIncludes: "couldn't complete",
    nextAction: true,
  },
  {
    name: "missing synthesis",
    input: {
      presentationIntent: "repository_overview",
      synthesisStatus: "missing",
      terminalState: "completed",
      completionKind: "inspection_completed",
      inspection: { coverage: "partial" },
    },
    state: "repository_overview",
    card: false,
    responseIncludes: "repository overview",
    nextAction: false,
  },
];

for (const scenario of scenarios) {
  test(`presentation scenario: ${scenario.name}`, () => {
    const presentation = presentUserFacingResponse(scenario.input);

    assert.equal(presentation.presentationState, scenario.state);
    assert.equal(presentation.showFullOutcomeCard, scenario.card);
    if (scenario.responseEquals) assert.equal(presentation.primaryResponse, scenario.responseEquals);
    if (scenario.responseIncludes) assert.match(presentation.primaryResponse.toLowerCase(), new RegExp(scenario.responseIncludes));
    if (scenario.nextAction !== undefined) assert.equal(Boolean(presentation.nextAction), scenario.nextAction);
    assert.equal(INTERNAL_TERMS.test(JSON.stringify(presentation)), false);
  });
}

test("historical evidence is labeled without changing the natural answer", () => {
  const presentation = presentUserFacingResponse({
    presentationIntent: "change",
    naturalSynthesis: "The earlier checks passed and the requested change is ready for review.",
    synthesisStatus: "valid",
    terminalState: "completed",
    completionKind: "changed_verified",
    changedFiles: [{ path: "src/feature.ts", operation: "modified" }],
    validation: { status: "passed", freshness: "historical" },
  });

  assert.equal(
    presentation.primaryResponse,
    "The earlier checks passed and the requested change is ready for review.",
  );
  assert.match(presentation.compactEvidence ?? "", /Historical Checks passed/);
});

test("historical fallback evidence is identified as historical", () => {
  const presentation = presentUserFacingResponse({
    presentationIntent: "validation",
    naturalSynthesis: "The checks passed.",
    synthesisStatus: "valid",
    terminalState: "completed",
    completionKind: "validation_completed",
    validation: { status: "passed", freshness: "historical" },
  });

  assert.match(presentation.primaryResponse, /^Historical checks passed\.$/);
  assert.match(presentation.compactEvidence ?? "", /^Historical Checks passed$/);
});

test("inspection does not become a runtime validation claim", () => {
  const presentation = presentUserFacingResponse({
    presentationIntent: "review",
    synthesisStatus: "missing",
    terminalState: "completed",
    completionKind: "inspection_completed",
    findingsCount: 0,
    inspection: {
      count: 3,
      label: "services",
      status: "satisfied",
      coverage: "complete",
    },
    validation: { status: "not_run" },
  });

  assert.match(presentation.compactEvidence ?? "", /3 services checked/);
  assert.match(presentation.primaryResponse, /reviewed/);
  assert.match(presentation.primaryResponse, /runtime checks were not run/);
  assert.doesNotMatch(presentation.primaryResponse, /runtime verified/i);
});

test("activity summaries prefer user-meaningful typed work", () => {
  const activity = presentUserFacingResponse({
    presentationIntent: "repository_overview",
    synthesisStatus: "valid",
    naturalSynthesis: "The overview is ready.",
    terminalState: "completed",
    completionKind: "inspection_completed",
    activity: {
      events: [{
        id: "search",
        label: "Search completed",
        detail: "",
        type: "search",
        status: "completed",
        visibility: "public",
      }],
    },
  });

  assert.equal(activity.activitySummary, "Project structure reviewed");
  assert.doesNotMatch(activity.activitySummary ?? "", /Search completed/i);
});
