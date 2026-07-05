import {
  ActivityIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileArchiveIcon,
  FileSearchIcon,
  FileTextIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type {
  EvidencePack,
  VerifiedTaskScoreSignal,
} from "../../../contracts/chat";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { cn } from "../../../lib/utils";
import type {
  ImpactSummary,
  RepoHealthSignal,
  SignalTone,
  TrustGateState,
} from "./enhancement-panel-utils";
import { getRepoHealthVerdict } from "./enhancement-panel-utils";
import { Card, CardContent } from "../../../components/ui/card";

export type EnhancementView = "trace" | "impact" | "validation" | "evidence";

export function TrustGateCard({
  onMakeTrustworthy,
  state,
}: {
  onMakeTrustworthy?: () => void;
  state: TrustGateState;
}) {
  const canMakeTrustworthy =
    Boolean(onMakeTrustworthy) &&
    state.status !== "trusted" &&
    state.status !== "resolving";

  return (
    <Card
      className={cn(
        "mb-4 rounded-2xl border-border/70 shadow-none",
        toneSurfaceClassName(state.tone),
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Trust Gate
            </p>
            <p className={cn("mt-1 break-words text-[16px] font-semibold leading-6", toneValueClassName(state.tone))}>
              {state.verdict}
            </p>
          </div>
          <TonePill label={state.proofLabel} tone={state.tone} />
        </div>
        <p className="mt-2 text-[11px] font-medium text-foreground">
          Don&apos;t merge vibes. Agent changes are not trusted until proven.
        </p>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Validation: {humanizeState(state.validationState)} · Proof:{" "}
          {humanizeState(state.evidencePackState)}
        </p>
        <ul className="mt-2 space-y-1 text-[10px] leading-4 text-muted-foreground">
          {state.reasons.slice(0, 1).map((reason) => (
            <li className="break-words" key={reason}>
              {reason}
            </li>
          ))}
        </ul>
        {state.missingProof.length > 0 ? (
          <p className="mt-2 break-words text-[10px] leading-4 text-muted-foreground">
            Missing proof: {state.missingProof.slice(0, 3).join(", ")}
          </p>
        ) : null}
        <div className="mt-3 rounded-2xl border border-border/50 bg-transparent px-2.5 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Next:</span>{" "}
          {state.suggestedNextAction}
        </div>
        {canMakeTrustworthy ? (
          <button
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-[var(--panel)]/70 px-3 py-2 text-[11px] font-medium text-foreground shadow-none transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-[var(--panel)]"
            onClick={onMakeTrustworthy}
            type="button"
          >
            <ZapIcon className="size-3.5" />
            Make it trustworthy
          </button>
        ) : null}
        {state.touchedRiskSurfaces.length > 0 ? (
          <p className="mt-2 break-all font-mono text-[10px] leading-4 text-muted-foreground">
            Risk surface: {state.touchedRiskSurfaces.slice(0, 2).join(", ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function humanizeState(value: string) {
  return value.replace(/_/g, " ");
}

interface BaseSectionProps {
  changedFiles: string[];
  impactedFiles: RepoGraphImpactedFile[];
  isLoading?: boolean;
  summary: ImpactSummary;
}

export function ImpactSection({
  changedFiles,
  impactedFiles,
  isLoading,
  summary,
}: BaseSectionProps) {
  const source = changedFiles[0] ?? "No active change";
  const sourceIsArtifact = /\.(pdf|md|txt|html|json)$/i.test(source);
  const directImpact =
    impactedFiles.find((entry) => !entry.group)?.file ??
    (changedFiles.length > 0 ? "No downstream target" : "No active change");

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
      <Card className="border-amber-500/20 shadow-none bg-amber-500/[0.04]">
        <CardContent className="p-3">
          <p className="text-[10px] tracking-wider font-medium uppercase text-amber-500">
            {sourceIsArtifact ? "Evidence artifact" : "Source of change"}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-foreground" title={source}>
            {source}
          </p>
        {sourceIsArtifact ? (
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Artifact captured from run. Source-code paths must come from trace
            or RepoGraph before claiming impact.
          </p>
        ) : null}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <ImpactNode label="Direct impact" tone="good" value={directImpact} />
        <ImpactNode
          label="Skipped"
          tone="muted"
          value={
            summary.affectedCount > 0 ? "Unrelated suites" : "No skip signal"
          }
        />
      </div>
      <div className="space-y-1.5">
        {impactedFiles.slice(0, 4).map((entry) => (
          <ImpactRow entry={entry} key={`${entry.file}:${entry.distance}`} />
        ))}
        {impactedFiles.length === 0 ? (
          <EmptyLine text="Map changed paths to estimate blast radius" />
        ) : null}
      </div>
      <Card className="border-blue-500/15 shadow-none bg-blue-500/[0.04]">
        <CardContent className="px-3 py-2 text-[10px] leading-4 text-muted-foreground">
          Optimization: verify impacted paths first, skip unrelated suites when
          RepoGraph proves isolation.
        </CardContent>
      </Card>
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
      <Card className="border-border/70 shadow-none bg-transparent font-mono text-[10px]">
        <CardContent className="p-3">
          <div className="mb-3 flex items-center gap-1.5 border-b border-border/70 pb-2 text-muted-foreground">
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
            <span className="ml-1 uppercase tracking-wider text-[10px]">mate-x verification</span>
          </div>
          <div className="space-y-3">
            {visibleCommands.map((command) => (
              <div key={command}>
                <p className="text-muted-foreground break-all">
                  $ {formatCommandLabel(command)}
                </p>
                <p className="mt-1 border-l border-emerald-500/25 pl-3 text-emerald-500">
                  {evidencePack
                    ? "executed evidence signal"
                    : "planned from workspace profile"}
                </p>
              </div>
            ))}
            {visibleCommands.length === 0 ? (
              <p className="text-muted-foreground">
                No validation command evidence yet. Run a verified task or map
                changed files first.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
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
  const canExportCompliance = Boolean(evidencePack);
  const filesCount = evidencePack ? evidenceFiles.length : 0;
  const commandCount = evidencePack?.commandsExecuted?.length ?? 0;
  const fallbackFileCount = changedFiles.length;
  const fallbackCommandCount = commands.length;
  const verdict = evidencePack?.verdict.label ?? "Pending verified run";
  const scoreTone = getEvidenceTone(score, verdict);
  const runFailed = /fail|error|blocked/i.test(verdict);
  const lowConfidence = score !== null && score < 50;
  const fileLabel = `${filesCount} ${filesCount === 1 ? "file" : "files"}`;
  const commandLabel = `${commandCount} ${commandCount === 1 ? "signal" : "signals"}`;
  const scoreBreakdown = getScoreBreakdown(
    evidencePack?.verifiedTaskScore?.signals ?? [],
  );
  const hasVerifiedScore = score !== null && scoreBreakdown.count > 0;
  const securityTone = getSecurityRiskTone(verdict, summary.risk);
  const blastRadius =
    impactedFiles.length > 0
      ? summary.risk
      : changedFiles.length > 0
        ? "Unknown"
        : "No changes";

  return (
    <section className="space-y-3">
      <PanelTitle icon={ClipboardCheckIcon} title="Ship Proof" />
      {!evidencePack ? <SkeletonStack /> : null}
      <EvidenceConfidenceCard
        commandCount={commandCount}
        filesCount={filesCount}
        hasVerifiedScore={hasVerifiedScore}
        score={score}
        scoreBreakdown={scoreBreakdown}
        scoreTone={scoreTone}
        verdict={verdict}
      />
      {runFailed ? (
        <FailureReasonCard
          commandCount={commandCount}
          filesCount={filesCount}
          verdict={verdict}
        />
      ) : null}
      <EvidenceRow
        label="Files touched"
        tone={filesCount > 0 ? "good" : "warn"}
        value={fileLabel}
      />
      <EvidenceRow
        label="Commands"
        tone={commandCount > 0 ? "good" : "warn"}
        value={commandLabel}
      />
      <EvidenceRow
        label="Score basis"
        tone={scoreBreakdown.total > 0 ? scoreTone : "warn"}
        value={formatScoreBasis(scoreBreakdown)}
      />
      {!evidencePack && (fallbackFileCount > 0 || fallbackCommandCount > 0) ? (
        <Card className="border-border/70 shadow-none bg-transparent">
          <CardContent className="px-3 py-2 text-[10px] leading-4 text-muted-foreground">
            Local repo signals show {fallbackFileCount} changed file
            {fallbackFileCount === 1 ? "" : "s"} and {fallbackCommandCount} possible
            command signal{fallbackCommandCount === 1 ? "" : "s"}, but no
            Ship Proof has been generated for this run yet.
          </CardContent>
        </Card>
      ) : null}
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
        label="Compliance"
        tone={
          evidencePack?.attestation?.status === "signed"
            ? "good"
            : evidencePack?.attestation
              ? "warn"
              : "muted"
        }
        value={
          evidencePack?.attestation?.status === "signed"
            ? "Attestation ready"
            : (evidencePack?.attestation?.status ?? "Pending")
        }
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
      <Card className="border-border/70 shadow-none bg-transparent">
        <CardContent className="p-2.5">
          <p className="text-[10px] tracking-wider uppercase text-muted-foreground/70">
            Compliance Actions
          </p>
        <button
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--panel-border)]/45 bg-[var(--mate-control-bg)] px-3 py-2 text-[11px] font-medium text-foreground/85 backdrop-blur-md transition hover:bg-accent disabled:opacity-55"
          disabled={!canExportCompliance}
          onClick={() => {
            const taskId = evidencePack?.attestation?.taskId;
            if (taskId)
              void window.mate.repo.generateComplianceReport({ taskId });
          }}
          title="Export SOC 2 / Procurement Package"
          type="button"
        >
          <FileArchiveIcon className="size-3.5" />
          Generate Compliance Report
        </button>
        <button
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--panel-border)]/35 bg-[var(--mate-control-bg)] px-3 py-2 text-[11px] font-medium text-foreground/80 backdrop-blur-md transition hover:bg-accent disabled:opacity-55"
          disabled={!canExportCompliance}
          onClick={() => {
            const taskId = evidencePack?.attestation?.taskId;
            if (taskId)
              void window.mate.repo.generateComplianceReport({ taskId });
          }}
          title="Export Agent Runbook"
          type="button"
        >
          <FileTextIcon className="size-3.5" />
          Export Agent Runbook
        </button>
        </CardContent>
      </Card>
    </section>
  );
}

export function RepoHealthSection({
  hasWorkspace,
  hasProfile,
  workspace,
  signals,
  nextAction,
}: {
  hasWorkspace: boolean;
  hasProfile: boolean;
  workspace?: WorkspaceSummary | null;
  signals: RepoHealthSignal[];
  nextAction?: string;
}) {
  const verdict = getRepoHealthVerdict(signals, hasProfile);
  const action = nextAction ?? (hasWorkspace
    ? hasProfile
      ? "Review weak signals before relying on this repo profile."
      : "Map repo signals to build a live health profile for this workspace."
    : "Open a workspace to begin analysis.");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={ZapIcon} title="Repo Health" />
        <TonePill label={verdict.label} tone={verdict.tone} />
      </div>
      <div
        className={cn(
          "rounded-2xl border border-border/70 px-3 py-2.5 shadow-none",
          toneSurfaceClassName(verdict.tone),
        )}
      >
        <p className="text-[10px] tracking-wider font-medium uppercase text-muted-foreground/70">
          {hasProfile ? "Live repo verdict" : "Metadata only"}
        </p>
        <p className="mt-1 break-words text-[12px] font-semibold leading-5">
          {verdict.detail}
        </p>
      </div>
      {workspace ? (
        <div className="rounded-2xl border border-border/50 bg-transparent px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Workspace
          </p>
          <p className="mt-1 break-words text-[11px] font-semibold text-foreground">
            {workspace.name}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
            {workspace.path}
          </p>
          <p className="mt-1 break-words text-[10px] text-muted-foreground">
            {workspace.branch ? `Branch ${workspace.branch}` : "Branch unknown"}
          </p>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        {signals.map((signal) => (
          <HealthSignalCell signal={signal} key={signal.label} />
        ))}
      </dl>
      <div className="rounded-2xl border border-border/50 bg-transparent px-2.5 py-2 text-[11px] break-words text-muted-foreground">
        {action}
      </div>
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

function EvidenceConfidenceCard({
  commandCount,
  filesCount,
  hasVerifiedScore,
  score,
  scoreBreakdown,
  scoreTone,
  verdict,
}: {
  commandCount: number;
  filesCount: number;
  hasVerifiedScore: boolean;
  score: number | null;
  scoreBreakdown: ScoreBreakdown;
  scoreTone: SignalTone;
  verdict: string;
}) {
  const label = hasVerifiedScore
    ? String(score)
    : verdict === "Pending verified run"
      ? "Pending"
      : "Needs evidence";

  return (
    <Card
      className={cn(
        "rounded-2xl border-border/70 shadow-none",
        toneSurfaceClassName(hasVerifiedScore ? scoreTone : "watch"),
      )}
    >
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Proof Confidence
        </p>
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className={cn(
              hasVerifiedScore ? "text-3xl" : "text-[17px]",
              "break-words font-semibold leading-7",
              toneValueClassName(hasVerifiedScore ? scoreTone : "watch"),
            )}
          >
            {label}
          </span>
          {hasVerifiedScore ? (
            <span className="text-[12px] text-muted-foreground">/100</span>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {getEvidenceScoreReason(
            hasVerifiedScore ? score : null,
            verdict,
            commandCount,
            filesCount,
            scoreBreakdown,
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/70 shadow-none bg-transparent">
      <CardContent className="px-2 py-1.5">
        <dt className="text-muted-foreground/70 tracking-wider text-[10px] uppercase">{label}</dt>
        <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
      </CardContent>
    </Card>
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

  return <TonePill label={risk} tone={tone} />;
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
    <Card
      className={cn(
        "border-border/70 shadow-none text-center backdrop-blur-md",
        tone === "good"
          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
          : "bg-[var(--mate-control-bg)]",
      )}
    >
      <CardContent className="p-2.5">
        <p className="text-[10px] font-medium uppercase text-muted-foreground/70 tracking-wider">
          {label}
        </p>
        <p className="mt-1 break-all font-mono text-[10px] text-foreground" title={value}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function ImpactRow({ entry }: { entry: RepoGraphImpactedFile }) {
  return (
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]" title={entry.reason}>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          d{entry.distance}
        </span>
        <FileTextIcon className="size-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {entry.group ?? entry.file}
        </span>
        {entry.hiddenCount ? (
          <span className="shrink-0 text-muted-foreground">
            +{entry.hiddenCount}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  );
}

function SkeletonStack() {
  return (
    <div className="space-y-2">
      <div className="h-10 animate-pulse rounded-2xl border border-border/70 bg-[var(--mate-control-bg)]" />
      <div className="h-8 w-4/5 animate-pulse rounded-2xl border border-border/70 bg-[var(--mate-control-bg)]" />
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
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
          <CheckCircle2Icon
            className={cn("size-3.5 shrink-0", toneValueClassName(tone))}
          />
          <span className="truncate text-foreground">{value}</span>
        </span>
      </CardContent>
    </Card>
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
    <Card className="border-destructive/35 shadow-none bg-destructive/[0.045]">
      <CardContent className="p-3">
        <p className="text-[10px] tracking-wider font-medium uppercase text-destructive">
          Blocking issue
        </p>
        <p className="mt-1 text-[11px] font-semibold text-foreground">
          {verdict}: evidence run did not complete cleanly.
        </p>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          Captured {commandCount} command signals and {filesCount} file signal
          {filesCount === 1 ? "" : "s"}, but review cannot be trusted until
          file-level diff evidence completes.
        </p>
      </CardContent>
    </Card>
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
  scoreBreakdown: ScoreBreakdown,
) {
  if (/fail|error|blocked/i.test(verdict)) {
    return `Low score because run verdict is ${verdict}. Evidence captured ${commandCount} command signals across ${filesCount} file signal${filesCount === 1 ? "" : "s"}, but result did not complete cleanly.`;
  }
  if (score === null) {
    return verdict === "Pending verified run"
      ? "Score pending until verified task run completes."
      : "Needs verified task signals before MaTE X can score confidence.";
  }
  if (scoreBreakdown.total > 0) {
    return `Score comes from verified task signals: ${formatScoreBasis(scoreBreakdown)}.`;
  }
  if (score < 50) {
    return "Low confidence. Findings may be useful, but claims need stronger file-level verification before shipping.";
  }
  if (score < 75) {
    return "Partial confidence. Review unresolved risks before shipping.";
  }

  return "Evidence is strong enough for a proof-backed summary.";
}

interface ScoreBreakdown {
  satisfied: number;
  total: number;
  passed: number;
  count: number;
}

function getScoreBreakdown(
  signals: VerifiedTaskScoreSignal[],
): ScoreBreakdown {
  return signals.reduce<ScoreBreakdown>(
    (breakdown, signal) => ({
      satisfied: breakdown.satisfied + (signal.satisfied ? signal.weight : 0),
      total: breakdown.total + signal.weight,
      passed: breakdown.passed + (signal.satisfied ? 1 : 0),
      count: breakdown.count + 1,
    }),
    { satisfied: 0, total: 0, passed: 0, count: 0 },
  );
}

function formatScoreBasis(breakdown: ScoreBreakdown) {
  if (breakdown.total <= 0 || breakdown.count <= 0) {
    return "No weighted signals";
  }

  const weightedPercent = Math.round(
    (breakdown.satisfied / breakdown.total) * 100,
  );

  return `${breakdown.satisfied}/${breakdown.total} weight, ${breakdown.passed}/${breakdown.count} signals (${weightedPercent}%)`;
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
    return "Review first";
  }

  return "Proof-backed";
}

function getSecurityRiskTone(
  verdict: string,
  fallbackRisk: string,
): SignalTone {
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

function HealthSignalCell({ signal }: { signal: RepoHealthSignal }) {
  return (
    <Card
      className={cn(
        "min-w-0 border-border/50 shadow-none bg-transparent",
      )}
    >
      <CardContent className="px-2.5 py-2">
        <dt className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="truncate">{signal.label}</span>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              toneDotClassName(signal.tone),
            )}
          />
        </dt>
        <dd className="mt-1 truncate font-medium text-foreground" title={signal.value}>
          {signal.value}
        </dd>
      </CardContent>
    </Card>
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

  return "border-[var(--panel-border)]/35 bg-transparent";
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
