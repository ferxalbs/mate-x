import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
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
          <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-accent/30 px-2 py-0.5">
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
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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
          className="h-7.5 rounded-xl border-border/50 bg-panel px-2.5 text-[11.5px] font-medium text-muted-foreground shadow-none hover:text-foreground active:scale-[0.97]"
          disabled={isLoading}
          onClick={onScan}
          size="xs"
          variant="outline"
        >
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
          {isLoading ? "Processing" : "Scan"}
        </Button>
        <button
          aria-label="Hide enhancement panel"
          className="flex size-7.5 items-center justify-center rounded-xl border border-border/50 bg-panel text-muted-foreground hover:text-foreground active:scale-[0.97]"
          onClick={onCollapse}
          type="button"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
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
      <div className="mt-3 flex items-center justify-between gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-0.5">
        {tabs.map((view) => (
          <m.button
            className={cn(
              "relative flex h-7 flex-1 items-center justify-center rounded-lg text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              activeView === view.id
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={view.id}
            onClick={() => onChange(view.id)}
            transition={RESPONSIVE_SPRING}
            type="button"
            whileHover={
              reducedMotion ? undefined : { transform: "scale(1.01)" }
            }
            whileTap={
              reducedMotion ? undefined : { transform: "scale(0.97)" }
            }
          >
            {activeView === view.id && (
              <m.div
                className="absolute inset-0 rounded-lg border border-border/60 bg-panel shadow-sm"
                layoutId="activeTabEnhancement"
                transition={
                  reducedMotion ? { duration: 0 } : RESPONSIVE_SPRING
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
