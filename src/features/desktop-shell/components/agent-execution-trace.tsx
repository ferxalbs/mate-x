import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { normalizeToolEvent, type ToolEvent } from "../../../contracts/chat";
import { formatDuration, getTimelineDuration } from "./agent-execution-trace-utils";

export const AgentExecutionTrace = memo(function AgentExecutionTrace({
  events,
  isRunning,
}: {
  events: ToolEvent[];
  isRunning: boolean;
  thought?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const timeline = useMemo(() => {
    const normalized = events.reduce<ToolEvent[]>((result, event, sequence) => {
      const segment = normalizeToolEvent(event, { sequence });
      if (segment.segmentKind !== "final_response") result.push(segment);
      return result;
    }, []);
    return normalized.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }, [events]);
  const errors = timeline.filter((event) => ["error", "failed", "blocked"].includes(event.status));
  const visible = isRunning || expanded ? timeline : errors;
  const duration = getTimelineDuration(timeline);

  if (timeline.length === 0) return null;

  return (
    <section className="min-w-0 max-w-full space-y-2 overflow-hidden" aria-label="Agent activity">
      {!isRunning ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-border/60 pb-2 text-left text-[12px] text-muted-foreground/75 transition-colors duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="min-w-0 flex-1">Worked for {formatDuration(duration)}</span>
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </button>
      ) : null}

      <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
        {visible.map((event) => (
          <TimelineRow event={event} key={event.segmentId ?? event.id} />
        ))}
      </div>
    </section>
  );
});

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
        {isActive ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" /> : <span className="size-3.5 shrink-0 text-center">·</span>}
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
  return <div className="flex items-center gap-2 text-[12px] text-muted-foreground/75"><LoaderCircleIcon className="size-3.5 animate-spin" />{label}</div>;
}
