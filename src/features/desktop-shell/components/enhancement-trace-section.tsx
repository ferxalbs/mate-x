import {
  ActivityIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Clock3Icon,
  FileSearchIcon,
  FileTextIcon,
  RadarIcon,
  TerminalIcon,
} from "lucide-react";

import type { EvidencePack, ToolEvent } from "../../../contracts/chat";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import type { ImpactSummary } from "./enhancement-panel-utils";

interface TracePanelRow {
  title: string;
  detail: string;
  icon: typeof ActivityIcon;
  status: ToolEvent["status"];
}

interface TraceSectionProps {
  changedFiles: string[];
  commands: string[];
  evidencePack: EvidencePack | null;
  events: ToolEvent[];
  hasHealth: boolean;
  impactedFiles: RepoGraphImpactedFile[];
  isLoading?: boolean;
  isRunning?: boolean;
  scanPhase: string | null;
  summary: ImpactSummary;
}

export function TraceSection({
  changedFiles,
  commands,
  evidencePack,
  events,
  hasHealth,
  impactedFiles,
  isLoading,
  isRunning,
  scanPhase,
  summary,
}: TraceSectionProps) {
  const traceModel = buildTraceModel({
    changedFiles,
    commands,
    evidencePack,
    events,
    hasHealth,
    impactedFiles,
    isLoading: Boolean(isLoading),
    isRunning: Boolean(isRunning),
    scanPhase,
    summary,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={ActivityIcon} title="Agent TRACE" />
        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[10px] font-medium",
            traceModel.healthTone,
          )}
        >
          {traceModel.badge}
        </span>
      </div>
      {isLoading ? <SkeletonStack /> : null}
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Active" value={traceModel.eventCounts.active} />
        <Metric label="Done" value={traceModel.eventCounts.done} />
        <Metric label="Issues" value={traceModel.eventCounts.error} />
      </dl>
      <TraceGroup
        caption={traceModel.linksCaption}
        rows={traceModel.linkRows}
        title="System links"
      />
      <TraceGroup
        caption={`Latest ${traceModel.recentEvents.length}`}
        emptyText="No runtime tool events captured for this turn yet"
        rows={traceModel.recentEvents}
        startIndex={events.length - traceModel.recentEvents.length + 1}
        title="Runtime events"
      />
    </section>
  );
}

function buildTraceModel(input: {
  changedFiles: string[];
  commands: string[];
  evidencePack: EvidencePack | null;
  events: ToolEvent[];
  hasHealth: boolean;
  impactedFiles: RepoGraphImpactedFile[];
  isLoading: boolean;
  isRunning: boolean;
  scanPhase: string | null;
  summary: ImpactSummary;
}) {
  const eventCounts = input.events.reduce(
    (counts, event) => {
      counts[event.status] += 1;
      return counts;
    },
    { active: 0, done: 0, error: 0 },
  );
  const hasChanges = input.changedFiles.length > 0;
  const hasImpact = input.impactedFiles.length > 0;
  const hasCommands = input.commands.length > 0;
  const busy = input.isLoading || input.isRunning;
  const activeStatus: ToolEvent["status"] = "active";
  const doneStatus: ToolEvent["status"] = "done";
  const linkRows: TracePanelRow[] = [
    {
      title: input.scanPhase ?? (input.hasHealth ? "Workspace profile linked" : "Workspace profile unavailable"),
      detail: input.hasHealth
        ? "Stack, git, validation, and secret signals are connected."
        : busy
          ? "Local git and RepoGraph signals are connected while profile resolves."
          : "Profile signal not available; using local git, RepoGraph, and run evidence.",
      icon: RadarIcon,
      status: input.hasHealth ? doneStatus : busy ? activeStatus : doneStatus,
    },
    {
      title: hasChanges ? "Change set mapped" : "Change set clean",
      detail: hasChanges
        ? `${input.changedFiles.length} changed path${input.changedFiles.length === 1 ? "" : "s"} from live git status.`
        : "Live git status reports no local edits.",
      icon: FileTextIcon,
      status: doneStatus,
    },
    {
      title: hasImpact ? "RepoGraph impact ready" : hasChanges ? "RepoGraph returned no fan-out" : "RepoGraph ready",
      detail: hasImpact
        ? `${input.summary.affectedCount} affected target${input.summary.affectedCount === 1 ? "" : "s"}; fan-out ${input.summary.toolFanoutCount}.`
        : hasChanges
          ? "Changed files scanned; no downstream target returned."
          : "No changed path to expand.",
      icon: FileSearchIcon,
      status: hasImpact || hasChanges || !busy ? doneStatus : activeStatus,
    },
    {
      title: hasCommands ? "Validation route ready" : "Validation route unavailable",
      detail: hasCommands
        ? `${input.commands.length} command signal${input.commands.length === 1 ? "" : "s"} from evidence, tests, or workspace profile.`
        : "No validation command signal found in current workspace state.",
      icon: TerminalIcon,
      status: hasCommands ? doneStatus : busy ? activeStatus : doneStatus,
    },
    {
      title: input.evidencePack ? "Evidence pack attached" : "Evidence pack unavailable",
      detail: input.evidencePack
        ? `${input.evidencePack.status} with ${input.evidencePack.commandsExecuted?.length ?? 0} command signal${(input.evidencePack.commandsExecuted?.length ?? 0) === 1 ? "" : "s"}.`
        : "No verified run evidence pack attached yet.",
      icon: ClipboardCheckIcon,
      status: input.evidencePack ? doneStatus : busy ? activeStatus : doneStatus,
    },
  ];
  const recentEvents = input.events.slice(-5).map((event) => ({
    title: normalizeTraceTitle(event.label),
    detail: summarizeTraceDetail(event.detail),
    icon: ActivityIcon,
    status: event.status,
  }));
  const healthTone =
    eventCounts.error > 0
      ? "border-amber-500/25 bg-amber-500/10 text-amber-500"
      : busy
        ? "border-blue-500/25 bg-blue-500/10 text-blue-500"
        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-500";

  return {
    badge: busy ? `${input.events.length} live events` : `${input.events.length} real events`,
    eventCounts,
    healthTone,
    linkRows,
    linksCaption: busy ? "Live scan state" : "Connected state",
    recentEvents,
  };
}

function TraceGroup({
  caption,
  emptyText,
  rows,
  startIndex = 1,
  title,
}: {
  caption: string;
  emptyText?: string;
  rows: TracePanelRow[];
  startIndex?: number;
  title: string;
}) {
  return (
    <Card className="border-border/70 shadow-none bg-[var(--mate-control-bg)] backdrop-blur-md">
      <CardContent className="p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-wider font-medium uppercase text-muted-foreground/70">
            {title}
          </p>
          <p className="text-[10px] text-muted-foreground/70">{caption}</p>
        </div>
      <div className="space-y-1.5">
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <TraceRow
              index={startIndex + index}
              key={`${row.title}:${index}`}
              row={row}
            />
          ))
        ) : (
          <EmptyLine text={emptyText ?? "No trace rows available"} />
        )}
      </div>
      </CardContent>
    </Card>
  );
}

function TraceRow({
  index,
  row,
}: {
  index: number;
  row: TracePanelRow;
}) {
  const Icon = row.icon;

  return (
    <Card className="border-border/50 shadow-none bg-[var(--mate-control-bg)] backdrop-blur-md">
      <CardContent className="px-2.5 py-2">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums",
              traceStatusTone(row.status),
            )}
          >
            {index}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-primary" />
              <p className="truncate text-[11px] font-medium text-foreground">{row.title}</p>
              <TraceStatusIcon status={row.status} />
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground break-words">
              {row.detail}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TraceStatusIcon({ status }: { status: ToolEvent["status"] }) {
  if (status === "active") {
    return <Clock3Icon className="size-3 shrink-0 text-primary/75" />;
  }

  if (status === "error") {
    return <AlertCircleIcon className="size-3 shrink-0 text-amber-500" />;
  }

  return <CheckCircle2Icon className="size-3 shrink-0 text-emerald-500" />;
}

function traceStatusTone(status: ToolEvent["status"]) {
  if (status === "active") {
    return "border-primary/35 text-primary";
  }

  if (status === "error") {
    return "border-amber-500/35 text-amber-500";
  }

  return "border-emerald-500/35 text-emerald-500";
}

function PanelTitle({
  icon: Icon,
  title,
}: {
  icon: typeof ActivityIcon;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-primary" />
      <h3 className="truncate text-[12px] font-semibold text-foreground/90">
        {title}
      </h3>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/70 shadow-none bg-transparent">
      <CardContent className="px-2 py-1.5">
        <dt className="text-muted-foreground/70 uppercase tracking-wider text-[10px]">{label}</dt>
        <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
      </CardContent>
    </Card>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="px-2.5 py-1.5">
        <p className="text-[11px] text-muted-foreground">
          {text}
        </p>
      </CardContent>
    </Card>
  );
}

function SkeletonStack() {
  return (
    <div className="space-y-2">
      <div className="h-10 animate-pulse rounded-2xl border border-border/70 bg-transparent" />
      <div className="h-8 w-4/5 animate-pulse rounded-2xl border border-border/70 bg-transparent" />
    </div>
  );
}

function summarizeTraceDetail(detail: string) {
  const trimmed = detail.trim();

  if (!trimmed) {
    return "Event recorded without extra detail.";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as
        | {
            channel?: string;
            callees?: string[];
            callers?: string[];
            files?: string[];
            command?: string;
            status?: string;
            toolName?: string;
          }
        | Array<{ channel?: string; file?: string; command?: string; toolName?: string }>;

      if (Array.isArray(parsed)) {
        const labels = parsed
          .map((entry) => entry.channel ?? entry.command ?? entry.file ?? entry.toolName)
          .filter(Boolean)
          .slice(0, 3);
        return labels.length > 0
          ? `${labels.join(", ")}${parsed.length > labels.length ? "..." : ""}`
          : `${parsed.length} structured events captured.`;
      }

      if (parsed.channel) {
        const targets = [
          ...(parsed.callees ?? []),
          ...(parsed.callers ?? []),
          ...(parsed.files ?? []),
        ].slice(0, 2);
        return targets.length > 0
          ? `${parsed.channel} touches ${targets.join(", ")}`
          : `${parsed.channel} IPC surface mapped.`;
      }

      if (parsed.command) {
        return `Command signal: ${sanitizeRuntimeText(parsed.command)}`;
      }

      if (parsed.toolName) {
        return `${parsed.toolName} ${parsed.status ?? "event"} captured.`;
      }

      return "Structured evidence captured.";
    } catch {
      return compactTraceText(trimmed);
    }
  }

  return compactTraceText(trimmed);
}

function normalizeTraceTitle(title: string) {
  return sanitizeRuntimeText(title)
    .replace(/\bpending\b/gi, "Queued")
    .replace(/\brunning\b/gi, "Running")
    .trim();
}

function compactTraceText(text: string) {
  const compact = sanitizeRuntimeText(text).replace(/\s+/g, " ");
  return compact.length > 150 ? `${compact.slice(0, 147)}...` : compact;
}

function sanitizeRuntimeText(text: string) {
  return text
    .replace(/\bawaiting\b/gi, "resolving")
    .replace(/\bawait\b/gi, "async step")
    .replace(/\bPromise\b/g, "async task");
}
