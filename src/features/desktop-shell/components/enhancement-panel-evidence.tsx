import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon, File01Icon, Task01Icon } from "@hugeicons/core-free-icons";


import type { EvidencePack, VerifiedTaskScoreSignal } from "../../../contracts/chat";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { ImpactSummary, SignalTone } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { PanelTitle, SkeletonStack } from "./enhancement-panel-primitives";
import {
  cleanVerdictLabel,
  getSecurityRiskTone,
  impactTone,
  toneSurfaceClassName,
  toneValueClassName,
} from "./enhancement-panel-tone";

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
      <PanelTitle icon={Task01Icon} title="Ship Proof" />
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
          <CardContent className="mate-text-secondary px-3 py-2">
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
          <p className="mate-text-metadata">
            Compliance Actions
          </p>
          <button
            className="mt-2 flex min-h-8 w-full items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)]/45 bg-[var(--mate-control-bg)] px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-55"
            disabled={!canExportCompliance}
            onClick={() => {
              const taskId = evidencePack?.attestation?.taskId;
              if (taskId)
                void window.mate.repo.generateComplianceReport({ taskId });
            }}
            title="Export SOC 2 / Procurement Package"
            type="button"
          >
            <HugeiconsIcon icon={File01Icon} className="size-4" />
            Generate Compliance Report
          </button>
          <button
            className="mt-2 flex min-h-8 w-full items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)]/35 bg-[var(--mate-control-bg)] px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-55"
            disabled={!canExportCompliance}
            onClick={() => {
              const taskId = evidencePack?.attestation?.taskId;
              if (taskId)
                void window.mate.repo.generateComplianceReport({ taskId });
            }}
            title="Export Agent Runbook"
            type="button"
          >
            <HugeiconsIcon icon={File01Icon} className="size-4" />
            Export Agent Runbook
          </button>
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Private sub-components ───────────────────────────────────────────────────

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
        <p className="mate-text-metadata">
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
        <p className="mate-text-secondary mt-2">
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
        <p className="mt-1 text-[13px] font-semibold text-foreground">
          {verdict}: evidence run did not complete cleanly.
        </p>
        <p className="mate-text-secondary mt-1">
          Captured {commandCount} command signals and {filesCount} file signal
          {filesCount === 1 ? "" : "s"}, but review cannot be trusted until
          file-level diff evidence completes.
        </p>
      </CardContent>
    </Card>
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
      <CardContent className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
          <HugeiconsIcon icon={CheckmarkCircle01Icon}
            className={cn("size-3.5 shrink-0", toneValueClassName(tone))}
          />
          <span className="truncate text-foreground">{value}</span>
        </span>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  satisfied: number;
  total: number;
  passed: number;
  count: number;
}

function getScoreBreakdown(signals: VerifiedTaskScoreSignal[]): ScoreBreakdown {
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

function getConfidenceLabel(score: number | null, verdict: string) {
  if (/fail|error|blocked/i.test(verdict)) {
    return "Failed";
  }
  if (score === null) {
    return "Pending";
  }
  if (score < 50) {
    return "Low risk";
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
