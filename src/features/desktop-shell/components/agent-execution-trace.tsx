import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { normalizeToolEvent, type ToolEvent } from "../../../contracts/chat";
import { formatDuration, getTimelineDuration, getTimelineStart } from "./agent-execution-trace-utils";

export const AgentExecutionTrace = memo(function AgentExecutionTrace({
  events,
  isRunning,
}: {
  events: ToolEvent[];
  isRunning: boolean;
  thought?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizedEvents = useMemo(() => {
    return events
      .map((event, sequence) => normalizeToolEvent(event, { sequence }))
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }, [events]);
  const timeline = normalizedEvents.filter(
    (segment) => segment.segmentKind !== "final_response" && segment.visibility !== "technical" && segment.visibility !== "restricted",
  );
  const settledTimeline = isRunning
    ? timeline
    : timeline.filter((event) => event.status !== "active" && event.status !== "queued");
  const errors = settledTimeline.filter((event) => ["error", "failed", "blocked"].includes(event.status));
  const visible = isRunning || expanded ? settledTimeline : errors;
  const duration = useRunDuration(normalizedEvents, isRunning);

  if (timeline.length === 0) return null;

  return (
    <section className="min-w-0 max-w-full space-y-2 overflow-hidden" aria-label="Agent activity">
      <button
        type="button"
        disabled={isRunning}
        className="flex w-full items-center gap-2 border-b border-border/60 pb-2 text-left text-[12px] text-muted-foreground/75 transition-colors duration-[var(--motion-press)] ease-[var(--ease-out)] enabled:hover:text-foreground disabled:cursor-default"
        aria-expanded={isRunning ? undefined : expanded}
        onClick={() => !isRunning && setExpanded((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          {isRunning ? "Working" : "Worked"} for {formatDuration(duration)}
        </span>
        {isRunning ? <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" /> : expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
      </button>

      <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
        {visible.map((event) => (
          <TimelineRow event={event} key={event.segmentId ?? event.id} />
        ))}
      </div>
    </section>
  );
});

function useRunDuration(timeline: ToolEvent[], isRunning: boolean) {
  const startedAt = useMemo(() => getTimelineStart(timeline), [timeline]);
  const completedDuration = useMemo(() => getTimelineDuration(timeline), [timeline]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning, startedAt]);

  return isRunning && startedAt !== null ? Math.max(0, now - startedAt) : completedDuration;
}

function TimelineRow({ event }: { event: ToolEvent }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isReasoning = event.segmentKind === "reasoning" || event.type === "reasoning";
  const isActive = event.status === "active";
  const hasDetails = Boolean(event.detail?.trim()) && !isReasoning;

  if (isReasoning) {
    return event.detail?.trim() ? (
      <p className="max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-6 text-foreground/90">
        {event.detail}
      </p>
    ) : isActive ? <ActivityLabel label="Thinking" /> : null;
  }

  return (
    <div className="min-w-0 max-w-full text-[12px] leading-5 text-muted-foreground/75">
      <button
        type="button"
        disabled={!hasDetails}
        className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-left disabled:cursor-default"
        onClick={() => hasDetails && setDetailsOpen((value) => !value)}
      >
        {isActive ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : <span className="size-3.5 shrink-0 text-center">·</span>}
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{event.title ?? event.label}</span>
        {hasDetails ? detailsOpen ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" /> : null}
      </button>
      {detailsOpen ? (
        <pre className="ml-5 mt-1 max-h-64 max-w-[calc(100%-1.25rem)] overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-border/70 bg-[var(--panel)]/92 p-3 text-[11px] shadow-none backdrop-blur-xl">
          {event.detail}
        </pre>
      ) : null}
    </div>
  );
}

function ActivityLabel({ label }: { label: string }) {
  return <div className="flex items-center gap-2 text-[12px] text-muted-foreground/75"><LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />{label}</div>;
}
