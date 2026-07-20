/**
 * Engineering Task surface (NES-7.1) — progressive Levels 0–1.
 * Readiness mirrored from main; never invents Ready client-side.
 * CTAs are explicit and always require a real handler.
 */

import { useCallback, useState } from "react";
import { ArrowDown01Icon, Task01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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
    case "verifying":
    case "converging":
      return null;
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
      className="inline-flex items-center rounded-full border border-border/70 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
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
  if (!task) return null;

  const action = primaryActionForStatus(task.status);
  const facing = userFacingStatusLabel(task.status);
  // Never render a CTA without a handler (amendment 11).
  const canRenderCta = Boolean(action && onPrimaryAction);

  return (
    <details
      className="group relative text-xs text-muted-foreground"
      data-engineering-task-id={task.engineeringTaskId}
      data-engineering-status={task.status}
      data-user-facing-status={facing}
    >
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full border border-border/55 bg-background/55 px-3 text-[11px] font-medium text-foreground/85 backdrop-blur-md transition-[background-color,border-color,color] duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35">
        <HugeiconsIcon icon={Task01Icon} className="size-3.5" />
        <span>Task details</span>
        <span className="text-muted-foreground/65">{facing}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-60 transition-transform duration-[250ms] group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-border/70 bg-[var(--panel)]/95 p-4 shadow-none backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Task status</p>
          <ReadinessBadge readiness={task.readiness} />
        </div>
        <p className="mt-3 break-words text-[13px] font-semibold text-foreground">{task.title}</p>
        <p className="mt-1 break-words leading-relaxed">{task.objectivePreview}</p>
        <p className="mt-3" data-testid="engineering-status">{facing} · v{task.aggregateVersion}</p>
        {canRenderCta && action ? (
        <button
          type="button"
          className="mt-3 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform duration-[180ms] ease-out active:scale-[0.97] disabled:opacity-50"
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
    </details>
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
