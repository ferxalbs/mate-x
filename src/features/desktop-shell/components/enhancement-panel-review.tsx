import { FileSearchIcon } from "lucide-react";

import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { ImpactSummary, TrustGateState } from "./enhancement-panel-utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Metric, PanelTitle, RiskPill } from "./enhancement-panel-primitives";

interface BaseSectionProps {
  changedFiles: string[];
  impactedFiles: RepoGraphImpactedFile[];
  isLoading?: boolean;
  summary: ImpactSummary;
}

export function ReviewQueueSection({
  changedFiles,
  impactedFiles,
  onMapChanges,
  state,
  summary,
}: BaseSectionProps & {
  onMapChanges?: () => void;
  state: TrustGateState;
}) {
  const firstLook =
    state.touchedRiskSurfaces[0] ??
    impactedFiles.find((entry) => !entry.group)?.file ??
    changedFiles[0] ??
    "Map changes to build a review queue";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle icon={FileSearchIcon} title="Review Queue" />
        <RiskPill risk={summary.risk} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label="Relevant changes" value={changedFiles.length} />
        <Metric label="Risky surfaces" value={state.touchedRiskSurfaces.length} />
        <Metric label="Likely radius" value={summary.affectedCount} />
        <Metric label="Mapped tests" value={impactedFiles.length} />
      </dl>
      <Card className="border-border/70 bg-transparent shadow-none">
        <CardContent className="p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Look at first
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-foreground">
            {firstLook}
          </p>
          <p className="mt-2 break-words text-[10px] leading-4 text-muted-foreground">
            {changedFiles.length > 0
              ? "Review changed and impacted paths before trusting the result."
              : "No detailed change queue is loaded yet. Map changes to classify the current diff."}
          </p>
        </CardContent>
      </Card>
      {changedFiles.length === 0 ? (
        <button
          className="flex w-full items-center justify-center rounded-full border border-[var(--panel-border)]/45 bg-[var(--mate-control-bg)] px-3 py-2 text-[11px] font-medium text-foreground/85 transition hover:bg-accent disabled:opacity-55"
          disabled={!onMapChanges}
          onClick={onMapChanges}
          type="button"
        >
          Map changes
        </button>
      ) : null}
    </section>
  );
}
