import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  normalizeToolEvent,
  type ToolEvent,
  type ToolEventStatus,
} from "../../../contracts/chat";

const MAX_VISIBLE_EVENTS = 100;

export const AgentExecutionTrace = memo(function AgentExecutionTrace({
  events,
  isRunning,
  thought,
}: {
  events: ToolEvent[];
  isRunning: boolean;
  thought?: string;
}) {
  const startedAtRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [expanded, setExpanded] = useState(isRunning);
  const [userInspected, setUserInspected] = useState(false);
  const normalizedEvents = useMemo(
    () => events.map((event, sequence) => normalizeToolEvent(event, { sequence })),
    [events],
  );

  useEffect(() => {
    if (!isRunning) return;
    const updateElapsed = () => setElapsedMs(Date.now() - startedAtRef.current);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning) setExpanded(true);
    else if (!userInspected) setExpanded(false);
  }, [isRunning, userInspected]);

  if (!isRunning && normalizedEvents.length === 0 && !thought) return null;

  const visibleEvents = normalizedEvents.slice(-MAX_VISIBLE_EVENTS);
  const failed = normalizedEvents.some((event) =>
    ["error", "failed", "blocked"].includes(event.status),
  );
  const activeEvent = normalizedEvents.findLast((event) => event.status === "active");
  const duration = Math.max(
    elapsedMs,
    ...normalizedEvents.map((event) => event.durationMs ?? 0),
  );

  return (
    <section className="text-[14px] leading-6 text-foreground">
      <button
        aria-expanded={expanded}
        className="group/trace flex w-full items-center gap-2 border-b border-border/60 pb-2 text-left text-[13px] text-muted-foreground transition-colors duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
        onClick={() => {
          setExpanded((value) => !value);
          setUserInspected(true);
        }}
        type="button"
      >
        <span aria-live="polite" className="min-w-0 flex-1 truncate">
          {isRunning
            ? activeEvent?.title ?? (thought ? "Thinking" : "Waiting for the model")
            : `${failed ? "Finished with issues" : "Worked"} for ${formatDuration(duration)}`}
        </span>
        {expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        )}
      </button>

      {expanded ? (
        <div className="pt-3">
          {thought ? (
            <p className="mb-4 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground/90">
              {thought}
            </p>
          ) : null}

          <div className="space-y-1" role="list">
            {visibleEvents.map((event) => (
              <TraceEventRow event={event} key={`${event.runId ?? "legacy"}:${event.id}`} />
            ))}
            {isRunning && visibleEvents.length === 0 ? (
              <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                Waiting for observable activity
              </div>
            ) : null}
          </div>

          {normalizedEvents.length > MAX_VISIBLE_EVENTS ? (
            <p className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Showing the latest {MAX_VISIBLE_EVENTS} of {normalizedEvents.length} actions
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

function TraceEventRow({ event }: { event: ToolEvent }) {
  const detail = event.summary || event.detail;
  const important = ["error", "failed", "blocked"].includes(event.status);
  const [open, setOpen] = useState(important);

  return (
    <div role="listitem">
      <button
        aria-expanded={detail ? open : undefined}
        className="flex w-full items-start gap-2 py-1 text-left text-[12px] leading-5 text-muted-foreground transition-colors duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
        onClick={() => detail && setOpen((value) => !value)}
        type="button"
      >
        <TraceIcon status={event.status} />
        <span className="min-w-0 flex-1 break-words">{event.title}</span>
        {event.agentId ? (
          <span className="max-w-28 truncate text-[10px] text-muted-foreground/60">
            {event.agentId}
          </span>
        ) : null}
        {detail ? (
          open ? <ChevronDownIcon className="mt-1 size-3" /> : <ChevronRightIcon className="mt-1 size-3" />
        ) : null}
      </button>
      {open && detail ? (
        <div className="ml-5 mb-2 border-l border-border/60 pl-3 text-[12px] leading-5 text-muted-foreground">
          <p className="whitespace-pre-wrap break-words">{detail}</p>
          {event.artifacts?.command ? (
            <code className="mt-2 block overflow-x-auto rounded-2xl border border-border/60 bg-[var(--panel)]/92 p-3 break-all shadow-none">
              {event.artifacts.command}
            </code>
          ) : null}
          {event.artifacts?.output ? (
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/60 bg-[var(--panel)]/92 p-3 break-all shadow-none">
              {event.artifacts.output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TraceIcon({ status }: { status: ToolEventStatus }) {
  if (status === "active") {
    return <LoaderCircleIcon className="mt-1 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />;
  }
  if (["error", "failed", "blocked"].includes(status)) {
    return <AlertCircleIcon className="mt-1 size-3.5 shrink-0 text-destructive" />;
  }
  if (["done", "completed"].includes(status)) {
    return <CheckIcon className="mt-1 size-3.5 shrink-0 text-emerald-500" />;
  }
  return <CircleIcon className="mt-1 size-3.5 shrink-0" />;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return "<1s";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
