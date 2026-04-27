import type { EvidencePack } from "../../../contracts/chat";

export function EvidencePackCard({ evidencePack }: { evidencePack: EvidencePack }) {
  return (
    <section className="rounded-2xl border border-border/65 bg-[var(--surface)]/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md border border-border/60 bg-background/45 px-2 py-1 text-[10px] font-medium text-foreground/90">
          Evidence Pack
        </span>
        <span className="rounded-md border border-border/60 bg-background/45 px-2 py-1 text-[10px] text-muted-foreground">
          Status: {evidencePack.status}
        </span>
        <span className="rounded-md border border-border/60 bg-background/45 px-2 py-1 text-[10px] text-muted-foreground">
          Confidence: {evidencePack.verdict.confidence}
        </span>
      </div>

      <p className="text-[12px] text-foreground/90">
        <span className="font-medium">{evidencePack.verdict.label}:</span> {evidencePack.verdict.summary}
      </p>

      {evidencePack.filesModified && evidencePack.filesModified.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Touched files</p>
          {evidencePack.filesModified.slice(0, 8).map((file) => (
            <div key={`${file.path}-${file.changeType ?? "modified"}`} className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
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
            <div key={`${command.command}-${index}`} className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
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
            <div key={`${test.name}-${index}`} className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <span className="text-foreground/85">{test.name}</span>
              <span className="ml-2 uppercase">{test.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      {evidencePack.reproduction ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-foreground/85">Reproduction</p>
          <div className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
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
            <div key={`${stage.id}-${index}`} className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
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
            <div key={`${check.name}-${index}`} className="rounded-lg border border-border/45 bg-background/35 px-2.5 py-1.5 text-[11px] text-muted-foreground">
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
            <span key={tool.name} className="rounded-md border border-border/60 bg-background/45 px-2 py-1 text-[10px] text-muted-foreground">
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
        <div className="mt-2 rounded-lg border border-border/45 bg-background/35 px-2.5 py-2 text-[11px] text-muted-foreground">
          <p className="mb-1 font-medium text-foreground/85">Open risks</p>
          {evidencePack.unresolvedRisks.slice(0, 4).map((risk, index) => (
            <p key={`${risk}-${index}`}>- {risk}</p>
          ))}
        </div>
      ) : null}

      {evidencePack.recommendation ? (
        <div className="mt-2 rounded-lg border border-border/45 bg-background/35 px-2.5 py-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground/85">Final recommendation</p>
          <p>{evidencePack.recommendation}</p>
        </div>
      ) : null}
    </section>
  );
}
