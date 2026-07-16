import { LazyMotion, domMax, m, useReducedMotion } from "framer-motion";
import { ChevronRightIcon, GitBranchIcon } from "lucide-react";

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
  const reducedMotion = useReducedMotion();

  return (
    <LazyMotion features={domMax} strict>
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
                      ? "animate-pulse bg-blue-500"
                      : hasHealth
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/50",
                )}
              />
              <span className="text-[10px] font-medium text-muted-foreground">
                {eventCount} events
              </span>
            </div>
          </div>
          <p className="mt-1 truncate text-[11.5px] leading-relaxed text-muted-foreground/90">
            {activeRunTitle ?? panelState}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <m.button
            aria-label="Hide enhancement panel"
            className="flex size-7 items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-[background-color,border-color,color] duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-[var(--panel-border)]/60 hover:bg-accent/40 hover:text-foreground"
            onClick={onCollapse}
            transition={RESPONSIVE_SPRING}
            type="button"
            whileHover={
              reducedMotion ? undefined : { transform: "scale(1.05)" }
            }
            whileTap={
              reducedMotion ? undefined : { transform: "scale(0.9)" }
            }
          >
            <ChevronRightIcon className="size-4" />
          </m.button>
          <Button
            className="h-7 rounded-full border-transparent bg-transparent px-2.5 text-[11px] font-medium text-muted-foreground shadow-none transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-[var(--panel-border)]/60 hover:bg-accent/40 hover:text-foreground active:scale-95 disabled:opacity-60"
            disabled={isLoading}
            onClick={onScan}
            size="xs"
            variant="outline"
          >
            <GitBranchIcon className="size-3.5" />
            {isLoading ? "Processing" : "Scan"}
          </Button>
        </div>
      </div>
    </LazyMotion>
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
              "relative flex h-7 flex-1 items-center justify-center rounded-full text-[10.5px] font-medium transition-colors duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
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
                className="absolute inset-0 rounded-full border border-[var(--panel-border)]/50 bg-[var(--mate-control-bg)]/20"
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
