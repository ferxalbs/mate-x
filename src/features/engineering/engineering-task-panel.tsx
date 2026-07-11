/**
 * Engineering Task surface (NES-7.1) — progressive Levels 0–1.
 * Readiness mirrored from main; never invents Ready client-side.
 */

import { useCallback, useState } from "react";

import type {
  EngineeringTaskStatus,
  ReadinessLabel,
} from "../../contracts/engineering-task";

export interface EngineeringTaskViewModel {
  engineeringTaskId: string;
  title: string;
  status: EngineeringTaskStatus;
  readiness: ReadinessLabel;
  objectivePreview: string;
  aggregateVersion: number;
}

const READINESS_TEXT: Record<ReadinessLabel, string> = {
  Ready: "Ready",
  "Needs check": "Needs check",
  "Risk found": "Risk found",
  Blocked: "Blocked",
  "Not proven": "Not proven",
};

export function primaryCtaForStatus(status: EngineeringTaskStatus): string {
  switch (status) {
    case "captured":
      return "Continue";
    case "clarifying":
      return "Answer";
    case "specified":
      return "Build plan";
    case "planning":
      return "Planning…";
    case "planned":
      return "Review & approve";
    case "awaiting_approval":
      return "Approve plan";
    case "executing":
      return "Watch progress";
    case "verifying":
      return "Verifying…";
    case "converging":
      return "Review gaps";
    case "ready":
      return "Create Ship Proof";
    case "blocked":
      return "Resolve blocker";
    case "failed":
      return "Retry";
    case "cancelled":
      return "—";
    default:
      return "Continue";
  }
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
  onPrimaryAction?: () => void;
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

  const cta = primaryCtaForStatus(task.status);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
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
          Status: <span className="text-foreground">{task.status}</span>
        </span>
        <span>v{task.aggregateVersion}</span>
      </div>
      {cta !== "—" && (
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy || task.status === "planning" || task.status === "verifying"}
          onClick={onPrimaryAction}
        >
          {cta}
        </button>
      )}
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
