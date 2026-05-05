import {
  ActivityIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileSearchIcon,
  FileTextIcon,
  RadarIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { EvidencePack, ToolEvent } from "../../../contracts/chat";
import { cn } from "../../../lib/utils";
import type {
  ImpactSummary,
  RepoHealthSignal,
  SignalTone,
} from "./enhancement-panel-utils";
import { getRepoHealthVerdict } from "./enhancement-panel-utils";

export type EnhancementView = "trace" | "impact" | "validation" | "evidence";

interface BaseSectionProps {
  changedFiles: string[];
  impactedFiles: RepoGraphImpactedFile[];
  isLoading?: boolean;
  summary: ImpactSummary;
}

export function TraceSection({
  changedFiles,
  events,
  impactedFiles,
  isLoading,
  summary,
}: BaseSectionProps & { events: ToolEvent[] }) {
  const traceRows =
    events.length > 0
      ? events.slice(-5).map((event) => ({
          title: event.label,
          detail: summarizeTraceDetail(event.detail),
          icon: ActivityIcon,
          active: event.status !== "error",
        }))
      : [
          {
            title: "Workspace context",
            detail:
              changedFiles.length > 0
                ? `${changedFiles.length} changed files scoped locally.`
                : "No thread events yet. Run a task to populate live TRACE.",
            icon: RadarIcon,
            active: changedFiles.length > 0,
          },
          {
            title: "RepoGraph impact",
            detail:
              impactedFiles.length > 0
                ? `${impactedFiles.length} impacted entries from graph.`
                : "Waiting for changed files or active run events.",
            icon: FileSearchIcon,
            active: impactedFiles.length > 0,
          },
          {
            title: "Risk state",
            detail: `Current impact risk: ${summary.risk}.`,
            icon: ShieldCheckIcon,
            active: summary.risk !== "None",
          },
        ];

  return (
    <section className="space-y-3">
      <PanelTitle icon={ActivityIcon} title="TRACE Runtime" />
      {isLoading ? <SkeletonStack /> : null}
      <div className="space-y-2">
        {traceRows.map((row, index) => (
          <div
            className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/24 p-2.5"
            key={row.title}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums",
                  row.active
                    ? "border-emerald-500/35 text-emerald-500"
                    : "border-[var(--panel-border)]/35 text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <row.icon className="size-3.5 shrink-0 text-primary" />
                  <p className="truncate text-[11px] font-medium">{row.title}</p>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  {row.detail}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ImpactSection({
  changedFiles,
  impactedFiles,
  isLoading,
  summary,
}: BaseSectionProps) {
  const source = changedFiles[0] ?? "No active change";
  const sourceIsArtifact = /\.(pdf|md|txt|html)$/i.test(source);
  const directImpact = impactedFiles.find((entry) => !entry.group)?.file ?? "Awaiting RepoGraph";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={FileSearchIcon} title="Impact Map" />
        <RiskPill risk={summary.risk} />
      </div>
      {isLoading ? <SkeletonStack /> : null}
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Changed" value={changedFiles.length} />
        <Metric label="Affected" value={summary.affectedCount} />
        <Metric label="Fan-out" value={summary.toolFanoutCount} />
      </dl>
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
        <p className="text-[10px] font-medium uppercase text-amber-500">
          {sourceIsArtifact ? "Evidence artifact" : "Source of change"}
        </p>
        <p className="mt-1 truncate font-mono text-[11px]" title={source}>
          {source}
        </p>
        {sourceIsArtifact ? (
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Artifact captured from run. Source-code paths must come from trace or
            RepoGraph before claiming impact.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ImpactNode label="Direct impact" tone="good" value={directImpact} />
        <ImpactNode
          label="Skipped"
          tone="muted"
          value={summary.affectedCount > 0 ? "Unrelated suites" : "No target yet"}
        />
      </div>
      <div className="space-y-1.5">
        {impactedFiles.slice(0, 4).map((entry) => (
          <ImpactRow entry={entry} key={`${entry.file}:${entry.distance}`} />
        ))}
        {impactedFiles.length === 0 ? (
          <EmptyLine text="Run scan after edits to calculate blast radius" />
        ) : null}
      </div>
      <p className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.04] px-3 py-2 text-[10px] leading-4 text-muted-foreground">
        Optimization: verify impacted paths first, skip unrelated suites when
        RepoGraph proves isolation.
      </p>
    </section>
  );
}

export function ValidationSection({
  commands,
  evidencePack,
  isLoading,
  tests,
}: {
  commands: string[];
  evidencePack: EvidencePack | null;
  isLoading?: boolean;
  tests: string[];
}) {
  const visibleCommands = commands.length > 0 ? commands : [];

  return (
    <section className="space-y-3">
      <PanelTitle icon={TerminalIcon} title="Validation Terminal" />
      {isLoading ? <SkeletonStack /> : null}
      <div className="rounded-2xl border border-[var(--panel-border)]/35 bg-[#0a0a0a]/80 p-3 font-mono text-[10px]">
        <div className="mb-3 flex items-center gap-1.5 border-b border-white/10 pb-2 text-muted-foreground">
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="ml-1">mate-x verification</span>
        </div>
        <div className="space-y-3">
          {visibleCommands.map((command) => (
            <div key={command}>
              <p className="text-muted-foreground">$ {formatCommandLabel(command)}</p>
              <p className="mt-1 border-l border-emerald-500/25 pl-3 text-emerald-400">
                {evidencePack ? "executed evidence signal" : "planned from workspace profile"}
              </p>
            </div>
          ))}
          {visibleCommands.length === 0 ? (
            <p className="text-muted-foreground">
              No validation command evidence yet. Run verified task or scan changed files.
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label="Mapped tests" value={tests.length} />
        <Metric label="Commands" value={visibleCommands.length} />
      </div>
    </section>
  );
}

export function EvidencePackSection({
  changedFiles,
  commands,
  evidenceFiles,
  evidencePack,
  impactedFiles,
  score,
  summary,
}: {
  changedFiles: string[];
  commands: string[];
  evidenceFiles: string[];
  evidencePack: EvidencePack | null;
  impactedFiles: RepoGraphImpactedFile[];
  score: number | null;
  summary: ImpactSummary;
}) {
  const filesCount = evidenceFiles.length || changedFiles.length;
  const commandCount = evidencePack?.commandsExecuted?.length ?? commands.length;
  const verdict = evidencePack?.verdict.label ?? "Pending verified run";
  const scoreTone = getEvidenceTone(score, verdict);
  const runFailed = /fail|error|blocked/i.test(verdict);
  const lowConfidence = score !== null && score < 50;
  const fileLabel = `${filesCount} ${filesCount === 1 ? "file" : "files"}`;
  const securityTone = getSecurityRiskTone(verdict, summary.risk);
  const blastRadius =
    impactedFiles.length > 0
      ? summary.risk
      : changedFiles.length > 0
        ? "Unknown"
        : "No changes";

  return (
    <section className="space-y-3">
      <PanelTitle icon={ClipboardCheckIcon} title="Evidence Pack" />
      {!evidencePack ? <SkeletonStack /> : null}
      <div
        className={cn(
          "rounded-2xl border p-3",
          toneSurfaceClassName(scoreTone),
        )}
      >
        <p className="text-[10px] uppercase text-muted-foreground">
          Evidence Confidence
        </p>
        <div className="mt-1 flex items-baseline gap-1">
          <span className={cn("text-3xl font-semibold", toneValueClassName(scoreTone))}>
            {score ?? "--"}
          </span>
          <span className="text-[12px] text-muted-foreground">/100</span>
        </div>
        {evidencePack ? (
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            {getEvidenceScoreReason(score, verdict, commandCount, filesCount)}
          </p>
        ) : null}
      </div>
      {runFailed ? (
        <FailureReasonCard
          commandCount={commandCount}
          filesCount={filesCount}
          verdict={verdict}
        />
      ) : null}
      <EvidenceRow label="Files touched" value={fileLabel} />
      <EvidenceRow label="Commands" value={`${commandCount} signals`} />
      <EvidenceRow
        label="Security risk"
        tone={securityTone}
        value={cleanVerdictLabel(verdict)}
      />
      <EvidenceRow
        label="Evidence confidence"
        tone={scoreTone}
        value={getConfidenceLabel(score, verdict)}
      />
      <EvidenceRow
        label="Blast radius"
        tone={impactTone(blastRadius)}
        value={blastRadius}
      />
      <EvidenceRow
        label="Verdict"
        tone={scoreTone}
        value={runFailed ? verdict : getVerdictReadiness(score)}
      />
      <EvidenceRow
        label="Risk log"
        tone={
          runFailed || lowConfidence
            ? "bad"
            : (evidencePack?.unresolvedRisks?.length ?? 0) > 0
              ? "warn"
              : "good"
        }
        value={
          runFailed
            ? "Incomplete"
            : lowConfidence
              ? "Not validated"
            : `${evidencePack?.unresolvedRisks?.length ?? 0} unresolved`
        }
      />
    </section>
  );
}

export function RepoHealthSection({
  hasProfile,
  signals,
  nextAction,
}: {
  hasProfile: boolean;
  signals: RepoHealthSignal[];
  nextAction?: string;
}) {
  const verdict = getRepoHealthVerdict(signals, hasProfile);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={ZapIcon} title="Repo Health" />
        <TonePill label={verdict.label} tone={verdict.tone} />
      </div>
      {!hasProfile ? (
        <div className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/18 px-3 py-2">
          <p className="text-[11px] font-medium">Workspace profile unavailable</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Stack/test/lint/git signals pending. Audit evidence still shown above.
          </p>
        </div>
      ) : null}
      {hasProfile ? (
      <div
        className={cn(
          "rounded-2xl border p-3",
          toneSurfaceClassName(verdict.tone),
        )}
      >
        <p className="text-[10px] font-medium uppercase text-muted-foreground">
          Live repo verdict
        </p>
        <p className="mt-1 text-[12px] font-semibold">{verdict.detail}</p>
        {!hasProfile ? (
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            Waiting for stack, package manager, test, lint, git, and secret
            signals from workspace health service.
          </p>
        ) : null}
      </div>
      ) : null}
      {hasProfile ? (
        <dl className="grid grid-cols-2 gap-2 text-[11px]">
          {signals.map((signal) => (
            <HealthSignalCell signal={signal} key={signal.label} />
          ))}
        </dl>
      ) : null}
      {nextAction ? (
        <p
          className="truncate rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-2 text-[11px]"
          title={nextAction}
        >
          {nextAction}
        </p>
      ) : null}
    </section>
  );
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
    <div className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function RiskPill({ risk }: { risk: string }) {
  const tone =
    risk === "High"
      ? "bad"
      : risk === "Medium"
        ? "warn"
        : risk === "Low"
          ? "good"
          : "muted";

  return (
    <TonePill label={risk} tone={tone} />
  );
}

function ImpactNode({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "good" | "muted";
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-2.5 text-center",
        tone === "good"
          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
          : "border-[var(--panel-border)]/30 bg-background/20 opacity-70",
      )}
    >
      <p className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-[10px]" title={value}>
        {value}
      </p>
    </div>
  );
}

function ImpactRow({ entry }: { entry: RepoGraphImpactedFile }) {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-1.5 text-[11px]"
      title={entry.reason}
    >
      <span className="shrink-0 text-muted-foreground tabular-nums">
        d{entry.distance}
      </span>
      <FileTextIcon className="size-3 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">{entry.group ?? entry.file}</span>
      {entry.hiddenCount ? (
        <span className="shrink-0 text-muted-foreground">
          +{entry.hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-[var(--panel-border)]/30 bg-background/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      {text}
    </p>
  );
}

function SkeletonStack() {
  return (
    <div className="space-y-2">
      <div className="h-10 animate-pulse rounded-2xl border border-[var(--panel-border)]/25 bg-background/28" />
      <div className="h-8 w-4/5 animate-pulse rounded-2xl border border-[var(--panel-border)]/20 bg-background/20" />
    </div>
  );
}

function EvidenceRow({
  label,
  tone = "good",
  value,
}: {
  label: string;
  tone?: SignalTone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)]/35 bg-background/24 px-3 py-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
        <CheckCircle2Icon
          className={cn("size-3.5 shrink-0", toneValueClassName(tone))}
        />
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function FailureReasonCard({
  commandCount,
  filesCount,
  verdict,
}: {
  commandCount: number;
  filesCount: number;
  verdict: string;
}) {
  return (
    <div className="rounded-2xl border border-destructive/35 bg-destructive/[0.045] p-3">
      <p className="text-[10px] font-medium uppercase text-destructive">
        Blocking issue
      </p>
      <p className="mt-1 text-[11px] font-semibold text-foreground">
        {verdict}: evidence run did not complete cleanly.
      </p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        Captured {commandCount} command signals and {filesCount} file
        signal{filesCount === 1 ? "" : "s"}, but review cannot be trusted until
        file-level diff evidence completes.
      </p>
    </div>
  );
}

function formatCommandLabel(command: string) {
  const name = command.trim().split(/\s+/, 1)[0] ?? command;
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getEvidenceTone(score: number | null, verdict: string): SignalTone {
  if (/fail|error|blocked/i.test(verdict)) {
    return "bad";
  }
  if (score === null) {
    return "muted";
  }
  if (score < 50) {
    return "bad";
  }
  if (score < 75) {
    return "warn";
  }
  if (score < 90) {
    return "watch";
  }

  return "good";
}

function getEvidenceScoreReason(
  score: number | null,
  verdict: string,
  commandCount: number,
  filesCount: number,
) {
  if (/fail|error|blocked/i.test(verdict)) {
    return `Low score because run verdict is ${verdict}. Evidence captured ${commandCount} command signals across ${filesCount} file signal${filesCount === 1 ? "" : "s"}, but result did not complete cleanly.`;
  }
  if (score === null) {
    return "Score pending until verified task run completes.";
  }
  if (score < 50) {
    return "Low confidence. Findings may be useful, but claim needs stronger file-level verification before demo use.";
  }
  if (score < 75) {
    return "Partial confidence. Review unresolved risks before demo claim.";
  }

  return "Evidence is strong enough for product demo summary.";
}

function getConfidenceLabel(score: number | null, verdict: string) {
  if (/fail|error|blocked/i.test(verdict)) {
    return "Failed";
  }
  if (score === null) {
    return "Pending";
  }
  if (score < 50) {
    return "Low";
  }
  if (score < 75) {
    return "Partial";
  }
  if (score < 90) {
    return "High";
  }

  return "Verified";
}

function getVerdictReadiness(score: number | null) {
  if (score === null) {
    return "Pending";
  }
  if (score < 50) {
    return "Needs evidence";
  }
  if (score < 75) {
    return "Review before demo";
  }

  return "Demo-ready";
}

function getSecurityRiskTone(verdict: string, fallbackRisk: string): SignalTone {
  const label = cleanVerdictLabel(verdict).toLowerCase();

  if (label.includes("critical") || label.includes("high")) {
    return "bad";
  }
  if (label.includes("medium")) {
    return "warn";
  }
  if (label.includes("low")) {
    return "good";
  }

  return impactTone(fallbackRisk);
}

function cleanVerdictLabel(verdict: string) {
  return verdict.replace(/\*/g, "").trim() || "Pending";
}

function impactTone(risk: string): SignalTone {
  if (risk === "High") {
    return "bad";
  }
  if (risk === "Medium") {
    return "warn";
  }
  if (risk === "Low") {
    return "good";
  }
  if (risk === "Unknown") {
    return "warn";
  }

  return "muted";
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
          }
        | Array<{ channel?: string; file?: string; command?: string }>;

      if (Array.isArray(parsed)) {
        const labels = parsed
          .map((entry) => entry.channel ?? entry.command ?? entry.file)
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
        return `Command signal: ${parsed.command}`;
      }

      return "Structured evidence captured.";
    } catch {
      return compactTraceText(trimmed);
    }
  }

  return compactTraceText(trimmed);
}

function compactTraceText(text: string) {
  const compact = text.replace(/\s+/g, " ");
  return compact.length > 150 ? `${compact.slice(0, 147)}...` : compact;
}

function HealthSignalCell({ signal }: { signal: RepoHealthSignal }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border px-2.5 py-2",
        toneSurfaceClassName(signal.tone),
      )}
    >
      <dt className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="truncate">{signal.label}</span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            toneDotClassName(signal.tone),
          )}
        />
      </dt>
      <dd className="mt-1 truncate font-medium" title={signal.value}>
        {signal.value}
      </dd>
    </div>
  );
}

function TonePill({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        toneTextClassName(tone),
      )}
    >
      {label}
    </span>
  );
}

function toneSurfaceClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "border-destructive/35 bg-destructive/[0.05]";
  }
  if (tone === "warn") {
    return "border-amber-500/35 bg-amber-500/[0.05]";
  }
  if (tone === "watch") {
    return "border-yellow-500/30 bg-yellow-500/[0.045]";
  }
  if (tone === "good") {
    return "border-emerald-500/30 bg-emerald-500/[0.045]";
  }

  return "border-[var(--panel-border)]/35 bg-background/24";
}

function toneTextClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "border-destructive/45 text-destructive";
  }
  if (tone === "warn") {
    return "border-amber-500/45 text-amber-600";
  }
  if (tone === "watch") {
    return "border-yellow-500/45 text-yellow-600";
  }
  if (tone === "good") {
    return "border-emerald-500/45 text-emerald-600";
  }

  return "border-[var(--panel-border)]/45 text-muted-foreground";
}

function toneDotClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "bg-destructive";
  }
  if (tone === "warn") {
    return "bg-amber-500";
  }
  if (tone === "watch") {
    return "bg-yellow-500";
  }
  if (tone === "good") {
    return "bg-emerald-500";
  }

  return "bg-muted-foreground";
}

function toneValueClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "text-destructive";
  }
  if (tone === "warn") {
    return "text-amber-500";
  }
  if (tone === "watch") {
    return "text-yellow-500";
  }
  if (tone === "good") {
    return "text-emerald-500";
  }

  return "text-muted-foreground";
}
