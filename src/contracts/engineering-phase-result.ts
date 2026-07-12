/**
 * Typed phase-result contract for EngineeringTask control plane.
 * Transitions must reference canonical artifacts — never assistant prose.
 */

import type {
  EngineeringTaskStatus,
  SpecificationDocument,
  TaskGraphDocument,
  TechnicalApproachDocument,
} from "./engineering-task";

export const ENGINEERING_PHASE_RESULT_KINDS = [
  "clarification_required",
  "specification_ready",
  "plan_ready",
  "execution_result",
  "validation_result",
] as const;

export type EngineeringPhaseResultKind =
  (typeof ENGINEERING_PHASE_RESULT_KINDS)[number];

/** User-facing lifecycle projection (internal statuses preserved in storage). */
export const USER_FACING_TASK_STATUSES = [
  "captured",
  "clarifying",
  "specified",
  "awaiting_approval",
  "executing",
  "validating",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type UserFacingTaskStatus = (typeof USER_FACING_TASK_STATUSES)[number];

export function projectUserFacingStatus(
  status: EngineeringTaskStatus,
): UserFacingTaskStatus {
  switch (status) {
    case "planning":
    case "planned":
      return "specified";
    case "verifying":
    case "converging":
      return "validating";
    case "ready":
      return "completed";
    case "captured":
    case "clarifying":
    case "specified":
    case "awaiting_approval":
    case "executing":
    case "blocked":
    case "failed":
    case "cancelled":
      return status;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Phases where repository mutation / final validation / Ship Proof are forbidden. */
export const PRE_APPROVAL_STATUSES = new Set<EngineeringTaskStatus>([
  "captured",
  "clarifying",
  "specified",
  "planning",
  "planned",
  "awaiting_approval",
]);

export function isPreApprovalStatus(status: EngineeringTaskStatus): boolean {
  return PRE_APPROVAL_STATUSES.has(status);
}

export function isExecutionOrLaterStatus(status: EngineeringTaskStatus): boolean {
  return (
    status === "executing" ||
    status === "verifying" ||
    status === "converging" ||
    status === "ready"
  );
}

export function isFinalValidationPhase(status: EngineeringTaskStatus): boolean {
  return (
    status === "verifying" ||
    status === "converging" ||
    status === "ready"
  );
}

export type EngineeringPhaseResult =
  | {
      kind: "clarification_required";
      engineeringTaskId: string;
      runId: string;
      /** Decision IDs that must exist on the task after attach. */
      decisionIds: string[];
    }
  | {
      kind: "specification_ready";
      engineeringTaskId: string;
      runId: string;
      specificationId: string;
    }
  | {
      kind: "plan_ready";
      engineeringTaskId: string;
      runId: string;
      specificationId: string;
      approachId: string;
      taskGraphId: string;
    }
  | {
      kind: "execution_result";
      engineeringTaskId: string;
      runId: string;
      executionId: string;
      evidenceIds: string[];
    }
  | {
      kind: "validation_result";
      engineeringTaskId: string;
      runId: string;
      validationRunIds: string[];
    };

/** Optional embedded artifacts supplied with ApplyPhaseResult (persisted before ID checks). */
export interface PhaseResultArtifactBundle {
  specification?: SpecificationDocument;
  approach?: TechnicalApproachDocument;
  taskGraph?: TaskGraphDocument;
  decisions?: Array<{
    decisionId: string;
    taxonomy: "scope" | "requirement" | "constraint" | "risk" | "approval" | "exception" | "policy";
    question: string;
    impact: 1 | 2 | 3 | 4 | 5;
    uncertainty: 1 | 2 | 3 | 4 | 5;
    options: Array<{ optionId: string; label: string }>;
    required: boolean;
    status: "open" | "answered" | "skipped" | "waived";
  }>;
}

export function isEngineeringPhaseResultKind(
  value: unknown,
): value is EngineeringPhaseResultKind {
  return (
    typeof value === "string" &&
    (ENGINEERING_PHASE_RESULT_KINDS as readonly string[]).includes(value)
  );
}

export function parseEngineeringPhaseResult(
  value: unknown,
):
  | { ok: true; result: EngineeringPhaseResult }
  | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "phase result must be an object" };
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (!isEngineeringPhaseResultKind(kind)) {
    return { ok: false, reason: "invalid phase result kind" };
  }
  const engineeringTaskId = record.engineeringTaskId;
  const runId = record.runId;
  if (typeof engineeringTaskId !== "string" || !engineeringTaskId.startsWith("etask_")) {
    return { ok: false, reason: "engineeringTaskId required" };
  }
  if (typeof runId !== "string" || !runId.trim()) {
    return { ok: false, reason: "runId required" };
  }

  switch (kind) {
    case "clarification_required": {
      const decisionIds = record.decisionIds;
      if (!Array.isArray(decisionIds) || decisionIds.some((id) => typeof id !== "string" || !id)) {
        return { ok: false, reason: "decisionIds required" };
      }
      return {
        ok: true,
        result: {
          kind,
          engineeringTaskId,
          runId,
          decisionIds: decisionIds as string[],
        },
      };
    }
    case "specification_ready": {
      if (typeof record.specificationId !== "string" || !record.specificationId) {
        return { ok: false, reason: "specificationId required" };
      }
      return {
        ok: true,
        result: {
          kind,
          engineeringTaskId,
          runId,
          specificationId: record.specificationId,
        },
      };
    }
    case "plan_ready": {
      for (const key of ["specificationId", "approachId", "taskGraphId"] as const) {
        if (typeof record[key] !== "string" || !record[key]) {
          return { ok: false, reason: `${key} required` };
        }
      }
      return {
        ok: true,
        result: {
          kind,
          engineeringTaskId,
          runId,
          specificationId: String(record.specificationId),
          approachId: String(record.approachId),
          taskGraphId: String(record.taskGraphId),
        },
      };
    }
    case "execution_result": {
      if (typeof record.executionId !== "string" || !record.executionId) {
        return { ok: false, reason: "executionId required" };
      }
      const evidenceIds = record.evidenceIds;
      if (!Array.isArray(evidenceIds) || evidenceIds.some((id) => typeof id !== "string")) {
        return { ok: false, reason: "evidenceIds required" };
      }
      return {
        ok: true,
        result: {
          kind,
          engineeringTaskId,
          runId,
          executionId: record.executionId,
          evidenceIds: evidenceIds as string[],
        },
      };
    }
    case "validation_result": {
      const validationRunIds = record.validationRunIds;
      if (
        !Array.isArray(validationRunIds) ||
        validationRunIds.some((id) => typeof id !== "string" || !id)
      ) {
        return { ok: false, reason: "validationRunIds required" };
      }
      return {
        ok: true,
        result: {
          kind,
          engineeringTaskId,
          runId,
          validationRunIds: validationRunIds as string[],
        },
      };
    }
    default:
      return { ok: false, reason: "unsupported kind" };
  }
}
