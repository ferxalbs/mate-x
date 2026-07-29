import { HugeiconsIcon } from "@hugeicons/react";
import { Activity01Icon } from "@hugeicons/core-free-icons";


import type { SignalTone } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { toneTextClassName } from "./enhancement-panel-tone";

export function TonePill({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border border-border/40 bg-foreground/[0.03] px-2.5 py-0.5 text-[10.5px] font-medium tracking-tight",
        toneTextClassName(tone),
      )}
    >
      {label}
    </span>
  );
}

export function RiskPill({ risk }: { risk: string }) {
  const tone =
    risk === "High"
      ? "bad"
      : risk === "Medium"
        ? "warn"
        : risk === "Low risk"
          ? "good"
          : ("muted" as SignalTone);

  return <TonePill label={risk} tone={tone} />;
}

export function PanelTitle({
  icon: Icon,
  title,
}: {
  icon: typeof Activity01Icon;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HugeiconsIcon icon={Icon} className="size-3.5 shrink-0 text-primary" />
      <h3 className="truncate text-[12.5px] font-semibold text-foreground">
        {title}
      </h3>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-mate-control-bg px-3 py-2 text-card-foreground shadow-none">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function SkeletonStack() {
  return (
    <div className="space-y-1.5 py-1">
      <div className="h-4 w-full animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
      <div className="h-3.5 w-3/4 animate-pulse rounded-md bg-muted/30 motion-reduce:animate-none" />
    </div>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return (
    <Card className="border-border/50 shadow-none bg-transparent">
      <CardContent className="mate-text-secondary px-2.5 py-1.5">
        {text}
      </CardContent>
    </Card>
  );
}
