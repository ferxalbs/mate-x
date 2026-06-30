import { useState } from "react";

import type { EvidencePack } from "../../../contracts/chat";

type ProofBoardVerdict = "GO" | "NO-GO" | "HUMAN REVIEW";

function getProofBoard(evidencePack: EvidencePack): {
  verdict: ProofBoardVerdict;
  reason: string;
  lanes: Array<{ label: string; value: string; tone: "good" | "warn" | "bad" }>;
} {
  const openStops = (evidencePack.policyStops ?? []).filter((stop) => !/resolved|approved|accepted/i.test(stop.status));
  const validationPassed =
    (evidencePack.testsRun ?? []).some((test) => /pass|success/i.test(test.status)) ||
    (evidencePack.commandsExecuted ?? []).some((command) => command.exitCode === 0 && /test|validate|check/i.test(command.command));
  const proofToolRan = (evidencePack.toolsUsed ?? []).some((tool) =>
    /candidate_revalidator|security_path_trace|attack_surface_scan|evidence_pack/i.test(tool.name),
  );
  const signed = evidencePack.attestation?.status === "signed";
  const patched = (evidencePack.filesModified?.length ?? 0) > 0;
  const unresolvedRisks = evidencePack.unresolvedRisks?.length ?? 0;

  if (!validationPassed || openStops.length > 0 || !signed || unresolvedRisks > 0) {
    return {
      verdict: "NO-GO",
      reason: !validationPassed
        ? "Validation proof missing or failed."
        : openStops.length > 0
          ? "Policy stop still open."
          : !signed
            ? "Signed evidence missing."
            : "Open risk needs owner.",
      lanes: buildProofLanes(openStops.length, validationPassed, proofToolRan, patched, signed, unresolvedRisks),
    };
  }

  if (!proofToolRan || !patched) {
    return {
      verdict: "HUMAN REVIEW",
      reason: !proofToolRan ? "Security proof tool not recorded." : "No patch recorded.",
      lanes: buildProofLanes(openStops.length, validationPassed, proofToolRan, patched, signed, unresolvedRisks),
    };
  }

  return {
    verdict: "GO",
    reason: "Patch, validation, policy, and signed evidence are all present.",
    lanes: buildProofLanes(openStops.length, validationPassed, proofToolRan, patched, signed, unresolvedRisks),
  };
}

function buildProofLanes(
  openStops: number,
  validationPassed: boolean,
  proofToolRan: boolean,
  patched: boolean,
  signed: boolean,
  unresolvedRisks: number,
) {
  return [
    { label: "Blocked", value: openStops === 0 ? "clear" : `${openStops} open`, tone: openStops === 0 ? "good" : "bad" },
    { label: "Proof", value: proofToolRan ? "tool ran" : "missing tool", tone: proofToolRan ? "good" : "warn" },
    { label: "Patch", value: patched ? "recorded" : "missing", tone: patched ? "good" : "warn" },
    { label: "Validation", value: validationPassed ? "passed" : "missing", tone: validationPassed ? "good" : "bad" },
    { label: "Risks", value: unresolvedRisks === 0 ? "none" : `${unresolvedRisks} open`, tone: unresolvedRisks === 0 ? "good" : "bad" },
    { label: "Signed", value: signed ? "yes" : "no", tone: signed ? "good" : "bad" },
  ] as Array<{ label: string; value: string; tone: "good" | "warn" | "bad" }>;
}

function proofToneClassName(tone: "good" | "warn" | "bad") {
  if (tone === "good") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (tone === "bad") return "border-red-300/30 bg-red-400/10 text-red-100";
  return "border-amber-300/30 bg-amber-400/10 text-amber-100";
}

export function EvidencePackCard({ evidencePack }: { evidencePack: EvidencePack }) {
  const [exportState, setExportState] = useState<"idle" | "exporting" | "ready" | "failed">("idle");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const proofBoard = getProofBoard(evidencePack);

  async function generateReport() {
    setContextMenuOpen(false);
    setExportState("exporting");
    try {
      const taskId = evidencePack.attestation?.taskId;
      if (!taskId) throw new Error("Evidence Pack is missing a signed task id.");
      await window.mate.repo.generateComplianceReport({ taskId });
      setExportState("ready");
    } catch {
      setExportState("failed");
    }
  }

  return (
    <section
      className="relative rounded-2xl border border-border/65 bg-[var(--mate-surface-bg)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-xl"
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenuOpen(true);
      }}
    >
      {contextMenuOpen ? (
        <div className="absolute right-3 top-10 z-20 rounded-2xl border border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] p-1.5 backdrop-blur-xl">
          <button
            className="rounded-xl px-3 py-2 text-left text-[11px] text-foreground/85 hover:bg-accent"
            onClick={() => void generateReport()}
            title="Export SOC 2 / Procurement Package"
            type="button"
          >
            Generate Compliance Report
          </button>
        </div>
      ) : null}
      {evidencePack.governanceMode === "unrestricted" ? (
        <div className="mb-2 rounded-2xl border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-[11px] font-medium text-amber-100">
          ⚠ Unrestricted session — governance controls were bypassed
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md border border-border/60 bg-[var(--mate-control-bg)] px-2 py-1 text-[10px] font-medium text-foreground/90 backdrop-blur-md">
          Evidence Pack
        </span>
        <span className="rounded-md border border-border/60 bg-[var(--mate-control-bg)] px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
          Status: {evidencePack.status}
        </span>
        <span className="rounded-md border border-border/60 bg-[var(--mate-control-bg)] px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
          Confidence: {evidencePack.verdict.confidence}
        </span>
        {evidencePack.verifiedTaskScore ? (
          <span className="rounded-md border border-border/60 bg-[var(--mate-control-bg)] px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
            Verified Task Score: {evidencePack.verifiedTaskScore.score}/100 · {evidencePack.verifiedTaskScore.status}
          </span>
        ) : null}
        {evidencePack.attestation ? (
          <span
            className="rounded-2xl border border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] px-2 py-1 text-[10px] text-foreground/85 backdrop-blur-md"
            title="Compliance Attestation Ready"
          >
            Attestation: {evidencePack.attestation.status}
          </span>
        ) : null}
        <button
          className="rounded-full border border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] px-2.5 py-1 text-[10px] text-foreground/85 backdrop-blur-md transition hover:bg-accent disabled:opacity-60"
          disabled={exportState === "exporting"}
          onClick={() => void generateReport()}
          title="Export SOC 2 / Procurement Package"
          type="button"
        >
          {exportState === "exporting"
            ? "Generating..."
            : exportState === "ready"
              ? "Report ready"
              : exportState === "failed"
                ? "Export failed"
                : "Generate Compliance Report"}
        </button>
        <button
          className="rounded-full border border-[var(--panel-border)]/35 bg-[var(--mate-control-bg)] px-2.5 py-1 text-[10px] text-foreground/80 backdrop-blur-md transition hover:bg-accent disabled:opacity-60"
          disabled={exportState === "exporting"}
          onClick={() => void generateReport()}
          title="Export Agent Runbook"
          type="button"
        >
          Export Agent Runbook
        </button>
      </div>

      <p className="text-[12px] text-foreground/90">
        <span className="font-medium">{evidencePack.verdict.label}:</span> {evidencePack.verdict.summary}
      </p>

      <div className="mt-3 rounded-2xl border border-[var(--panel-border)]/40 bg-[var(--mate-control-bg)]/80 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Proof Board</p>
            <p className="mt-1 text-[12px] text-foreground/85">{proofBoard.reason}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${proofToneClassName(proofBoard.verdict === "GO" ? "good" : proofBoard.verdict === "NO-GO" ? "bad" : "warn")}`}>
            {proofBoard.verdict}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {proofBoard.lanes.map((lane) => (
            <div key={lane.label} className={`rounded-2xl border px-2.5 py-2 ${proofToneClassName(lane.tone)}`}>
              <p className="text-[10px] uppercase opacity-75">{lane.label}</p>
              <p className="mt-0.5 text-[11px] font-medium">{lane.value}</p>
            </div>
          ))}
        </div>
      </div>

      {evidencePack.policyStops && evidencePack.policyStops.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Policy stops</p>
          {evidencePack.policyStops.slice(0, 4).map((stop) => (
            <div key={stop.id} className="rounded-2xl border border-amber-300/30 bg-amber-400/8 px-2.5 py-1.5 text-[11px] text-amber-100">
              <span className="text-foreground/85">{stop.title}</span>
              <span className="ml-2 uppercase">{stop.status}</span>
              {stop.command ?? stop.target ? <p className="mt-1 font-mono text-[10px]">{stop.command ?? stop.target}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.verifiedTaskScore ? (
        <div className="mt-2 rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur-md">
          <p className="font-medium text-foreground/85">Missing evidence</p>
          <p className="mt-1">
            {evidencePack.verifiedTaskScore.missingEvidence.length > 0
              ? evidencePack.verifiedTaskScore.missingEvidence.slice(0, 6).join(", ")
              : "None"}
          </p>
        </div>
      ) : null}

      {evidencePack.filesModified && evidencePack.filesModified.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Touched files</p>
          {evidencePack.filesModified.slice(0, 8).map((file) => (
            <div key={`${file.path}-${file.changeType ?? "modified"}`} className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
              <span className="font-mono text-foreground/85">{file.path}</span>
              <span className="ml-2 text-[10px] uppercase">{file.changeType ?? "modified"}</span>
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.commandsExecuted && evidencePack.commandsExecuted.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Commands run</p>
          {evidencePack.commandsExecuted.slice(0, 6).map((command, index) => (
            <div key={`${command.command}-${index}`} className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
              <span className="font-mono text-foreground/85">{command.command}</span>
              {typeof command.exitCode === "number" ? <span className="ml-2">exit {command.exitCode}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.testsRun && evidencePack.testsRun.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Tests</p>
          {evidencePack.testsRun.map((test, index) => (
            <div key={`${test.name}-${index}`} className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
              <span className="text-foreground/85">{test.name}</span>
              <span className="ml-2 uppercase">{test.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.reproduction ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Reproduction</p>
          <div className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
            <span className="text-foreground/85">{evidencePack.reproduction.type.replaceAll("_", " ")}</span>
            <span className="ml-2 uppercase">{evidencePack.reproduction.status}</span>
            {typeof evidencePack.reproduction.existedBeforePatch === "boolean" ? (
              <span className="ml-2">
                {evidencePack.reproduction.existedBeforePatch ? "pre-existing" : "new"}
              </span>
            ) : null}
            {evidencePack.reproduction.prePatchOutcome || evidencePack.reproduction.postPatchOutcome ? (
              <p className="mt-1 text-[10px] text-muted-foreground/90">
                before: {evidencePack.reproduction.prePatchOutcome ?? "unknown"} · after: {evidencePack.reproduction.postPatchOutcome ?? "unknown"}
              </p>
            ) : null}
            {evidencePack.reproduction.location ? (
              <p className="mt-1 font-mono text-[10px] text-foreground/75">{evidencePack.reproduction.location}</p>
            ) : null}
            {evidencePack.reproduction.command ? (
              <p className="mt-1 font-mono text-[10px] text-foreground/75">{evidencePack.reproduction.command}</p>
            ) : null}
            {evidencePack.reproduction.summary ? (
              <p className="mt-1 text-[10px] text-muted-foreground/90">{evidencePack.reproduction.summary}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {evidencePack.stages && evidencePack.stages.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Stages</p>
          {evidencePack.stages.slice(0, 8).map((stage, index) => (
            <div key={`${stage.id}-${index}`} className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
              <span className="text-foreground/85">{stage.name}</span>
              <span className="ml-2 uppercase">{stage.status}</span>
              {stage.summary ? <p className="mt-1 text-[10px] text-muted-foreground/90">{stage.summary}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.checks && evidencePack.checks.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Checks</p>
          {evidencePack.checks.slice(0, 10).map((check, index) => (
            <div key={`${check.name}-${index}`} className="rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md">
              <span className="text-foreground/85">{check.name}</span>
              <span className="ml-2 uppercase">{check.status}</span>
              {check.summary ? <p className="mt-1 text-[10px] text-muted-foreground/90">{check.summary}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.stopConditionTriggered ? (
        <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/8 px-2.5 py-2 text-[11px] text-amber-100">
          <p className="mb-1 font-medium">Stop condition triggered</p>
          <p>{evidencePack.stopConditionTriggered}</p>
        </div>
      ) : null}

      {evidencePack.toolsUsed && evidencePack.toolsUsed.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evidencePack.toolsUsed.map((tool) => (
            <span key={tool.name} className="rounded-md border border-border/60 bg-[var(--mate-control-bg)] px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
              {tool.name}
              {typeof tool.count === "number" ? ` (${tool.count})` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {evidencePack.warnings && evidencePack.warnings.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/8 px-2.5 py-2 text-[11px] text-amber-100">
          {evidencePack.warnings.slice(0, 4).map((warning, index) => (
            <p key={`${warning}-${index}`}>{warning}</p>
          ))}
        </div>
      ) : null}

      {evidencePack.unresolvedRisks && evidencePack.unresolvedRisks.length > 0 ? (
        <div className="mt-2 rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur-md">
          <p className="mb-1 font-medium text-foreground/85">Open risks</p>
          {evidencePack.unresolvedRisks.slice(0, 4).map((risk, index) => (
            <p key={`${risk}-${index}`}>- {risk}</p>
          ))}
        </div>
      ) : null}

      {evidencePack.recommendation ? (
        <div className="mt-2 rounded-lg border border-border/45 bg-[var(--mate-control-bg)] px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur-md">
          <p className="font-medium text-foreground/85">Final recommendation</p>
          <p>{evidencePack.recommendation}</p>
        </div>
      ) : null}
    </section>
  );
}
