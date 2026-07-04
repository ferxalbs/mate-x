import type {
  AssistantRunOptions,
  AssistantRunbookDefinition,
  AssistantRunbookId,
} from "../contracts/chat";
import { normalizeRainyServiceTier } from "../contracts/rainy";
import type { WorkPlan } from "./work-engine/types";

const DEFAULT_ASSISTANT_OPTIONS: AssistantRunOptions = {
  reasoningEnabled: true,
  reasoning: "high",
  mode: "build",
  access: "approval",
  runbookId: "patch_test_verify",
};

const RUNBOOK_DEFINITIONS: Record<
  AssistantRunbookId,
  AssistantRunbookDefinition
> = {
  patch_test_verify: {
    id: "patch_test_verify",
    name: "Reproduce -> Patch -> Test -> Verify",
    objective:
      "Reproduce or statically prove the issue before patching, then deliver safe code change with test and verification evidence.",
    mandatoryStages: [
      {
        id: "reproduce",
        name: "Reproduce",
        required: true,
        description:
          "Create, find, or describe the smallest non-invasive reproducible check before patching.",
      },
      {
        id: "patch",
        name: "Patch",
        required: true,
        description:
          "Define target files and apply minimal scoped code changes.",
      },
      {
        id: "test",
        name: "Test",
        required: true,
        description:
          "Run relevant checks and record concrete pass/fail or blocked status.",
      },
      {
        id: "verify",
        name: "Verify",
        required: true,
        description:
          "Confirm behavior, summarize residual risk, and map outcomes to user request.",
      },
    ],
    requiredChecks: [
      "Record reproduction type: unit test, integration test, minimal script, HTTP request, browser scenario, validation run, or static proof.",
      "Track whether reproduction existed before patch and whether it fails before patch and passes after patch.",
      "Show exactly what changed.",
      "Run at least one relevant validation command or explain blockage.",
      "State whether requested behavior is now satisfied.",
    ],
    successCriteria: [
      "Reproduce stage has command, location, or static proof summary.",
      "Patch stage complete with touched files listed.",
      "Test stage complete with command and outcome.",
      "Verify stage complete with confidence and unresolved risks.",
    ],
    stopConditions: [
      "Safety or trust-contract policy prevents required action.",
      "Test failure indicates regression or uncertain outcome.",
      "Insufficient repository evidence to complete verification.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Reproduction:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  audit_reproduce_remediate: {
    id: "audit_reproduce_remediate",
    name: "Audit -> Reproduce -> Remediate",
    objective:
      "Audit suspicious behavior, reproduce issue deterministically, then remediate with evidence.",
    mandatoryStages: [
      {
        id: "audit",
        name: "Audit",
        required: true,
        description:
          "Inspect relevant code paths, configs, and signals to identify risk surface.",
      },
      {
        id: "reproduce",
        name: "Reproduce",
        required: true,
        description:
          "Create, find, or describe the smallest non-invasive reproducible check with expected/actual behavior.",
      },
      {
        id: "remediate",
        name: "Remediate",
        required: true,
        description:
          "Apply mitigation or fix, then confirm risk reduction and side effects.",
      },
    ],
    requiredChecks: [
      "List impacted component or file boundaries.",
      "Include exact reproduction command or procedure, or static proof when runtime repro is impossible.",
      "Track whether reproduction existed before patch and whether it fails before patch and passes after patch.",
      "State remediation scope and potential regressions.",
    ],
    successCriteria: [
      "Audit stage identifies root cause or narrowed hypothesis.",
      "Reproduction stage is repeatable.",
      "Remediation stage includes validation result.",
    ],
    stopConditions: [
      "Unable to reproduce despite complete inputs.",
      "Remediation introduces unacceptable security or stability risk.",
      "Required environment or permissions unavailable.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Reproduction:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  review_classify_summarize: {
    id: "review_classify_summarize",
    name: "Review -> Classify -> Summarize",
    objective:
      "Review findings, classify by severity/impact, and summarize actionable outcomes.",
    mandatoryStages: [
      {
        id: "review",
        name: "Review",
        required: true,
        description:
          "Inspect relevant artifacts and collect concrete findings with references.",
      },
      {
        id: "classify",
        name: "Classify",
        required: true,
        description:
          "Rank findings by severity, exploitability, and confidence.",
      },
      {
        id: "summarize",
        name: "Summarize",
        required: true,
        description:
          "Deliver concise executive and technical summary with next actions.",
      },
    ],
    requiredChecks: [
      "Every finding includes evidence or rationale.",
      "Classification uses explicit severity labels.",
      "Summary includes top risks and remediation priority.",
    ],
    successCriteria: [
      "No unclassified critical finding remains.",
      "Classification rationale is consistent.",
      "Summary supports immediate decision-making.",
    ],
    stopConditions: [
      "Evidence insufficient to classify with confidence.",
      "Source artifacts missing or corrupted.",
      "Requested scope conflicts with trust policy.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
  scan_contain_report: {
    id: "scan_contain_report",
    name: "Scan -> Contain -> Report",
    objective:
      "Scan for active threats, contain blast radius, and report status with traceable evidence.",
    mandatoryStages: [
      {
        id: "scan",
        name: "Scan",
        required: true,
        description:
          "Identify indicators of compromise, exposure, or policy violations.",
      },
      {
        id: "contain",
        name: "Contain",
        required: true,
        description:
          "Apply immediate controls to reduce spread and protect critical assets.",
      },
      {
        id: "report",
        name: "Report",
        required: true,
        description:
          "Communicate incident status, impact, and remaining risks to stakeholders.",
      },
    ],
    requiredChecks: [
      "Document indicators and scan scope.",
      "Describe containment action and residual exposure.",
      "Include incident timeline and owner handoff notes.",
    ],
    successCriteria: [
      "Scan evidence captures current threat state.",
      "Containment materially reduces exposure.",
      "Report includes clear recommendations and open risks.",
    ],
    stopConditions: [
      "Containment action could cause broader outage without approval.",
      "Insufficient privileges to apply controls.",
      "Threat state unknown due to missing telemetry.",
    ],
    finalEvidenceFormat: [
      "Objective:",
      "Stages:",
      "Checks:",
      "Success criteria:",
      "Stop conditions:",
      "Final evidence:",
    ],
  },
};

export function resolveAssistantRunOptions(
  options?: AssistantRunOptions,
): AssistantRunOptions {
  return {
    reasoningEnabled: options?.reasoningEnabled !== false,
    reasoning:
      typeof options?.reasoning === "string" && options.reasoning.trim()
        ? options.reasoning
        : DEFAULT_ASSISTANT_OPTIONS.reasoning,
    mode:
      options?.mode === "plan" || options?.mode === "critic_loop"
        ? options.mode
        : DEFAULT_ASSISTANT_OPTIONS.mode,
    access:
      options?.access === "approval" || options?.access === "full"
        ? options.access
        : DEFAULT_ASSISTANT_OPTIONS.access,
    serviceTier: normalizeRainyServiceTier(options?.serviceTier),
    runbookId: resolveRunbookId(options?.runbookId),
    attachments: options?.attachments?.map((attachment) => ({ ...attachment })) ?? [],
  };
}

export function resolveRunbookId(
  runbookId?: AssistantRunbookId,
): AssistantRunbookId {
  return runbookId && RUNBOOK_DEFINITIONS[runbookId]
    ? runbookId
    : (DEFAULT_ASSISTANT_OPTIONS.runbookId ?? "patch_test_verify");
}

export function resolveRunbookDefinition(
  runbookId: AssistantRunbookId,
): AssistantRunbookDefinition {
  return RUNBOOK_DEFINITIONS[runbookId];
}

export function toAssistantRunbookId(
  runbook: WorkPlan["runbook"],
): AssistantRunbookId {
  switch (runbook) {
    case "audit_reproduce_remediate":
      return "audit_reproduce_remediate";
    case "scan_contain_report":
    case "evidence_only":
      return "scan_contain_report";
    case "review_classify_summarize":
    case "answer_from_context":
    case "inspect_explain":
    case "trace_source_to_sink":
    case "validate_only":
      return "review_classify_summarize";
    case "patch_test_verify":
    default:
      return "patch_test_verify";
  }
}

export function renderRunbookForPrompt(
  runbook: AssistantRunbookDefinition,
): string {
  const mandatoryStages = runbook.mandatoryStages
    .map(
      (stage, index) =>
        `${index + 1}. ${stage.name} (${stage.required ? "required" : "optional"}) - ${stage.description}`,
    )
    .join("\n");
  const requiredChecks = runbook.requiredChecks
    .map((check, index) => `${index + 1}. ${check}`)
    .join("\n");
  const successCriteria = runbook.successCriteria
    .map((criterion, index) => `${index + 1}. ${criterion}`)
    .join("\n");
  const stopConditions = runbook.stopConditions
    .map((condition, index) => `${index + 1}. ${condition}`)
    .join("\n");
  const finalEvidenceFormat = runbook.finalEvidenceFormat
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");

  return [
    `Runbook: ${runbook.name}`,
    `Objective: ${runbook.objective}`,
    "Mandatory stages:",
    mandatoryStages,
    "Required checks:",
    requiredChecks,
    "Success criteria:",
    successCriteria,
    "Stop conditions:",
    stopConditions,
    "Final evidence format:",
    finalEvidenceFormat,
  ].join("\n");
}
