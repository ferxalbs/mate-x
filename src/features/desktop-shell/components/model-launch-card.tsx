import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import type {
  RainyModelCatalogEntry,
  RainyModelLaunch,
} from "../../../contracts/rainy";
import {
  canTryLaunchModel,
  formatLaunchStatus,
  getCallableLaunchVariants,
  getHighContextPricingNotice,
  loadDismissedLaunchIds,
  persistDismissedLaunchId,
  selectUnseenLaunches,
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

/**
 * Non-blocking "new model" card driven by GET /api/v1/models/launches.
 * Fetches at mount, caches via main-process TTL, shows only unseen launch IDs.
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

  const callableVariants = useMemo(
    () => (launch ? getCallableLaunchVariants(launch, catalog) : []),
    [catalog, launch],
  );
  const canTry = launch ? canTryLaunchModel(launch, catalog) : false;
  const pricingNotice = launch ? getHighContextPricingNotice({ launch }) : null;

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
    if (!launch || !canTry || callableVariants.length === 0) {
      return;
    }

    const target = callableVariants[0]!;
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
  }, [callableVariants, canTry, launch, onModelActivated, userKey]);

  if (!launch) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          dismiss();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogPopup className="max-w-md overflow-hidden p-0" showCloseButton>
        <div
          className="relative h-36 w-full bg-gradient-to-br from-violet-600 via-indigo-500 to-sky-400"
          aria-hidden
        >
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_20%,white,transparent_55%)]" />
        </div>

        <DialogHeader className="gap-2 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                launch.status === "available"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-300",
              )}
            >
              {formatLaunchStatus(launch.status)}
            </span>
          </div>
          <DialogTitle className="text-base font-semibold tracking-tight">
            {launch.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {launch.summary}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-2">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
              Variants
            </div>
            <div className="flex flex-wrap gap-1.5">
              {launch.variants.map((variant) => {
                const callable = callableVariants.some(
                  (entry) => entry.modelId === variant.modelId,
                );
                return (
                  <span
                    key={variant.modelId}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px]",
                      callable
                        ? "border-border/60 bg-foreground/5 text-foreground"
                        : "border-border/30 bg-muted/40 text-muted-foreground",
                    )}
                    title={
                      callable
                        ? variant.modelId
                        : `${variant.modelId} — not in catalog yet`
                    }
                  >
                    {variant.label}
                    {!callable ? " · staged" : ""}
                  </span>
                );
              })}
            </div>
          </div>

          {launch.appControls.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                Controls
              </div>
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                {launch.appControls.map((control) => (
                  <li
                    key={control.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>{control.label}</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-[0.12em]",
                        control.availability === "available"
                          ? "text-emerald-500"
                          : "text-amber-600 dark:text-amber-300",
                      )}
                    >
                      {control.availability === "available"
                        ? "Available"
                        : "Coming soon"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {pricingNotice ? (
            <p className="rounded-xl border border-border/40 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {pricingNotice}
            </p>
          ) : null}

          {error ? (
            <p className="text-[12px] text-destructive">{error}</p>
          ) : null}
        </div>

        <DialogFooter variant="bare" className="gap-2 px-6 pb-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={dismiss}
            disabled={isActivating}
          >
            Continue with current model
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            onClick={() => void handleTry()}
            disabled={!canTry || isActivating}
            title={
              canTry
                ? `Try ${callableVariants[0]?.label ?? "model"}`
                : "Model is staged and not callable in catalog yet"
            }
          >
            {canTry
              ? isActivating
                ? "Activating…"
                : "Try model"
              : "Coming soon"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
