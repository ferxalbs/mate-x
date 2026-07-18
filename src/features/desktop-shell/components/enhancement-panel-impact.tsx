import { FileTextIcon, PathIcon } from "@phosphor-icons/react";

import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { ImpactSummary } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { EmptyLine, Metric, PanelTitle, RiskPill, SkeletonStack } from "./enhancement-panel-primitives";

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
        <PanelTitle icon={PathIcon} title="Impact Map" />
        <RiskPill risk={summary.risk} />
      </div>
      {isLoading ? <SkeletonStack /> : null}
      <dl className="grid grid-cols-3 gap-2 text-[13px]">
        <Metric label="Changed" value={changedFiles.length} />
        <Metric label="Affected" value={summary.affectedCount} />
        <Metric label="Fan-out" value={summary.toolFanoutCount} />
      </dl>
      <Card className="border-amber-500/20 shadow-none bg-amber-500/[0.04]">
        <CardContent className="p-3">
          <p className="text-[10px] tracking-wider font-medium uppercase text-amber-500">
            {sourceIsArtifact ? "Evidence artifact" : "Source of change"}
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-foreground" title={source}>
            {source}
          </p>
          {sourceIsArtifact ? (
            <p className="mate-text-secondary mt-1">
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
        <CardContent className="mate-text-secondary px-3 py-2">
          Optimization: verify impacted paths first, skip unrelated suites when
          RepoGraph proves isolation.
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Private sub-components ───────────────────────────────────────────────────

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
        "border-border/70 text-center shadow-none",
        tone === "good"
          ? "border-emerald-500/20 bg-emerald-500/[0.04]"
          : "bg-[var(--mate-control-bg)]",
      )}
    >
      <CardContent className="p-2.5">
        <p className="mate-text-metadata">
          {label}
        </p>
        <p className="mt-1 break-all font-mono text-[12px] text-foreground" title={value}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function ImpactRow({ entry }: { entry: RepoGraphImpactedFile }) {
  return (
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]" title={entry.reason}>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          d{entry.distance}
        </span>
        <FileTextIcon className="size-4 shrink-0 text-primary" weight="regular" />
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
