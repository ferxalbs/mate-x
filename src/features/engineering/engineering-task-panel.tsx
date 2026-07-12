/**
 * Engineering Task surface (NES-7.1) — progressive Levels 0–1.
 * Readiness mirrored from main; never invents Ready client-side.
 * CTAs are explicit and always require a real handler.
 */

import { useCallback, useState } from "react";

import type {
  EngineeringTaskStatus,
  ReadinessLabel,
} from "../../contracts/engineering-task";
import {
  projectUserFacingStatus,
  type UserFacingTaskStatus,
} from "../../contracts/engineering-phase-result";

export interface EngineeringTaskViewModel {
  engineeringTaskId: string;
  title: string;
  status: EngineeringTaskStatus;
  readiness: ReadinessLabel;
  objectivePreview: string;
  aggregateVersion: number;
}

export type EngineeringPrimaryActionId =
  | "answer_clarification"
  | "review_specification"
  | "approve_plan"
  | "start_execution"
  | "run_validation"
  | "view_ship_proof"
  | "resolve_blocker"
  | "retry_failed";

export interface EngineeringPrimaryAction {
  id: EngineeringPrimaryActionId;
  label: string;
  /** Canonical command type(s) this CTA will dispatch — one valid primary command. */
  commandType: string;
}

const READINESS_TEXT: Record<ReadinessLabel, string> = {
  Ready: "Ready",
  "Needs check": "Needs check",
  "Risk found": "Risk found",
  Blocked: "Blocked",
  "Not proven": "Not proven",
};

/**
 * Explicit CTA matrix derived from canonical (internal) status.
 * Every non-null action must be wired to a real handler by the parent.
 */
export function primaryActionForStatus(
  status: EngineeringTaskStatus,
): EngineeringPrimaryAction | null {
  switch (status) {
    case "captured":
      return {
        id: "review_specification",
        label: "Review specification",
        commandType: "FreezeSpecification",
      };
    case "clarifying":
      return {
        id: "answer_clarification",
        label: "Answer clarification",
        commandType: "AnswerDecision",
      };
    case "specified":
    case "planning":
    case "planned":
      return {
        id: "approve_plan",
        label: "Approve plan",
        commandType: "SubmitForApproval",
      };
    case "awaiting_approval":
      return {
        id: "approve_plan",
        label: "Approve plan",
        commandType: "ApprovePlanAndTasks",
      };
    case "executing":
      return {
        id: "start_execution",
        label: "Start execution",
        commandType: "BeginVerification",
      };
    case "verifying":
    case "converging":
      return {
        id: "run_validation",
        label: "Run validation",
        commandType: "ExecuteValidation",
      };
    case "ready":
      return {
        id: "view_ship_proof",
        label: "View Ship Proof",
        commandType: "IssueShipProof",
      };
    case "blocked":
      return {
        id: "resolve_blocker",
        label: "Resolve blocker",
        commandType: "ResumeTask",
      };
    case "failed":
      return {
        id: "retry_failed",
        label: "Retry",
        commandType: "ResumeTask",
      };
    case "cancelled":
      return null;
    default:
      return null;
  }
}

/** @deprecated use primaryActionForStatus — kept for test migration */
export function primaryCtaForStatus(status: EngineeringTaskStatus): string {
  return primaryActionForStatus(status)?.label ?? "—";
}

export function userFacingStatusLabel(
  status: EngineeringTaskStatus,
): UserFacingTaskStatus {
  return projectUserFacingStatus(status);
}

export function ReadinessBadge({ readiness }: { readiness: ReadinessLabel }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
      data-readiness={readiness}
      aria-label={`Readiness: ${READINESS_TEXT[readiness]}`}
    >
      {READINESS_TEXT[readiness]}
    </span>
  );
}

export function EngineeringTaskPanel({
  task,
  onPrimaryAction,
  busy,
}: {
  task: EngineeringTaskViewModel | null;
  /** Required whenever a CTA is shown — parent must supply a real handler. */
  onPrimaryAction?: (action: EngineeringPrimaryAction) => void;
  busy?: boolean;
}) {
  if (!task) {
    return (
      <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Engineering task</p>
        <p className="mt-1">
          Describe an engineering objective to start. MaTE X determines the
          workflow — there is no mode picker.
        </p>
      </div>
    );
  }

  const action = primaryActionForStatus(task.status);
  const facing = userFacingStatusLabel(task.status);
  // Never render a CTA without a handler (amendment 11).
  const canRenderCta = Boolean(action && onPrimaryAction);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border/60 p-4"
      data-engineering-task-id={task.engineeringTaskId}
      data-engineering-status={task.status}
      data-user-facing-status={facing}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{task.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {task.objectivePreview}
          </p>
        </div>
        <ReadinessBadge readiness={task.readiness} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Status:{" "}
          <span className="text-foreground" data-testid="engineering-status">
            {facing}
          </span>
        </span>
        <span>v{task.aggregateVersion}</span>
      </div>
      {canRenderCta && action ? (
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy}
          data-testid="engineering-primary-cta"
          data-cta-id={action.id}
          data-command-type={action.commandType}
          onClick={() => onPrimaryAction?.(action)}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function EngineeringObjectiveCapture({
  onCapture,
  busy,
}: {
  onCapture: (objective: string) => Promise<void> | void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void onCapture(trimmed);
  }, [onCapture, value]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-4">
      <label className="text-sm font-medium text-foreground" htmlFor="eng-obj">
        Engineering objective
      </label>
      <textarea
        id="eng-obj"
        className="min-h-[88px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        placeholder="What should MaTE X implement or verify?"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      <button
        type="button"
        className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        disabled={busy || !value.trim()}
        onClick={submit}
      >
        Start engineering task
      </button>
    </div>
  );
}
