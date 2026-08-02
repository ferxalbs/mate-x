import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { LazyMotion, domMax, m, useReducedMotion } from "framer-motion";


import { Button } from "../../../components/ui/button";
import { RESPONSIVE_SPRING } from "../../../lib/motion";
import { cn } from "../../../lib/utils";
import type { EnhancementView } from "./enhancement-panel-sections";

export interface EnhancementPanelTab {
  id: EnhancementView;
  label: string;
}

export function PanelHeader({
  activeRunTitle,
  eventCount,
  hasHealth,
  isLoading,
  isRunning,
  onCollapse,
  onScan,
  panelState,
  runFailed,
  hasError,
}: {
  activeRunTitle: string | null;
  eventCount: number;
  hasHealth: boolean;
  isLoading: boolean;
  isRunning: boolean;
  onCollapse: () => void;
  onScan: () => void;
  panelState: string;
  runFailed: boolean;
  hasError: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            Live
          </h2>
          <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-mate-control-bg px-2.5 py-0.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                hasError || runFailed
                  ? "bg-destructive"
                  : isLoading || isRunning
                    ? "animate-pulse bg-blue-500 motion-reduce:animate-none"
                    : hasHealth
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/50",
              )}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {eventCount} events
            </span>
          </div>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {activeRunTitle ?? panelState}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          className="h-7.5 rounded-full border border-border/40 bg-mate-control-bg px-3 text-[11.5px] font-medium text-foreground shadow-none hover:border-foreground/25 hover:bg-foreground/[0.08] transition-all duration-150 active:scale-[0.97]"
          disabled={isLoading}
          onClick={onScan}
          size="xs"
          variant="outline"
        >
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5 text-primary" />
          {isLoading ? "Processing" : "Scan"}
        </Button>
        <button
          aria-label="Hide enhancement panel"
          className="flex size-7.5 items-center justify-center rounded-full border border-border/40 bg-mate-control-bg text-muted-foreground hover:text-foreground hover:border-foreground/25 hover:bg-foreground/[0.08] transition-all duration-150 active:scale-[0.97]"
          onClick={onCollapse}
          type="button"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} className="size-3.5 rotate-180" />
        </button>
      </div>
    </div>
  );
}

export function PanelTabs({
  activeView,
  onChange,
  tabs,
}: {
  activeView: EnhancementView;
  onChange: (view: EnhancementView) => void;
  tabs: EnhancementPanelTab[];
}) {
  const reducedMotion = useReducedMotion();

  return (
    <LazyMotion features={domMax} strict>
      <div className="mt-3 flex items-center justify-between gap-1 rounded-2xl border border-border/40 bg-mate-control-bg p-1 shadow-none">
        {tabs.map((view) => (
          <m.button
            className={cn(
              "relative flex h-7.5 flex-1 items-center justify-center rounded-xl text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              activeView === view.id
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground font-medium",
            )}
            key={view.id}
            onClick={() => onChange(view.id)}
            type="button"
            whileHover={
              reducedMotion ? undefined : { scale: 1.02 }
            }
            whileTap={
              reducedMotion ? undefined : { scale: 0.97 }
            }
          >
            {activeView === view.id && (
              <m.div
                className="absolute inset-0 rounded-xl border border-border/50 bg-foreground/[0.08] text-foreground shadow-xs"
                layoutId="activeTabEnhancement"
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : RESPONSIVE_SPRING
                }
              />
            )}
            <span className="relative z-10">{view.label}</span>
          </m.button>
        ))}
      </div>
    </LazyMotion>
  );
}
