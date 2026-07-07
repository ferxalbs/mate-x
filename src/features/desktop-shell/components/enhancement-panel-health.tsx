import { ZapIcon } from "lucide-react";

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

// ─── Private sub-components ───────────────────────────────────────────────────

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

