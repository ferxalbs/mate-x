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
  canTryLaunchModel,
  getCallableLaunchVariants,
  getHighContextPricingNotice,
  getLaunchFamilyNames,
  getLaunchPrimaryCtaLabel,
  LAUNCH_STAGED_AVAILABILITY_MESSAGE,
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
  onTry: () => void;
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
 * Presentational launch body. Colors/motion come only from `launch.presentation`.
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
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const pricingId = useId();
  const reducedMotion = usePrefersReducedMotion(reducedMotionOverride);
  const isMobile = useIsMobileLayout(layout);

  const callableVariants = useMemo(
    () => getCallableLaunchVariants(launch, catalog),
    [catalog, launch],
  );
  const canTry = canTryLaunchModel(launch, catalog);
  const families = useMemo(
    () => getLaunchFamilyNames(launch.variants),
    [launch.variants],
  );
  const animate = shouldAnimateLaunchPresentation(
    launch.presentation,
    reducedMotion,
  );
  const pricingDetail = getHighContextPricingNotice({ launch });
  const primaryLabel = getLaunchPrimaryCtaLabel(canTry, isActivating);
  const presentation = launch.presentation;
  const cssVars = buildLaunchPresentationCssVars(presentation) as CSSProperties;
  const stagedRelease =
    launch.status === "staged" ||
    launch.appControls.some((control) => control.availability === "staged") ||
    !canTry;

  const familyAvailability = useCallback(
    (family: string) => {
      const members = launch.variants.filter(
        (variant) =>
          variant.label.replace(/\s+pro$/i, "").trim().toLowerCase() ===
          family.toLowerCase(),
      );
      const anyCallable = members.some((member) =>
        callableVariants.some((entry) => entry.modelId === member.modelId),
      );
      return {
        members,
        anyCallable,
        label: anyCallable ? "Available to try" : "Preparing",
      };
    },
    [callableVariants, launch.variants],
  );

  const handleFamilyKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    family: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setExpandedFamily((current) => (current === family ? null : family));
    }
  };

  const Title = asDialog ? DialogTitle : "h2";
  const Description = asDialog ? DialogDescription : "p";

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
        isMobile ? "max-w-none" : "max-w-[480px]",
        className,
      )}
      style={{
        ...cssVars,
        backgroundColor: "var(--launch-surface)",
        color: "var(--launch-on-surface)",
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
        className={cn(
          "relative w-full overflow-hidden",
          "h-[clamp(7.5rem,22vh,11rem)] sm:h-[clamp(8rem,18vh,10.5rem)]",
        )}
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
          }}
        />
        {animate ? (
          <div
            className="model-launch-aurora-shimmer pointer-events-none absolute inset-0 opacity-50"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 30% 20%, color-mix(in srgb, var(--launch-on-surface) 35%, transparent), transparent 60%)",
            }}
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{
            background:
              "linear-gradient(to top, var(--launch-surface), transparent)",
          }}
        />
      </div>

      <div className="flex flex-col gap-4 px-5 pb-2 pt-1 sm:px-6">
        <div className="flex flex-col gap-2 pr-8">
          <Title
            id={asDialog ? undefined : "model-launch-title"}
            className="text-left text-[1.25rem] font-semibold leading-snug tracking-tight sm:text-xl"
            style={{ color: "var(--launch-on-surface)" }}
          >
            {launch.title}
          </Title>
          <Description
            className="text-left text-[0.9375rem] leading-relaxed"
            style={{ color: "var(--launch-muted)" }}
          >
            {launch.summary}
          </Description>
        </div>

        {families.length > 0 ? (
          <div>
            <p
              className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "var(--launch-muted)" }}
            >
              Models
            </p>
            <div className="flex flex-wrap gap-2" role="list">
              {families.map((family) => {
                const detail = familyAvailability(family);
                const expanded = expandedFamily === family;
                return (
                  <button
                    key={family}
                    type="button"
                    role="listitem"
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
                    )}
                    style={{
                      borderColor: expanded
                        ? "var(--launch-accent)"
                        : "color-mix(in srgb, var(--launch-muted) 35%, transparent)",
                      backgroundColor: expanded
                        ? "color-mix(in srgb, var(--launch-accent) 18%, transparent)"
                        : "color-mix(in srgb, var(--launch-on-surface) 6%, transparent)",
                      color: "var(--launch-on-surface)",
                    }}
                    aria-expanded={expanded}
                    aria-label={`${family}${expanded ? `, ${detail.label}` : ""}`}
                    onClick={() =>
                      setExpandedFamily((current) =>
                        current === family ? null : family,
                      )
                    }
                    onKeyDown={(event) => handleFamilyKeyDown(event, family)}
                  >
                    <span>{family}</span>
                    {expanded ? (
                      <span
                        className="ml-1.5 text-[10px] font-normal opacity-80"
                        style={{ color: "var(--launch-muted)" }}
                      >
                        · {detail.label}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {stagedRelease ? (
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: "var(--launch-muted)" }}
            data-testid="model-launch-availability"
          >
            {LAUNCH_STAGED_AVAILABILITY_MESSAGE}
          </p>
        ) : null}

        {pricingDetail ? (
          <div>
            <button
              type="button"
              className={cn(
                "rounded-sm text-[12px] font-medium underline-offset-4 transition-opacity hover:opacity-90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--launch-surface)]",
              )}
              style={{ color: "var(--launch-muted)" }}
              aria-expanded={pricingOpen}
              aria-controls={pricingId}
              onClick={() => setPricingOpen((value) => !value)}
            >
              Pricing details
            </button>
            {pricingOpen ? (
              <p
                id={pricingId}
                className="mt-2 text-[12px] leading-relaxed"
                style={{ color: "var(--launch-muted)" }}
                data-testid="model-launch-pricing-detail"
              >
                {pricingDetail}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-[12px] text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end sm:px-6",
          "max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-10 w-full rounded-full border sm:h-9 sm:w-auto",
            "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)]",
          )}
          style={{
            borderColor:
              "color-mix(in srgb, var(--launch-muted) 40%, transparent)",
            color: "var(--launch-on-surface)",
            backgroundColor: "transparent",
          }}
          onClick={onDismiss}
          disabled={isActivating}
        >
          Continue with current model
        </Button>
        <Button
          type="button"
          size="sm"
          className={cn(
            "h-10 w-full rounded-full border-0 sm:h-9 sm:w-auto",
            "focus-visible:ring-2 focus-visible:ring-[var(--launch-accent)] focus-visible:ring-offset-2",
            !canTry && "opacity-55",
          )}
          style={{
            backgroundColor: "var(--launch-accent)",
            color: "var(--launch-on-surface)",
          }}
          onClick={onTry}
          disabled={!canTry || isActivating}
          aria-disabled={!canTry || isActivating}
          title={
            canTry
              ? `Try ${callableVariants[0]?.label ?? "model"}`
              : "Not available in your workspace catalog yet"
          }
          data-testid="model-launch-primary-cta"
        >
          {primaryLabel}
        </Button>
      </div>

      <style>{`
        @keyframes model-launch-aurora-shift {
          0% { background-position: 0% 40%; }
          50% { background-position: 100% 60%; }
          100% { background-position: 0% 40%; }
        }
        @keyframes model-launch-aurora-pulse {
          0%, 100% { opacity: 0.35; transform: translate3d(0, 0, 0) scale(1); }
          50% { opacity: 0.55; transform: translate3d(2%, -2%, 0) scale(1.04); }
        }
        .model-launch-aurora-layer {
          animation: model-launch-aurora-shift var(--launch-aurora-duration, 9s) ease-in-out infinite;
        }
        .model-launch-aurora-shimmer {
          animation: model-launch-aurora-pulse calc(var(--launch-aurora-duration, 9s) * 0.55) ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .model-launch-aurora-layer,
          .model-launch-aurora-shimmer {
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
          "overflow-hidden border-0 p-0 shadow-2xl",
          isMobile
            ? "max-w-none w-full max-sm:rounded-t-3xl max-sm:rounded-b-none sm:max-w-[480px]"
            : "w-full max-w-[480px] rounded-3xl",
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

  const handleTry = useCallback(async () => {
    if (!launch) {
      return;
    }
    const callable = getCallableLaunchVariants(launch, catalog);
    if (!canTryLaunchModel(launch, catalog) || callable.length === 0) {
      return;
    }

    const target = callable[0]!;
    setIsActivating(true);
    setError("");

    try {
      await setModel(target.modelId);
      onModelActivated?.(target.modelId);
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
  }, [catalog, launch, onModelActivated, userKey]);

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
      onTry={() => void handleTry()}
    />
  );
}
