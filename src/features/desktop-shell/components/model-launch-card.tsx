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
  LaunchVariant,
  RainyModelCatalogEntry,
  RainyModelLaunch,
} from "../../../contracts/rainy";
import {
  buildLaunchPresentationCssVars,
  getHighContextPricingNotice,
  loadDismissedLaunchIds,
  persistDismissedLaunchId,
  selectUnseenLaunches,
  shouldAnimateLaunchPresentation,
  loadLaunchViewCounts,
  incrementLaunchViewCount,
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
 * Presentational launch body.
 *
 * All selector layout, CTA labels, availability, model IDs, and theme colors
 * come exclusively from `launch.ui` — the server resolves every decision.
 * No local catalog cross-checking, no hardcoded model names or color values.
 */
export function ModelLaunchCardContent({
  launch,
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

  const { ui } = launch;

  // Selected variant ID — initialized from API, never guessed locally.
  const [selectedId, setSelectedId] = useState<string>(ui.initial_model_id);

  const selectedVariant: LaunchVariant | undefined = useMemo(
    () => ui.variants.find((v) => v.id === selectedId) ?? ui.variants[0],
    [ui.variants, selectedId],
  );

  // Theme driven entirely by selected variant presentation.
  const presentation = selectedVariant?.presentation ?? launch.presentation;
  const animate = shouldAnimateLaunchPresentation(presentation, reducedMotion);
  const pricingDetail = getHighContextPricingNotice({ launch });
  const cssVars = buildLaunchPresentationCssVars(presentation) as CSSProperties;

  // CTA driven by selected variant; fall back to launch-level default.
  const primaryAction = selectedVariant?.primary_action ?? ui.primary_action;
  const ctaDisabled = primaryAction.kind === "disabled" || isActivating;

  const handleVariantKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    variantId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(variantId);
    }
  };

  const handleCtaClick = () => {
    if (primaryAction.kind === "start_chat" && primaryAction.model_id) {
      onTry(primaryAction.model_id);
    }
  };

  const Title = asDialog ? DialogTitle : "h2";
  const Description = asDialog ? DialogDescription : "p";

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-col overflow-hidden outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
        className,
      )}
      style={{
        ...cssVars,
        backgroundColor: "var(--launch-surface)",
        color: "var(--launch-on-surface)",
        transition:
          "background-color 200ms cubic-bezier(0.23, 1, 0.32, 1), color 200ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
      data-testid="model-launch-card"
      data-layout={isMobile ? "mobile" : "desktop"}
      data-motion={animate ? "aurora" : "static"}
      data-theme={presentation.themeId}
      role={asDialog ? undefined : "dialog"}
      aria-modal={asDialog ? undefined : true}
      aria-labelledby={asDialog ? undefined : "model-launch-title"}
    >
      {/* Aurora background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
        aria-hidden
        data-testid="model-launch-aurora"
      >
        <div
          className={cn(
            "absolute inset-0",
            animate && "model-launch-aurora-layer",
          )}
          style={{
            backgroundImage: "var(--launch-gradient)",
            backgroundSize: animate ? "200% 200%" : "100% 100%",
            // Keep decorative blur under the layout-cost threshold; scale already softens edges.
            filter: "blur(24px) saturate(1.2)",
            transform: "scale(1.5) translateY(-30%)",
            opacity: 0.6,
          }}
        />
        {animate ? (
          <>
            <div
              className="model-launch-aurora-bloom pointer-events-none absolute inset-0 opacity-30 mix-blend-screen transition-colors duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{
                background: "radial-gradient(circle at 50% 0%, var(--launch-accent) 0%, transparent 50%)",
                filter: "blur(20px)",
              }}
            />
            <div
              className="model-launch-aurora-noise pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")',
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
            className="text-[1.5rem] font-semibold leading-tight tracking-tight sm:text-[1.75rem] transition-colors duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ color: "var(--launch-on-surface)" }}
          >
            {launch.title}
          </Title>
          <Description
            className="text-[0.9375rem] leading-relaxed opacity-90 max-w-[340px] transition-colors duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ color: "var(--launch-muted)" }}
          >
            {launch.summary}
          </Description>
        </div>

        {/* Variant selector — rendered per api ui.selector value */}
        {ui.selector === "multiple" && ui.variants.length > 0 ? (
          <div className="flex flex-col w-full items-center">
            <div
              className="flex flex-wrap justify-center gap-1.5"
              role="radiogroup"
              aria-label="Model variants"
            >
              {ui.variants.map((variant) => {
                const isSelected = selectedId === variant.id;
                const isClickable = variant.selectable;
                const isUnavailable = variant.availability !== "callable";

                return (
                  <button
                    key={variant.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!isClickable}
                    className={cn(
                      "group flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-[background-color,color,opacity,transform] duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
                      !isClickable && "opacity-50 cursor-not-allowed",
                    )}
                    style={{
                      backgroundColor: isSelected
                        ? "color-mix(in srgb, var(--launch-on-surface) 12%, transparent)"
                        : "transparent",
                      color: isSelected ? "var(--launch-on-surface)" : "var(--launch-muted)",
                    }}
                    onClick={() => isClickable && setSelectedId(variant.id)}
                    onKeyDown={(event) => handleVariantKeyDown(event, variant.id)}
                    onFocus={() => isClickable && setSelectedId(variant.id)}
                    data-availability={variant.availability}
                    data-selectable={variant.selectable}
                  >
                    <span>{variant.label}</span>
                    {isUnavailable && isSelected ? (
                      <span className="opacity-60 text-[10px] font-semibold uppercase tracking-wider transition-colors">
                        {variant.primary_action.label}
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
                "grid w-full overflow-hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                pricingOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0",
              )}
            >
              <p
                id={pricingId}
                className="text-[11px] leading-relaxed overflow-hidden text-center transition-colors duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
              "h-11 w-full rounded-full sm:h-[38px] sm:w-[160px] font-medium transition-colors duration-160 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-transparent",
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
              "h-11 w-full rounded-full border-0 sm:h-[38px] sm:w-[160px] font-semibold transition-[background-color,color,opacity,transform] duration-160 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)] shadow-lg shadow-black/20",
              ctaDisabled && "opacity-50",
            )}
            style={{
              backgroundColor: ctaDisabled
                ? "color-mix(in srgb, var(--launch-muted) 30%, transparent)"
                : "var(--launch-on-surface)",
              color: ctaDisabled ? "var(--launch-on-surface)" : "var(--launch-surface)",
            }}
            onClick={handleCtaClick}
            disabled={ctaDisabled}
            aria-disabled={ctaDisabled}
            data-testid="model-launch-primary-cta"
            data-cta-kind={primaryAction.kind}
          >
            {isActivating ? "Activating…" : primaryAction.label}
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
          "overflow-hidden border-0 p-0 shadow-2xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
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
 * The API response fully controls selector layout, CTA, model IDs, and colors.
 * No local catalog availability check.
 */
export function ModelLaunchCard({ onModelActivated }: ModelLaunchCardProps) {
  const [launch, setLaunch] = useState<RainyModelLaunch | null>(null);
  const [userKey, setUserKey] = useState("local");
  const [open, setOpen] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadLaunches() {
      try {
        const [apiKeyStatus, launches, catalog] = await Promise.all([
          getApiKeyStatus().catch(() => ({ configured: false as const })),
          listModelLaunches(false).catch(() => [] as RainyModelLaunch[]),
          // Catalog is still fetched for selectUnseenLaunches view-count gating,
          // not for UI availability decisions.
          listModels(false).catch((): RainyModelCatalogEntry[] => []),
        ]);

        if (cancelled) {
          return;
        }

        const nextUserKey =
          apiKeyStatus.configured && apiKeyStatus.prefix
            ? apiKeyStatus.prefix
            : "local";
        setUserKey(nextUserKey);

        const dismissed = loadDismissedLaunchIds(nextUserKey);
        const views = loadLaunchViewCounts(nextUserKey);
        const unseen = selectUnseenLaunches(launches, dismissed, views, catalog);
        const next = unseen[0] ?? null;
        setLaunch(next);
        setOpen(Boolean(next));
        if (next) {
          incrementLaunchViewCount(nextUserKey, next.id);
        }
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
      open={open}
      isActivating={isActivating}
      error={error}
      onDismiss={dismiss}
      onTry={handleTry}
    />
  );
}
