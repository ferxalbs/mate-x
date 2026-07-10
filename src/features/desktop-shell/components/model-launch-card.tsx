import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "../../../components/ui/dialog";
import type {
  RainyModelCatalogEntry,
  RainyModelLaunch,
} from "../../../contracts/rainy";
import {
  buildLaunchPresentationCssVars,
  getCallableLaunchVariants,
  getHighContextPricingNotice,
  loadDismissedLaunchIds,
  persistDismissedLaunchId,
  selectUnseenLaunches,
  shouldAnimateLaunchPresentation,
} from "../../../lib/rainy-model-launches";
import {
  getApiKeyStatus,
  listModelLaunches,
  listModels,
  setModel,
} from "../../../services/settings-client";
import { cn } from "../../../lib/utils";

interface ModelLaunchCardProps {
  onModelActivated?: (modelId: string) => void;
}

export interface ModelLaunchCardContentProps {
  launch: RainyModelLaunch;
  catalog: Array<Pick<RainyModelCatalogEntry, "id">>;
  isActivating?: boolean;
  error?: string;
  prefersReducedMotion?: boolean;
  /** Force layout branch for tests: auto uses matchMedia when available. */
  layout?: "auto" | "mobile" | "desktop";
  onDismiss: () => void;
  onTry: (modelId: string) => void;
  /** When false, render as a plain panel (tests) without dialog title hooks. */
  asDialog?: boolean;
  className?: string;
}

export interface ModelLaunchCardViewProps extends ModelLaunchCardContentProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}

function usePrefersReducedMotion(override?: boolean) {
  const [matches, setMatches] = useState(() => {
    if (typeof override === "boolean") {
      return override;
    }
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof override === "boolean") {
      setMatches(override);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [override]);

  return matches;
}

function useIsMobileLayout(layout: "auto" | "mobile" | "desktop") {
  const [isMobile, setIsMobile] = useState(layout === "mobile");

  useEffect(() => {
    if (layout === "mobile") {
      setIsMobile(true);
      return;
    }
    if (layout === "desktop") {
      setIsMobile(false);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) {
      setIsMobile(false);
      return;
    }
    const query = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsMobile(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [layout]);

  return isMobile;
}

/**
 * Presentational launch body. Colors/motion come only from `launch.presentation` or selected variant presentation.
 */
export function ModelLaunchCardContent({
  launch,
  catalog,
  isActivating = false,
  error = "",
  prefersReducedMotion: reducedMotionOverride,
  layout = "auto",
  onDismiss,
  onTry,
  asDialog = true,
  className,
}: ModelLaunchCardContentProps) {
  const [pricingOpen, setPricingOpen] = useState(false);
  const pricingId = useId();
  const reducedMotion = usePrefersReducedMotion(reducedMotionOverride);
  const isMobile = useIsMobileLayout(layout);

  const callableVariants = useMemo(
    () => getCallableLaunchVariants(launch, catalog),
    [catalog, launch],
  );

  const groups = useMemo(() => {
    if (launch.selection.groupBy === "none") {
      return launch.variants.map((v) => ({
        id: v.modelId,
        label: v.label,
        presentation: v.presentation,
        modelId: v.modelId,
      }));
    }
    const map = new Map<string, typeof launch.variants>();
    for (const v of launch.variants) {
      const f = v.family || v.modelId;
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(v);
    }
    return Array.from(map.values()).map((group) => {
      const callableInGroup = group.find((v) =>
        callableVariants.some((cv) => cv.modelId === v.modelId)
      );
      const rep = callableInGroup || group[0];
      return {
        id: rep.family || rep.modelId,
        label: rep.label,
        presentation: rep.presentation,
        modelId: rep.modelId,
      };
    });
  }, [launch, callableVariants]);

  // If one family/model exists: Do not show a model picker, automatically use that model as selected.
  const isSingleGroup = groups.length === 1;

  // Use the first callable group by default, otherwise the first group.
  const defaultGroupId = useMemo(() => {
    const callableGroup = groups.find(g => callableVariants.some(cv => cv.modelId === g.modelId));
    return callableGroup ? callableGroup.id : (groups[0]?.id ?? "");
  }, [groups, callableVariants]);

  const [selectedGroupId, setSelectedGroupId] = useState<string>(defaultGroupId);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || groups[0],
    [groups, selectedGroupId]
  );

  const presentation = selectedGroup?.presentation ?? launch.presentation;
  const animate = shouldAnimateLaunchPresentation(presentation, reducedMotion);
  const pricingDetail = getHighContextPricingNotice({ launch });
  const cssVars = buildLaunchPresentationCssVars(presentation) as CSSProperties;

  const isSelectedCallable = selectedGroup
    ? callableVariants.some((v) => v.modelId === selectedGroup.modelId)
    : false;

  const getVariantState = (modelId: string) => {
    if (callableVariants.some((v) => v.modelId === modelId)) return "callable";
    return "staged";
  };

  const handleGroupKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    groupId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedGroupId(groupId);
    }
  };

  const Title = asDialog ? DialogTitle : "h2";
  const Description = asDialog ? DialogDescription : "p";
  
  const ctaLabel = isSelectedCallable ? launch.selection.availableCtaLabel : launch.selection.stagedCtaLabel;

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-col overflow-hidden outline-none transition-all duration-300",
        "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
        className,
      )}
      style={{
        ...cssVars,
        backgroundColor: "var(--launch-surface)",
        color: "var(--launch-on-surface)",
        transition: "background-color 0.4s ease, color 0.4s ease",
      }}
      data-testid="model-launch-card"
      data-layout={isMobile ? "mobile" : "desktop"}
      data-motion={animate ? "aurora" : "static"}
      data-theme={presentation.themeId}
      role={asDialog ? undefined : "dialog"}
      aria-modal={asDialog ? undefined : true}
      aria-labelledby={asDialog ? undefined : "model-launch-title"}
    >
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-400"
        aria-hidden
        data-testid="model-launch-aurora"
      >
        <div
          className={cn(
            "absolute inset-0 transition-all duration-500",
            animate && "model-launch-aurora-layer",
          )}
          style={{
            backgroundImage: "var(--launch-gradient)",
            backgroundSize: animate ? "200% 200%" : "100% 100%",
            filter: "blur(80px) saturate(1.2)",
            transform: "scale(1.5) translateY(-30%)",
            opacity: 0.6
          }}
        />
        {animate ? (
          <>
            <div
              className="model-launch-aurora-bloom pointer-events-none absolute inset-0 opacity-30 mix-blend-screen transition-colors duration-400"
              style={{
                background: "radial-gradient(circle at 50% 0%, var(--launch-accent) 0%, transparent 50%)",
                filter: "blur(60px)",
              }}
            />
            <div
              className="model-launch-aurora-noise pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")'
              }}
            />
          </>
        ) : null}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, transparent 10%, var(--launch-surface) 100%)",
          }}
        />
      </div>

      <div className="flex flex-col gap-8 px-8 sm:px-10 pb-6 pt-16 relative z-10 items-center text-center">
        <div className="flex flex-col gap-3 items-center text-center">
          <Title
            id={asDialog ? undefined : "model-launch-title"}
            className="text-[1.5rem] font-semibold leading-tight tracking-tight sm:text-[1.75rem] transition-colors duration-400"
            style={{ color: "var(--launch-on-surface)" }}
          >
            {launch.title}
          </Title>
          <Description
            className="text-[0.9375rem] leading-relaxed opacity-90 max-w-[340px] transition-colors duration-400"
            style={{ color: "var(--launch-muted)" }}
          >
            {launch.summary}
          </Description>
        </div>

        {!isSingleGroup && groups.length > 0 ? (
          <div className="flex flex-col w-full items-center">
            <div className="flex flex-wrap justify-center gap-1.5" role="list">
              {groups.map((group) => {
                const state = getVariantState(group.modelId);
                const isSelected = selectedGroupId === group.id;
                
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="listitem"
                    className={cn(
                      "group flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all duration-400",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
                    )}
                    style={{
                      backgroundColor: isSelected
                        ? "color-mix(in srgb, var(--launch-on-surface) 12%, transparent)"
                        : "transparent",
                      color: isSelected ? "var(--launch-on-surface)" : "var(--launch-muted)",
                    }}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedGroupId(group.id)}
                    onKeyDown={(event) => handleGroupKeyDown(event, group.id)}
                  >
                    <span>{group.label}</span>
                    {state === "staged" ? (
                      <span
                        className="opacity-60 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                      >
                        Preparing
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {pricingDetail ? (
          <div className="w-full flex flex-col items-center mt-[-8px]">
            <button
              type="button"
              className={cn(
                "rounded-sm text-[11px] font-medium transition-opacity hover:opacity-90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
              )}
              style={{ color: "var(--launch-muted)", opacity: 0.7 }}
              aria-expanded={pricingOpen}
              aria-controls={pricingId}
              onClick={() => setPricingOpen((value) => !value)}
            >
              {pricingOpen ? "Hide pricing details" : "Show pricing details"}
            </button>
            <div 
              className={cn(
                "grid transition-all duration-300 ease-in-out w-full",
                pricingOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0"
              )}
            >
              <p
                id={pricingId}
                className="text-[11px] leading-relaxed overflow-hidden text-center transition-colors duration-400"
                style={{ color: "var(--launch-muted)" }}
                data-testid="model-launch-pricing-detail"
              >
                {pricingDetail}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-[12px] text-red-400 font-medium text-center" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "flex flex-col-reverse gap-3 px-8 pb-8 sm:flex-row sm:items-center sm:justify-center w-full relative z-10",
          "max-sm:pb-[max(2rem,env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex flex-col-reverse sm:flex-row w-full gap-3 justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-11 w-full rounded-full sm:h-[38px] sm:w-[160px] font-medium transition-colors hover:bg-transparent duration-400",
              "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)]",
            )}
            style={{
              color: "var(--launch-muted)",
            }}
            onClick={onDismiss}
            disabled={isActivating}
          >
            Keep current model
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn(
              "h-11 w-full rounded-full border-0 sm:h-[38px] sm:w-[160px] font-semibold transition-all duration-400",
              "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)] shadow-lg shadow-black/20",
              (!isSelectedCallable || isActivating) && "opacity-50",
            )}
            style={{
              backgroundColor: isSelectedCallable ? "var(--launch-on-surface)" : "color-mix(in srgb, var(--launch-muted) 30%, transparent)",
              color: isSelectedCallable ? "var(--launch-surface)" : "var(--launch-on-surface)",
            }}
            onClick={() => {
              if (selectedGroup) {
                onTry(selectedGroup.modelId);
              }
            }}
            disabled={!isSelectedCallable || isActivating}
            aria-disabled={!isSelectedCallable || isActivating}
            data-testid="model-launch-primary-cta"
          >
            {isActivating ? "Activating…" : ctaLabel}
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes model-launch-aurora-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes model-launch-aurora-bloom {
          0%, 100% { transform: scale(1) translate(0, 0); opacity: 0.3; }
          33% { transform: scale(1.1) translate(3%, -2%); opacity: 0.4; }
          66% { transform: scale(0.95) translate(-2%, 3%); opacity: 0.25; }
        }
        .model-launch-aurora-layer {
          animation: model-launch-aurora-shift var(--launch-aurora-duration, 15s) ease-in-out infinite alternate;
        }
        .model-launch-aurora-bloom {
          animation: model-launch-aurora-bloom calc(var(--launch-aurora-duration, 15s) * 0.8) ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .model-launch-aurora-layer,
          .model-launch-aurora-bloom {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Dialog shell for the launch card (focus trap, Escape, close via Dialog).
 */
export function ModelLaunchCardView({
  open,
  onOpenChange,
  onDismiss,
  layout = "auto",
  ...contentProps
}: ModelLaunchCardViewProps) {
  const isMobile = useIsMobileLayout(layout);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        if (!next) {
          onDismiss();
        }
      }}
    >
      <DialogPopup
        showCloseButton
        className={cn(
          "overflow-hidden border-0 p-0 shadow-2xl transition-all duration-400",
          isMobile
            ? "max-w-none w-full max-sm:rounded-t-[32px] max-sm:rounded-b-none sm:max-w-[420px]"
            : "w-full max-w-[420px] rounded-[32px]",
        )}
      >
        <ModelLaunchCardContent
          {...contentProps}
          layout={layout}
          onDismiss={onDismiss}
          asDialog
        />
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Non-blocking "new model" card driven by GET /api/v1/models/launches.
 */
export function ModelLaunchCard({ onModelActivated }: ModelLaunchCardProps) {
  const [launch, setLaunch] = useState<RainyModelLaunch | null>(null);
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [userKey, setUserKey] = useState("local");
  const [open, setOpen] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadLaunches() {
      try {
        const [apiKeyStatus, launches, nextCatalog] = await Promise.all([
          getApiKeyStatus().catch(() => ({ configured: false as const })),
          listModelLaunches(false).catch(() => [] as RainyModelLaunch[]),
          listModels(false).catch(() => [] as RainyModelCatalogEntry[]),
        ]);

        if (cancelled) {
          return;
        }

        const nextUserKey =
          apiKeyStatus.configured && apiKeyStatus.prefix
            ? apiKeyStatus.prefix
            : "local";
        setUserKey(nextUserKey);
        setCatalog(nextCatalog);

        const dismissed = loadDismissedLaunchIds(nextUserKey);
        const unseen = selectUnseenLaunches(launches, dismissed);
        const next = unseen[0] ?? null;
        setLaunch(next);
        setOpen(Boolean(next));
      } catch {
        // Launch cards are non-critical — never block the app.
      }
    }

    void loadLaunches();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!launch) {
      setOpen(false);
      return;
    }
    persistDismissedLaunchId(userKey, launch.id);
    setOpen(false);
    setLaunch(null);
  }, [launch, userKey]);

  const handleTry = useCallback(async (modelId: string) => {
    if (!launch || !modelId) {
      return;
    }
    
    setIsActivating(true);
    setError("");

    try {
      await setModel(modelId);
      onModelActivated?.(modelId);
      persistDismissedLaunchId(userKey, launch.id);
      setOpen(false);
      setLaunch(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not activate model.",
      );
    } finally {
      setIsActivating(false);
    }
  }, [launch, onModelActivated, userKey]);

  if (!launch) {
    return null;
  }

  return (
    <ModelLaunchCardView
      launch={launch}
      catalog={catalog}
      open={open}
      isActivating={isActivating}
      error={error}
      onDismiss={dismiss}
      onTry={handleTry}
    />
  );
}
