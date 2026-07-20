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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground/95">
              Live
            </h2>
            <div className="flex items-center gap-1.5 rounded-full bg-accent/60 px-2 py-0.5">
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
              <span className="mate-text-metadata normal-case tracking-normal">
                {eventCount} events
              </span>
            </div>
          </div>
          <p className="mt-1 truncate text-[11.5px] leading-relaxed text-muted-foreground/90">
            {activeRunTitle ?? panelState}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Hide enhancement panel"
            className="flex size-8 items-center justify-center rounded-xl border border-transparent bg-transparent text-muted-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:border-[var(--panel-border)]/60 hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] motion-reduce:transform-none"
            onClick={onCollapse}
            type="button"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </button>
          <Button
            className="h-8 rounded-xl border-transparent bg-transparent px-2.5 text-[12px] font-medium text-muted-foreground shadow-none transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:border-[var(--panel-border)]/60 hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] disabled:opacity-60 motion-reduce:transform-none"
            disabled={isLoading}
            onClick={onScan}
            size="xs"
            variant="outline"
          >
            <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
            {isLoading ? "Processing" : "Scan"}
          </Button>
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
      <div className="mt-4 flex items-center justify-between gap-1 px-1">
        {tabs.map((view) => (
          <m.button
            className={cn(
              "relative flex h-8 flex-1 items-center justify-center rounded-xl text-[12px] font-medium transition-colors duration-[var(--motion-press)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
              activeView === view.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={view.id}
            onClick={() => onChange(view.id)}
            transition={RESPONSIVE_SPRING}
            type="button"
            whileHover={
              reducedMotion ? undefined : { transform: "scale(1.02)" }
            }
            whileTap={
              reducedMotion ? undefined : { transform: "scale(0.95)" }
            }
          >
            {activeView === view.id && (
              <m.div
                className="absolute inset-0 rounded-xl border border-panel-border/50 bg-mate-control-bg/20"
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
