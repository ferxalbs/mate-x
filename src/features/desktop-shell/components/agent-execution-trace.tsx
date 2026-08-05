import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Loading01Icon,
  ComputerTerminal01Icon,
  Search02Icon,
  BookOpen01Icon,
  PencilEdit01Icon,
  Shield01Icon,
  Alert01Icon,
  Tick01Icon,
  LockKeyIcon,
} from "@hugeicons/core-free-icons";
import { memo, useMemo, useState } from "react";

import { normalizeToolEvent, type ToolEvent, type ToolEventType } from "../../../contracts/chat";
import type {
  CompletionKind,
  ExecutionValidationStatus,
} from "../../../contracts/execution";
import {
  getPresentationActivitySummary,
  getPresentationRunningActivityLabel,
} from "../../../lib/user-facing-presentation";
import { useVisibilityInterval } from "../../../hooks/use-visibility-interval";
import { ChatMarkdown, RawSyntaxHighlighter } from "./chat-markdown";
import { formatDuration, getTimelineDuration, getTimelineStart } from "./agent-execution-trace-utils";

function getToolIcon(type?: ToolEventType) {
  switch (type) {
    case "command":
      return ComputerTerminal01Icon;
    case "search":
      return Search02Icon;
    case "read":
      return BookOpen01Icon;
    case "edit":
      return PencilEdit01Icon;
    case "validation":
      return Shield01Icon;
    case "approval":
      return LockKeyIcon;
    case "error":
      return Alert01Icon;
    case "result":
      return Tick01Icon;
    default:
      return null;
  }
}

export const AgentExecutionTrace = memo(function AgentExecutionTrace({
  events,
  isRunning,
  validationState,
  completionKind,
  requiresInteraction = false,
  terminalEvidence,
  activitySummary: activitySummaryOverride,
}: {
  events: ToolEvent[];
  isRunning: boolean;
  validationState?: ExecutionValidationStatus;
  completionKind?: CompletionKind;
  requiresInteraction?: boolean;
  terminalEvidence?: {
    repositoryVerified: boolean;
    passedChecksLabel: string | null;
  };
  activitySummary?: string | null;
}) {
  const interactive = isRunning || requiresInteraction;
  const [expanded, setExpanded] = useState(interactive);
  // Adjust expansion while rendering when interactive mode flips — same-render
  // update so the UI never paints one frame with a stale open/closed state.
  // See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevInteractive, setPrevInteractive] = useState(interactive);
  if (interactive !== prevInteractive) {
    setPrevInteractive(interactive);
    setExpanded(interactive);
  }
  const normalizedEvents = useMemo(() => {
    return events
      .map((event, sequence) => normalizeToolEvent(event, { sequence }))
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }, [events]);
  const timeline = normalizedEvents
    .map(toPublicExecutionEvent)
    .filter((event): event is ToolEvent => event !== null);
  const settledTimeline = isRunning
    ? timeline
    : timeline.filter((event) => event.status !== "active" && event.status !== "queued");
  const duration = useRunDuration(normalizedEvents, isRunning);
  const activeEvent = [...timeline].reverse().find((event) =>
    event.status === "active" || event.status === "queued",
  );
  const runningActivityLabel = getRunningActivityLabel(activeEvent);
  const activitySummary = activitySummaryOverride ?? getActivitySummary(
    settledTimeline,
    validationState,
    completionKind,
    terminalEvidence,
  );

  // Compute visibility inside the memo so deps stay stable (normalizedEvents /
  // expanded / isRunning). An outer `visible` array is recreated every render
  // and would defeat the memo entirely.
  const groupedEvents = useMemo(() => {
    const publicTimeline = normalizedEvents
      .map(toPublicExecutionEvent)
      .filter((event): event is ToolEvent => event !== null);
    const settled = isRunning
      ? publicTimeline
      : publicTimeline.filter(
          (event) => event.status !== "active" && event.status !== "queued",
        );
    const diagnostic = normalizedEvents.filter(toLocalDiagnosticEvent);
    const visible = expanded
      ? [...settled, ...diagnostic].sort(
          (left, right) => (left.sequence ?? 0) - (right.sequence ?? 0),
        )
      : isRunning
        ? settled.slice(-4)
        : [];

    const groups: (ToolEvent | { isGroup: true; id: string; items: ToolEvent[] })[] = [];
    let currentGroup: ToolEvent[] = [];

    for (const event of visible) {
      const isGroupableTool =
        event.segmentKind === "tool" &&
        event.type !== "error" &&
        event.type !== "approval" &&
        event.status !== "active" &&
        event.status !== "queued";
      if (isGroupableTool) {
        currentGroup.push(event);
      } else {
        if (currentGroup.length > 0) {
          if (currentGroup.length === 1) {
            groups.push(currentGroup[0]);
          } else {
            groups.push({ isGroup: true, id: currentGroup[0].id + "_group", items: currentGroup });
          }
          currentGroup = [];
        }
        groups.push(event);
      }
    }
    if (currentGroup.length > 0) {
      if (currentGroup.length === 1) {
        groups.push(currentGroup[0]);
      } else {
        groups.push({ isGroup: true, id: currentGroup[0].id + "_group", items: currentGroup });
      }
    }
    return groups;
  }, [normalizedEvents, expanded, isRunning]);

  if (timeline.length === 0 && !isRunning && !activitySummary) return null;

  return (
    <section className="min-w-0 max-w-full space-y-3 overflow-hidden" aria-label="Agent activity">
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-border/60 pb-2 text-left text-[12px] text-muted-foreground/75 transition-colors duration-[var(--motion-press)] ease-[var(--ease-out)] enabled:hover:text-foreground disabled:cursor-default"
        aria-expanded={expanded}
        disabled={interactive}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          {isRunning
            ? runningActivityLabel
            : `Worked for ${formatDuration(duration)}${activitySummary ? ` · ${activitySummary}` : ""}`}
        </span>
        {isRunning ? (
          <HugeiconsIcon icon={Loading01Icon} className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : null}
        {expanded ? <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" /> : <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />}
      </button>

      <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
        {expanded && isRunning && timeline.length === 0 ? (
          <ActivityLabel label={runningActivityLabel} />
        ) : null}
        {groupedEvents.map((item) =>
          "isGroup" in item ? (
            <TimelineGroup key={item.id} items={item.items} />
          ) : (
            <TimelineRow event={item} key={item.segmentId ?? item.id} />
          )
        )}
      </div>
    </section>
  );
});

export function getRunningActivityLabel(activeEvent?: ToolEvent) {
  return getPresentationRunningActivityLabel(
    activeEvent,
    "Preparing the next repository step",
  );
}

export function getActivitySummary(
  events: ToolEvent[],
  validationState?: ExecutionValidationStatus,
  completionKind?: CompletionKind,
  terminalEvidence?: {
    repositoryVerified: boolean;
    passedChecksLabel: string | null;
  },
) {
  return getPresentationActivitySummary({
    events,
    presentationIntent: completionKind === "inspection_completed"
      ? "review"
      : completionKind === "validation_completed"
        ? "validation"
        : completionKind === "changed_verified" || completionKind === "changed_unverified"
          ? "change"
          : "unknown",
    completionKind,
    terminalState:
      completionKind === "awaiting_approval" ? "blocked" :
        completionKind === "blocked" ? "blocked" :
          completionKind === "failed" ? "failed" :
            completionKind === "changed_unverified" ? "partial" :
              "completed",
    validation: validationState && validationState !== "not_required"
      ? { status: validationState }
      : terminalEvidence?.passedChecksLabel
        ? { status: "passed" }
        : undefined,
    inspection: terminalEvidence?.repositoryVerified
      ? { label: "repository files", status: "satisfied", coverage: "complete" }
      : undefined,
  });
}

export function toLocalDiagnosticEvent(event: ToolEvent) {
  return event.visibility === "technical" &&
    event.id.startsWith("run_evt_") &&
    event.segmentKind !== "reasoning" &&
    event.segmentKind !== "final_response" &&
    event.type !== "reasoning" &&
    (
      event.type === "edit" ||
      event.type === "validation" ||
      event.type === "approval" ||
      event.type === "error" ||
      Boolean(event.title?.includes("/"))
    );
}

export function toPublicExecutionEvent(event: ToolEvent): ToolEvent | null {
  const isPrivateContent =
    event.segmentKind === "reasoning" ||
    event.segmentKind === "final_response" ||
    event.type === "reasoning" ||
    event.visibility === "restricted";

  if (isPrivateContent) return null;

  if (event.visibility === "technical") return null;
  if (
    event.type === "result" &&
    (event.title === "Run created" || event.title === "Run started")
  ) {
    return null;
  }

  return event;
}

function useRunDuration(timeline: ToolEvent[], isRunning: boolean) {
  const startedAt = useMemo(() => getTimelineStart(timeline), [timeline]);
  const completedDuration = useMemo(() => getTimelineDuration(timeline), [timeline]);
  const [now, setNow] = useState(() => Date.now());

  useVisibilityInterval(() => setNow(Date.now()), 1_000, {
    enabled: isRunning,
  });

  return isRunning && startedAt !== null ? Math.max(0, now - startedAt) : completedDuration;
}

export function getGroupName(items: ToolEvent[]) {
  const signals = items.map((item) =>
    `${item.type ?? ""} ${item.title ?? ""} ${item.label ?? ""}`.toLowerCase()
  ).join(" ");
  const parts = [];
  if (/\bread\b|reading|inspect/.test(signals)) parts.push("Read files");
  if (/\bcommand\b|running workspace action/.test(signals)) parts.push("ran commands");
  if (/\bsearch\b|searching|repository search/.test(signals)) parts.push("searched");
  if (/\bedit\b|editing|updated workspace file/.test(signals)) parts.push("edited files");
  if (/\bvalidation\b|validating|tests? passed|typecheck|lint/.test(signals)) parts.push("validated");

  if (parts.length === 0) return "Used tools";
  const str = parts.join(", ");
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function TimelineGroup({ items }: { items: ToolEvent[] }) {
  const [open, setOpen] = useState(false);
  const name = getGroupName(items);

  return (
    <div className="min-w-0 max-w-full text-[13px] leading-5 text-muted-foreground/80">
      <button
        type="button"
        className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-left transition-colors hover:text-foreground/90"
        onClick={() => setOpen((o) => !o)}
      >
        <HugeiconsIcon icon={BookOpen01Icon} className="size-4 shrink-0 opacity-70" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{name}</span>
        {open ? <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5 opacity-70" /> : <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5 opacity-70" />}
      </button>
      {open ? (
        <div className="ml-2 mt-2 space-y-2 border-l border-border/40 pl-4">
          {items.map((event) => (
            <TimelineRow event={event} key={event.segmentId ?? event.id} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimelineRow({ event, nested }: { event: ToolEvent; nested?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isReasoning = event.segmentKind === "reasoning" || event.type === "reasoning";
  const isPublicProgress = event.segmentKind === "intermediate_response";
  const isActive = event.status === "active" || event.status === "queued";
  const hasDetails = Boolean(event.detail?.trim()) && !isReasoning;

  if (isReasoning) {
    return event.detail?.trim() ? (
      <div className="max-w-full break-words [overflow-wrap:anywhere] text-[14px] leading-6 text-foreground/90">
        <ChatMarkdown content={event.detail} />
      </div>
    ) : isActive ? (
      <ActivityLabel label="Thinking" />
    ) : null;
  }

  if (isPublicProgress) {
    const content = event.detail?.trim() || event.summary?.trim() || event.title || event.label;
    return content ? (
      <div className="max-w-full break-words [overflow-wrap:anywhere] text-[14px] leading-6 text-foreground/90">
        <ChatMarkdown content={content} />
      </div>
    ) : null;
  }

  const Icon = getToolIcon(event.type);

  return (
    <div className={`min-w-0 max-w-full leading-5 ${nested ? "text-[12.5px] text-muted-foreground/75" : "text-[13px] text-muted-foreground/80"}`}>
      <button
        type="button"
        disabled={!hasDetails}
        className="flex min-w-0 max-w-full items-start gap-2 overflow-hidden text-left disabled:cursor-default enabled:hover:text-foreground/90 transition-colors"
        onClick={() => hasDetails && setDetailsOpen((value) => !value)}
      >
        <div className="flex h-5 items-center justify-center">
          {isActive ? (
            <HugeiconsIcon icon={Loading01Icon} className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : Icon ? (
            <HugeiconsIcon icon={Icon} className="size-4 shrink-0 opacity-70" />
          ) : (
            <span className="size-4 shrink-0 text-center opacity-70">·</span>
          )}
        </div>
        <span className="min-w-0 break-words [overflow-wrap:anywhere] pt-0.5 leading-snug">{event.title ?? event.label}</span>
      </button>
      {detailsOpen ? (
        <div className="ml-[1.375rem] my-2 max-w-full border-l-2 border-border/50 pl-3 py-1">
          <RawSyntaxHighlighter
            language={
              event.type === "edit" || event.detail?.includes("@@")
                ? "diff"
                : event.type === "command"
                  ? "bash"
                  : event.detail?.trim().startsWith("{")
                    ? "json"
                    : "typescript"
            }
            content={event.detail ?? ""}
            className="[&_pre]:!bg-transparent"
          />
        </div>
      ) : null}
    </div>
  );
}

function ActivityLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground/80">
      <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" />
      {label}
    </div>
  );
}
