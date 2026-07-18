import { ActivityIcon } from "@phosphor-icons/react";

import type { SignalTone } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { toneTextClassName } from "./enhancement-panel-tone";

export function TonePill({ label, tone }: { label: string; tone: SignalTone }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
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
  icon: typeof ActivityIcon;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-primary" weight="regular" />
      <h3 className="mate-text-compact truncate font-semibold">
        {title}
      </h3>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/70 shadow-none bg-transparent">
      <CardContent className="px-2 py-1.5">
        <dt className="mate-text-metadata">{label}</dt>
        <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
      </CardContent>
    </Card>
  );
}

export function SkeletonStack() {
  return (
    <div className="space-y-2">
      <div className="h-10 animate-pulse rounded-2xl border border-border/70 bg-[var(--mate-control-bg)]" />
      <div className="h-8 w-4/5 animate-pulse rounded-2xl border border-border/70 bg-[var(--mate-control-bg)]" />
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
