
import { Activity01Icon } from "@hugeicons/core-free-icons";


import type { RepoHealthSignal } from "./enhancement-panel-utils";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { PanelTitle, TonePill } from "./enhancement-panel-primitives";
import { toneDotClassName, toneSurfaceClassName } from "./enhancement-panel-tone";
import { getRepoHealthVerdict } from "./enhancement-panel-utils";

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
        <PanelTitle icon={Activity01Icon} title="Repo Health" />
        <TonePill label={verdict.label} tone={verdict.tone} />
      </div>
      <div
        className={cn(
          "control-surface rounded-2xl border border-border/70 px-3.5 py-3 shadow-none bg-card text-card-foreground",
          toneSurfaceClassName(verdict.tone),
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {hasProfile ? "Live repo verdict" : "Metadata only"}
        </p>
        <p className="mt-1 break-words text-[12.5px] font-semibold leading-5 text-foreground">
          {verdict.detail}
        </p>
      </div>
      {workspace ? (
        <div className="control-surface rounded-2xl border border-border/70 bg-card text-card-foreground px-3.5 py-3 shadow-none">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
          <p className="mt-1 break-words text-[13px] font-semibold text-foreground">
            {workspace.name}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            {workspace.path}
          </p>
          <p className="mt-1 break-words text-[11.5px] text-muted-foreground">
            {workspace.branch ? `Branch ${workspace.branch}` : "Branch unknown"}
          </p>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        {signals.map((signal) => (
          <HealthSignalCell signal={signal} key={signal.label} />
        ))}
      </dl>
      <div className="control-surface break-words rounded-2xl border border-border/70 bg-card text-card-foreground px-3.5 py-2.5 text-[12px] text-muted-foreground">
        {action}
      </div>
    </section>
  );
}

// ─── Private sub-components ───────────────────────────────────────────────────

function HealthSignalCell({ signal }: { signal: RepoHealthSignal }) {
  return (
    <Card
      className={cn(
        "control-surface min-w-0 rounded-xl border border-border/70 bg-card text-card-foreground shadow-none hover:border-border transition-all duration-150",
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
