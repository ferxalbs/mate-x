
import { TerminalIcon } from "@hugeicons/core-free-icons";


import type { EvidencePack } from "../../../contracts/chat";
import { Card, CardContent } from "../../../components/ui/card";
import { Metric, PanelTitle, SkeletonStack } from "./enhancement-panel-primitives";

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
      <Card className="border-border/70 bg-transparent font-mono text-[12px] shadow-none">
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
      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <Metric label="Mapped tests" value={tests.length} />
        <Metric label="Commands" value={visibleCommands.length} />
      </div>
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCommandLabel(command: string) {
  const name = command.trim().split(/\s+/, 1)[0] ?? command;
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
