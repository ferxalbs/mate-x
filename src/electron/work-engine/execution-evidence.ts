import type {
  CompletionKind,
  ExecutionChangedFile,
  ExecutionEvidence,
  ExecutionSynthesisStatus,
  ExecutionTerminalState,
  NormalizedToolEvidence,
} from "../../contracts/execution";
import type { ValidationContract } from "../../contracts/work-objective";
import type { ToolExecutionRecord } from "../evidence-pack";
import type { WorkPlan } from "./types";
import type { WorkStage } from "./stages";
import { resolveObjectiveEvidence, updateObjectiveDelta } from "./objective-compiler";
import {
  activeContractForWorkPlan,
  contractForWorkPlan,
  hasHighRiskChange,
  requiredApplicableItems,
} from "../validation-contract";
import {
  isExecutableValidationCommand,
  isValidationResolutionCause,
  validationRequirementForCommand,
  type ValidationRequirementId,
} from "../validation-command";

const PATCH_TOOL_RE = /edit|patch|write|replace|mutation/i;
const VALIDATION_TOOL_RE = /^(run_tests|sandbox_run)$/i;

export function normalizeToolEvidence(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
  parsedOutput?: Record<string, unknown>,
): NormalizedToolEvidence {
  const structured = parseTrailingObject(output) ?? parsedOutput ?? {};
  const error = asRecord(structured.error);
  const errorDetails = asRecord(error?.details);
  const code = String(error?.code ?? structured.code ?? "").toUpperCase();
  const status = String(structured.status ?? structured.outcome ?? "").toLowerCase();
  const sandboxStatus = output.match(/\bStatus:\s*(PASSED|READY|FAILED|TIMED_OUT|START_FAILED|TERMINATED)\b/i)?.[1]?.toLowerCase();
  const sandboxExitCode = Number(output.match(/\bExit code:\s*(-?\d+)\b/i)?.[1]);
  const summary = compactSummary(
    typeof structured.summary === "string" ? structured.summary : output,
  );
  const approvalRequired =
    code === "ERR_APPROVAL_REQUIRED" ||
    status === "awaiting_approval" ||
    /approval required|requires approval|needs approval|policy stop .*pending|awaiting approval/i.test(output);
  const validationCause = isValidationResolutionCause(errorDetails?.cause)
    ? errorDetails.cause
    : undefined;
  const resolutionBlocked = VALIDATION_TOOL_RE.test(toolName) &&
    code === "DEPENDENCY_UNAVAILABLE" &&
    Boolean(validationCause);
  const trustBlocked =
    !approvalRequired &&
    (resolutionBlocked ||
      code === "FORBIDDEN" ||
      status === "blocked" ||
      /workspace trust contract blocks|provider domain blocked|path must remain|policy stop .*declined|policy .*rejected/i.test(output));
  const failed =
    !trustBlocked &&
    !approvalRequired &&
    (structured.ok === false ||
      ["failed", "error", "cancelled", "declined", "timeout"].includes(status) ||
      ["failed", "timed_out", "start_failed", "terminated"].includes(sandboxStatus ?? "") ||
      (Number.isFinite(sandboxExitCode) && sandboxExitCode !== 0) ||
      /^(error\b|tool .+ failed\b|invalid arguments\b|timed? out\b|cancelled\b|canceled\b)/i.test(output.trim()) ||
      /\b(exit code [1-9]\d*|not ok)\b/i.test(output));
  const outcome = trustBlocked
    ? "blocked"
    : approvalRequired
      ? "awaiting_approval"
      : failed
        ? "failed"
        : "completed";

  const validationExecution = asRecord(structured.validationExecution);
  const validationExecutionId = typeof validationExecution?.executionId === "string"
    ? validationExecution.executionId.trim()
    : "";
  const validationCommand = validationExecution?.command;
  const validationExitCode = Number(validationExecution?.exitCode);
  const validationRequirementId = typeof validationExecution?.requirementId === "string"
    ? validationExecution.requirementId
    : typeof errorDetails?.requirementId === "string"
      ? errorDetails.requirementId
      : isExecutableValidationCommand(validationCommand)
        ? validationRequirementForCommand(validationCommand)
        : undefined;
  const validationAuthorization = validationExecution?.authorization === "approved_override"
    ? "approved_override" as const
    : undefined;
  const validationPassed =
    validationExecutionId.length > 0 &&
    isExecutableValidationCommand(validationCommand) &&
    validationExecution?.processStarted === true &&
    Number.isFinite(validationExitCode) &&
    validationExitCode === 0;
  const validationStatus = VALIDATION_TOOL_RE.test(toolName)
    ? outcome === "blocked" || outcome === "awaiting_approval"
      ? "blocked"
      : outcome === "failed"
        ? "failed"
        : outcome === "completed" && validationPassed
      ? "passed"
      : outcome === "completed"
        ? "failed"
        : "not_run"
    : undefined;

  return {
    toolName,
    outcome,
    summary,
    reason:
      trustBlocked || approvalRequired || failed
        ? compactSummary(
            typeof error?.message === "string" ? error.message : output,
          )
        : undefined,
    changedFiles:
      outcome === "completed" && PATCH_TOOL_RE.test(toolName)
        ? extractChangedFiles(args, structured, output)
        : [],
    validationStatus,
    validationExecutionId: validationPassed ? validationExecutionId : undefined,
    validationRequirementId:
      isValidationRequirementId(validationRequirementId)
        ? validationRequirementId
        : undefined,
    validationAuthorization,
    validationCause,
    requiredUserAction:
      trustBlocked || approvalRequired
        ? typeof error?.recommendedNextAction === "string"
          ? error.recommendedNextAction
          : approvalRequired
            ? "Approve the requested action, or retry with a read-only alternative."
            : "Review workspace trust and retry after the required access is available."
        : undefined,
  };
}

export function normalizeToolExecution(
  execution: ToolExecutionRecord,
): NormalizedToolEvidence {
  const evidence = (
    execution.evidence ??
    normalizeToolEvidence(
      execution.toolName,
      execution.args ?? {},
      execution.output,
      execution.parsedOutput,
    )
  );
  return {
    ...evidence,
    validationAuthorization:
      execution.validationAuthorization ?? evidence.validationAuthorization,
    requirement: execution.executionPolicy?.requirement ?? evidence.requirement,
  };
}

export function buildExecutionEvidence(input: {
  workPlan: WorkPlan;
  stages: WorkStage[];
  toolExecutions: ToolExecutionRecord[];
  synthesisStatus: ExecutionSynthesisStatus;
  synthesisSummary?: string;
}): ExecutionEvidence {
  const normalized = reconcileToolEvidence(input.toolExecutions);
  const completedSteps = normalized
    .filter((item) => item.outcome === "completed")
    .map((item) => item.toolName);
  const failedSteps = normalized
    .filter((item) => item.outcome === "failed")
    .map((item) => ({
      name: item.toolName,
      reason: item.reason ?? item.summary,
    }));
  const blockedSteps = normalized
    .filter(
      (item) =>
        (item.outcome === "blocked" || item.outcome === "awaiting_approval") &&
        item.requirement !== "optional" &&
        item.requirement !== "fallback",
    )
    .map((item) => ({
      name: item.toolName,
      reason: item.reason ?? item.summary,
    }));
  const changedFiles = dedupeChangedFiles(normalized.flatMap((item) => item.changedFiles));
  const validationEvidence = normalized.filter((item) => item.validationStatus);
  const validationStage = input.stages.find((stage) => stage.id === "validation_executed");
  const objectiveResolution = input.workPlan.objectiveContract
    ? resolveObjectiveEvidence(
        input.workPlan.objectiveContract,
        input.toolExecutions.map((execution) => ({
          toolName: execution.toolName,
          args: execution.args ?? {},
          output: execution.output,
          parsedOutput: execution.parsedOutput,
          changedFiles: normalizeToolExecution(execution).changedFiles.map((file) => file.path),
        })),
        { matches: input.workPlan.objectiveInspectionMatches ?? [] },
      )
    : {
        state: "unknown" as const,
        evidenceIds: [],
        summary: "No canonical objective contract was persisted for this historical run.",
      };
  const objectiveState = objectiveResolution.state === "unknown" && input.workPlan.objectiveContract?.objectiveAlreadySatisfied
    ? "satisfied" as const
    : objectiveResolution.state;
  const activeContract = activeContractForWorkPlan(input.workPlan, {
    phase: "final",
    actualMutation: changedFiles.length > 0,
    objectiveAlreadySatisfied: objectiveState === "satisfied" && changedFiles.length === 0,
    validationIsPrimaryObjective: input.workPlan.objectiveContract?.validationIsPrimaryObjective ?? false,
    highRiskChange: changedFiles.length > 0 && (input.workPlan.risk === "high" || hasHighRiskChange(changedFiles.map((file) => file.path))),
    primaryStatus: primaryValidationStatus(validationEvidence),
    evidence: validationEvidence,
  });
  // Canonical Work plans carry the mutable objective state that the runtime
  // persists with the final evidence. Legacy plans remain read-only adapters:
  // mutating their compatibility projection here could make a reused
  // historical object disagree with its current validation requirements.
  if (input.workPlan.objectiveContract) {
    input.workPlan.validationContract = activeContract;
    input.workPlan.validationPlan.contract = activeContract;
  }
  const requiredValidation = resolveRequiredValidation(
    input.workPlan,
    validationEvidence,
    activeContract,
  );
  const validationStatus = requiredValidation?.status ?? (
    requiredApplicableItems(activeContract).length === 0
      ? "not_required"
      : validationEvidence.some((item) => item.validationStatus === "blocked") ||
          validationStage?.status === "blocked"
        ? "blocked"
        : validationEvidence.some((item) => item.validationStatus === "failed") ||
            validationStage?.status === "failed"
          ? "failed"
          : validationEvidence.some((item) => item.validationStatus === "running")
            ? "running"
            : validationEvidence.some((item) => item.validationStatus === "pending")
              ? "pending"
              : validationEvidence.some((item) => item.validationStatus === "passed") ||
                  validationStage?.status === "passed"
                ? "passed"
                : "not_run");
  const requiredUserAction = normalized.find((item) => item.requiredUserAction)?.requiredUserAction;
  if (input.workPlan.objectiveContract) {
    input.workPlan.objectiveContract = updateObjectiveDelta(
      input.workPlan.objectiveContract,
      {
        mutationOccurred: changedFiles.length > 0,
        changedFiles: changedFiles.map((file) => file.path),
        targetState: objectiveState,
        evidenceIds: objectiveResolution.evidenceIds,
      },
    );
  }

  return {
    completedSteps,
    failedSteps,
    blockedSteps,
    changedFiles,
    validation: {
      status: validationStatus,
      summary: validationStage?.reason,
      cause:
        validationStatus === "passed"
          ? undefined
          : validationRequirementCause(activeContract, validationEvidence, requiredValidation),
      executionIds: [...new Set(validationEvidence
        .map((item) => item.validationExecutionId)
        .filter((id): id is string => Boolean(id)))],
      validationAuthorization: validationEvidence.some(
        (item) =>
          item.validationStatus === "passed" &&
          item.validationAuthorization === "approved_override",
      )
        ? "approved_override"
        : undefined,
      contract: activeContract,
    },
    objective: {
      state: objectiveState,
      mutationOccurred: changedFiles.length > 0,
      evidenceIds: objectiveResolution.evidenceIds,
      summary: objectiveResolution.summary,
    },
    synthesis: {
      status: input.synthesisStatus,
      summary: input.synthesisSummary,
    },
    requiredUserAction,
  };
}

export function resolveRequiredValidationStatus(
  workPlan: WorkPlan,
  evidence: NormalizedToolEvidence[],
  contract?: ValidationContract,
): ExecutionEvidence["validation"]["status"] | null {
  return resolveRequiredValidation(workPlan, evidence, contract)?.status ?? null;
}

export interface RequiredValidationResolution {
  status: ExecutionEvidence["validation"]["status"];
  missingRequirementIds: ValidationRequirementId[];
  unavailableRequirementIds: ValidationRequirementId[];
  contract: ValidationContract;
}

export function resolveRequiredValidation(
  workPlan: WorkPlan,
  evidence: NormalizedToolEvidence[],
  contract?: ValidationContract,
): RequiredValidationResolution | null {
  const activeContract = contract ?? activeContractForWorkPlan(workPlan, {
    phase: "final",
    actualMutation: evidence.some((item) => item.changedFiles.length > 0),
    objectiveAlreadySatisfied: false,
    validationIsPrimaryObjective: workPlan.objectiveContract?.validationIsPrimaryObjective ?? false,
    highRiskChange: workPlan.risk === "high" && evidence.some((item) => item.changedFiles.length > 0),
    evidence,
  });
  const requirements = requiredApplicableItems(activeContract);
  if (requirements.length === 0) return null;

  let blocked = false;
  let failed = false;
  const missingRequirementIds: ValidationRequirementId[] = [];
  const unavailableRequirementIds: ValidationRequirementId[] = [];

  for (const requirement of requirements) {
    const matches = evidence.filter((item) =>
      item.validationRequirementId === requirement.signal ||
      (requirement.signal === "custom" && item.validationRequirementId === "validation") ||
      ((requirement.signal === "custom" || requirement.signal === "validation") && !item.validationRequirementId && Boolean(item.validationStatus)),
    );
    if (matches.some((item) => item.validationStatus === "blocked") || requirement.availability === "ambiguous") blocked = true;
    if (matches.some((item) => item.validationStatus === "failed")) failed = true;
    const passed = matches.filter((item) =>
      item.validationStatus === "passed" &&
      (requirement.availability === "resolved" || item.validationAuthorization === "approved_override"),
    );
    if (passed.length === 0) {
      missingRequirementIds.push(legacyRequirementId(requirement.signal));
      if (requirement.availability !== "resolved") {
        unavailableRequirementIds.push(legacyRequirementId(requirement.signal));
      }
      continue;
    }
  }

  return {
    status: blocked
      ? "blocked"
      : failed
        ? "failed"
        : missingRequirementIds.length > 0
          ? "not_run"
          : "passed",
    missingRequirementIds,
    unavailableRequirementIds,
    contract: activeContract,
  };
}

export function describeRequiredValidationGap(
  workPlan: WorkPlan,
  evidence: NormalizedToolEvidence[],
): string | undefined {
  const resolution = resolveRequiredValidation(workPlan, evidence);
  if (!resolution || resolution.status === "passed") return undefined;

  const terminalEvidence = evidence.find(
    (item) =>
      (resolution.status === "blocked" &&
        (item.validationStatus === "blocked" || item.outcome === "blocked")) ||
      (resolution.status === "failed" &&
        (item.validationStatus === "failed" || item.outcome === "failed")),
  );
  const requirementId = terminalEvidence?.validationRequirementId ??
    resolution.unavailableRequirementIds[0] ??
      resolution.missingRequirementIds[0];
  if (!requirementId) {
    return resolution.status === "failed"
      ? "Required validation failed."
      : resolution.status === "blocked"
        ? "Required validation is blocked."
        : "Required validation has not completed.";
  }

  const label = requirementId === "typecheck"
    ? "typecheck"
    : requirementId === "test"
      ? "tests"
      : requirementId;
  if (resolution.status === "failed") return `Required ${label} validation failed.`;
  if (resolution.status === "blocked") return `Required ${label} validation is blocked.`;
  if (resolution.unavailableRequirementIds.includes(requirementId)) {
    return requirementId === "typecheck"
      ? "Required typecheck is unavailable in this repository."
      : `Required ${label} command is unavailable in this repository.`;
  }
  return `Required ${label} validation has not completed.`;
}

function validationRequirementCause(
  contract: ValidationContract,
  evidence: NormalizedToolEvidence[],
  resolution: RequiredValidationResolution | null,
) {
  if (resolution?.status === "not_run") {
    const unavailable = contract.items.find(
      (requirement) => resolution.unavailableRequirementIds.includes(legacyRequirementId(requirement.signal)),
    );
    if (unavailable?.unavailableCause) return unavailable.unavailableCause;
  }
  return evidence.find((item) =>
    item.validationStatus === "failed" || item.validationStatus === "blocked",
  )?.validationCause;
}

/**
 * A corrected retry is the final operational truth for the same tool target.
 * Keep every attempt in the append-only trace, but do not promote a recovered
 * transient failure into the canonical terminal outcome.
 */
export function reconcileToolEvidence(
  executions: ToolExecutionRecord[],
): NormalizedToolEvidence[] {
  return reconcileToolEntries(executions).map((entry) => entry.evidence);
}

export function reconcileToolExecutions(
  executions: ToolExecutionRecord[],
): ToolExecutionRecord[] {
  return reconcileToolEntries(executions).map((entry) => entry.execution);
}

function reconcileToolEntries(executions: ToolExecutionRecord[]) {
  const entries = executions.map((execution) => ({
    execution,
    evidence: normalizeToolExecution(execution),
    identity: toolExecutionIdentity(execution),
  }));

  const approvedRecoveryRequirements = new Set(
    entries
      .filter(
        (entry) =>
          entry.evidence.outcome === "completed" &&
          entry.evidence.validationStatus === "passed" &&
          entry.evidence.validationAuthorization === "approved_override" &&
          entry.evidence.validationRequirementId,
      )
      .map((entry) => entry.evidence.validationRequirementId),
  );

  return entries
    .filter((entry, index) => {
      if (
        (entry.evidence.validationStatus === "failed" ||
          entry.evidence.validationStatus === "blocked") &&
        isResolutionFailure(entry.evidence.validationCause) &&
        entry.evidence.validationRequirementId &&
        approvedRecoveryRequirements.has(entry.evidence.validationRequirementId)
      ) {
        return false;
      }
      if (entry.evidence.validationStatus) return true;
      if (entry.evidence.outcome === "completed" || !entry.identity) return true;
      return !entries.slice(index + 1).some(
        (later) =>
          later.identity === entry.identity &&
          later.evidence.outcome === "completed",
      );
    });
}

function isResolutionFailure(
  cause: NormalizedToolEvidence["validationCause"],
) {
  return (
    cause === "VALIDATION_COMMAND_UNRESOLVED" ||
    cause === "TYPECHECK_UNAVAILABLE" ||
    cause === "TOOLCHAIN_AMBIGUOUS"
  );
}

function isValidationRequirementId(
  value: unknown,
): value is NonNullable<NormalizedToolEvidence["validationRequirementId"]> {
  return (
    value === "test" ||
    value === "typecheck" ||
    value === "lint" ||
    value === "build" ||
    value === "validation"
  );
}

function toolExecutionIdentity(execution: ToolExecutionRecord): string | null {
  const args = execution.args ?? {};
  const target = [args.path, args.file, args.specificPath]
    .find((value): value is string => typeof value === "string" && value.trim() !== "");
  const command =
    typeof args.command === "string" && args.command.trim()
      ? args.command.trim()
      : null;
  if (!target && !command) return null;
  const operation =
    typeof args.operation === "string" ? args.operation.trim() : "";
  return [execution.toolName, target ?? command, operation].join("\u001f");
}

export function resolveExecutionTerminalState(input: {
  workPlan: WorkPlan;
  evidence: ExecutionEvidence;
  stages: WorkStage[];
  evidenceAttached: boolean;
  awaitingApproval?: boolean;
  incompleteEvidence?: boolean;
  preparatoryOnly?: boolean;
}): ExecutionTerminalState {
  const hasMutation = input.evidence.changedFiles.length > 0;
  const objectiveSatisfiedNoOp =
    !hasMutation &&
    input.evidence.objective?.state === "satisfied" &&
    !(input.workPlan.objectiveContract?.validationIsPrimaryObjective ?? false);
  const objectiveUnprovenNoMutation =
    !hasMutation &&
    input.workPlan.intent === "patch" &&
    !objectiveSatisfiedNoOp &&
    !(input.workPlan.objectiveContract?.validationIsPrimaryObjective ?? false);
  const planningStrategy = input.workPlan.objectiveContract?.strategy === "planning";
  const activeContract = input.evidence.validation.contract ?? contractForWorkPlan(input.workPlan);
  const requiredItems = requiredApplicableItems(activeContract);
  const hasApprovalPending = input.evidence.blockedSteps.some((step) =>
    /approval|policy/i.test(step.reason),
  );
  const hasTrustBlock = input.evidence.blockedSteps.some((step) =>
    /trust|forbidden|permission|access/i.test(step.reason),
  );
  const hasBlockedStep = input.evidence.blockedSteps.length > 0;
  const hasFailedStep = input.evidence.failedSteps.length > 0;
  const validationFailed = input.evidence.validation.status === "failed";
  const validationBlocked = input.evidence.validation.status === "blocked";
  const validationMissing =
    requiredItems.length > 0 &&
    requiredItems.some((item) =>
      (item.availability !== "resolved" && item.evidence.approvalProvenance !== "approved_override") ||
      ["not_run", "running", "inconclusive"].includes(item.evidence.status),
    );
  const synthesisMissing = input.evidence.synthesis.status !== "valid";
  const requiredStageIds = requiredStageIdsForReduction(
    input.workPlan,
    requiredItems,
    objectiveSatisfiedNoOp,
    planningStrategy,
  );
  const missingRequiredStage = input.stages.some(
    (stage) =>
      requiredStageIds.has(stage.id) &&
      ["pending", "failed", "blocked"].includes(stage.status),
  );

  if (hasMutation && (validationFailed || validationBlocked || validationMissing || synthesisMissing || hasFailedStep || hasBlockedStep)) {
    return "partial";
  }
  if (hasTrustBlock) return "blocked";
  if (hasApprovalPending || input.awaitingApproval) return "blocked";
  if (hasBlockedStep) return "blocked";
  if (validationBlocked && !objectiveSatisfiedNoOp) return "blocked";
  if (hasFailedStep || validationFailed) return "failed";
  if (synthesisMissing) return "failed";
  if (objectiveUnprovenNoMutation) return "blocked";
  if (validationMissing && !objectiveSatisfiedNoOp) return hasMutation ? "partial" : "blocked";
  if (input.incompleteEvidence || ((!planningStrategy) && input.preparatoryOnly) || (missingRequiredStage && !objectiveSatisfiedNoOp && !planningStrategy)) return "partial";
  if (input.workPlan.evidencePlan.required && !input.evidenceAttached) return "failed";
  return "completed";
}

function requiredStageIdsForReduction(
  workPlan: WorkPlan,
  requiredItems: ReturnType<typeof requiredApplicableItems>,
  objectiveSatisfiedNoOp: boolean,
  planningStrategy: boolean,
): Set<WorkStage["id"]> {
  const ids = new Set<WorkStage["id"]>([
    "context_compiled",
    "privacy_preflight_passed",
  ]);
  if (workPlan.evidencePlan.required) ids.add("evidence_attached");
  if (planningStrategy || workPlan.objectiveContract?.strategy === "inspection") {
    ids.add("files_inspected");
  }
  if (objectiveSatisfiedNoOp || planningStrategy) return ids;
  if (workPlan.intent === "patch") ids.add("patch_attempted");
  if (requiredItems.length > 0) {
    ids.add("validation_planned");
    ids.add("validation_executed");
  }
  if (workPlan.runbook === "audit_reproduce_remediate" || workPlan.runbook === "trace_source_to_sink") {
    ids.add("security_proof_checked");
  }
  if (workPlan.workingSet.knownFailures.length > 0) ids.add("failure_memory_checked");
  return ids;
}

export function buildUserFacingExecutionSummary(
  outcome: ExecutionTerminalState,
  evidence: ExecutionEvidence,
  completionKind?: CompletionKind,
): string {
  const lines: string[] = [];
  if (outcome === "completed") {
    if (completionKind === "already_satisfied") {
      lines.push("Already satisfied; no files required changes.");
    } else if (completionKind === "validation_completed") {
      lines.push("Validation completed successfully.");
    } else if (completionKind === "inspection_completed") {
      lines.push("Inspection completed successfully.");
    } else {
      lines.push("Completed successfully.");
    }
  } else if (outcome === "partial") {
    lines.push("Completed partially; review the remaining work before relying on the result.");
  } else if (outcome === "blocked") {
    if (evidence.requiredUserAction) {
      lines.push(`Stopped pending required action: ${evidence.requiredUserAction}`);
    } else if (evidence.objective?.state === "unknown" && evidence.changedFiles.length === 0) {
      lines.push("Stopped because repository evidence did not prove the requested objective state.");
    } else if (evidence.validation.status === "not_run") {
      lines.push(
        `Stopped because ${validationCauseDescription(evidence.validation.cause) ?? "required validation did not run"}.`,
      );
    } else {
      lines.push("Stopped because required access is unavailable.");
    }
  } else {
    lines.push("The run could not complete.");
  }

  if (completionKind === "already_satisfied") {
    lines.push("Post-mutation validation was not applicable because no mutation was required.");
  }

  if (evidence.changedFiles.length > 0) {
    lines.push(
      `Changed files: ${evidence.changedFiles
        .map(
          (file) =>
            `${file.path} (backup ${file.backupCreated ? "created" : "not created"}; impact analysis ${file.impactAnalysis})`,
        )
        .join(", ")}.`,
    );
  } else {
    lines.push("Changed files: none confirmed.");
  }
  const notRun = [
    evidence.validation.status === "not_run" ? validationNotRunLabel(evidence.validation.cause) : "",
    evidence.synthesis.status !== "valid" ? "final synthesis" : "",
  ].filter(Boolean);
  if (notRun.length > 0) lines.push(`Not run or incomplete: ${notRun.join(" and ")}.`);
  if (outcome === "partial" && evidence.validation.status === "not_run") {
    lines.push(
      `Verification gap: ${validationCauseDescription(evidence.validation.cause) ?? "required validation did not complete"}.`,
    );
  }
  const reason = evidence.failedSteps[0]?.reason ?? evidence.blockedSteps[0]?.reason;
  if (reason) lines.push(`Why it stopped: ${sanitizeUserReason(reason)}.`);
  if (evidence.requiredUserAction) lines.push(`Next action: ${sanitizeUserReason(evidence.requiredUserAction)}.`);
  return lines.join("\n");
}

export function deriveCompletionKind(input: {
  terminalState: ExecutionTerminalState;
  workPlan: WorkPlan;
  evidence: ExecutionEvidence;
}): CompletionKind {
  if (input.terminalState === "blocked") {
    return input.evidence.requiredUserAction ? "awaiting_approval" : "blocked";
  }
  if (input.terminalState === "failed") return "failed";
  if (input.terminalState === "partial") {
    return input.evidence.changedFiles.length > 0 ? "changed_unverified" : "blocked";
  }
  if (input.evidence.objective?.state === "satisfied" && input.evidence.changedFiles.length === 0) {
    return "already_satisfied";
  }
  if (input.workPlan.objectiveContract?.validationIsPrimaryObjective) {
    return "validation_completed";
  }
  if (input.evidence.changedFiles.length === 0) return "inspection_completed";
  return "changed_verified";
}

function primaryValidationStatus(
  evidence: NormalizedToolEvidence[],
): "passed" | "failed" | "inconclusive" | undefined {
  if (evidence.some((item) => item.validationStatus === "failed" || item.validationStatus === "blocked")) {
    return "failed";
  }
  if (evidence.some((item) => item.validationStatus === "passed")) return "passed";
  if (evidence.some((item) => item.validationStatus === "pending" || item.validationStatus === "running")) {
    return "inconclusive";
  }
  return undefined;
}

function legacyRequirementId(signal: ValidationContract["items"][number]["signal"]): ValidationRequirementId {
  return signal === "custom" ? "validation" : signal;
}

function validationNotRunLabel(
  cause: ExecutionEvidence["validation"]["cause"],
) {
  if (cause === "TYPECHECK_UNAVAILABLE") return "typecheck validation";
  if (cause === "TOOLCHAIN_AMBIGUOUS") return "toolchain resolution";
  return "required validation";
}

function validationCauseDescription(
  cause: ExecutionEvidence["validation"]["cause"],
) {
  if (cause === "TYPECHECK_UNAVAILABLE") {
    return "the required typecheck is unavailable in this repository";
  }
  if (cause === "TOOLCHAIN_AMBIGUOUS") {
    return "the target repository toolchain is ambiguous";
  }
  if (cause === "VALIDATION_COMMAND_UNRESOLVED") {
    return "no executable validation command is resolved";
  }
  return undefined;
}

function parseTrailingObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.lastIndexOf("\n{") + 1).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractChangedFiles(
  args: Record<string, unknown>,
  structured: Record<string, unknown>,
  output: string,
): ExecutionChangedFile[] {
  const paths = new Set<string>();
  for (const value of [args.path, args.file, structured.path, structured.file]) {
    if (typeof value === "string" && looksLikeRepoPath(value)) paths.add(value.trim());
  }
  const files = structured.filesModified ?? structured.changedFiles ?? structured.files;
  if (Array.isArray(files)) {
    for (const value of files) {
      const path = typeof value === "string" ? value : asRecord(value)?.path;
      if (typeof path === "string" && looksLikeRepoPath(path)) paths.add(path.trim());
    }
  }
  const outputPath = output.match(/\b(?:File|Path):\s*([^\s:]+(?:\/[^\s:]+)*)/i)?.[1];
  if (outputPath && looksLikeRepoPath(outputPath)) paths.add(outputPath);
  for (const match of output.matchAll(/\b((?:src|app|pages|lib|server|api|electron|contracts|tests?)\/[A-Za-z0-9._/-]+)/g)) {
    if (looksLikeRepoPath(match[1])) paths.add(match[1]);
  }
  const impact = /impact analysis skipped/i.test(output)
    ? "skipped"
    : /impact analysis/i.test(output)
      ? "full"
      : "none";
  const backupCreated = !/no backup|without a backup/i.test(output) && /backup file was created|backup created/i.test(output);
  return [...paths].map((path) => ({
    path,
    operation: "modified",
    backupCreated,
    impactAnalysis: impact,
  }));
}

function dedupeChangedFiles(files: ExecutionChangedFile[]) {
  const byPath = new Map<string, ExecutionChangedFile>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looksLikeRepoPath(value: string) {
  return value.length < 400 && !/^(https?:|data:|file:|node:)/i.test(value) &&
    !value.includes("node_modules") && /[/.]/.test(value);
}

function compactSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217).trimEnd()}...`;
}

function sanitizeUserReason(value: string) {
  return compactSummary(value)
    .replace(/\[(?:[A-Z][A-Z_]+)\]/g, "")
    .replace(/\b(?:WorkPlan|planningPhase|step-[\w-]+|ERR_[A-Z_]+)\b/gi, "required execution step")
    .replace(/\s*\{[^{}]*\}\s*$/, "")
    .trim();
}
