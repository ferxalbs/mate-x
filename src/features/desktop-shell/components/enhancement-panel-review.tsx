
import { Search01Icon } from "@hugeicons/core-free-icons";


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
        <PanelTitle icon={Search01Icon} title="Review Queue" />
        <RiskPill risk={summary.risk} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        <Metric label="Relevant changes" value={changedFiles.length} />
        <Metric label="Risky surfaces" value={state.touchedRiskSurfaces.length} />
        <Metric label="Likely radius" value={summary.affectedCount} />
        <Metric label="Mapped tests" value={impactedFiles.length} />
      </dl>
      <Card className="control-surface rounded-2xl border border-border/70 bg-card text-card-foreground shadow-none">
        <CardContent className="p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Look at first
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-foreground font-medium">
            {firstLook}
          </p>
          <p className="mt-2 break-words text-[11.5px] leading-relaxed text-muted-foreground">
            {changedFiles.length > 0
              ? "Review changed and impacted paths before trusting the result."
              : "No detailed change queue is loaded yet. Map changes to classify the current diff."}
          </p>
        </CardContent>
      </Card>
      {changedFiles.length === 0 ? (
        <button
          className="control-surface flex min-h-8.5 w-full items-center justify-center rounded-xl border border-border/70 bg-card px-3 py-2 text-[12.5px] font-semibold text-foreground transition-all duration-150 hover:bg-card/80 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-55"
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
