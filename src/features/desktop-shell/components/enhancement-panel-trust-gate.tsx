import { useState } from "react";

import type { SignalTone, TrustGateState } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { TonePill } from "./enhancement-panel-primitives";
import {
  toneSurfaceClassName,
  toneValueClassName,
} from "./enhancement-panel-tone";

export function TrustGateCard({
  isRunning = false,
  onMakeTrustworthy,
  onReviewChanges,
  showOverride = false,
  state,
}: {
  isRunning?: boolean;
  onMakeTrustworthy?: () => void;
  onReviewChanges?: () => void;
  showOverride?: boolean;
  state: TrustGateState;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canMakeTrustworthy =
    Boolean(onMakeTrustworthy) &&
    !isRunning &&
    state.status !== "trusted" &&
    state.status !== "resolving";
  const primaryShowsDetails =
    state.primaryActionLabel === "Show details" || !canMakeTrustworthy;
  const statusFacts = getTrustGateFacts(state);

  return (
    <Card
      className={cn(
        "mb-4 rounded-2xl border-border/70 shadow-none",
        toneSurfaceClassName(state.tone),
      )}
    >
      <CardContent className="p-3">
        <TrustGateHeader state={state} />
        <TrustGateFactGrid facts={statusFacts} />
        <TrustGateRecommendation state={state} />
        <TrustGateActions
          canMakeTrustworthy={canMakeTrustworthy}
          detailsOpen={detailsOpen}
          isRunning={isRunning}
          onMakeTrustworthy={onMakeTrustworthy}
          onReviewChanges={onReviewChanges}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
          primaryShowsDetails={primaryShowsDetails}
          showOverride={showOverride}
        />
        {detailsOpen ? <TrustGateDetails state={state} /> : null}
      </CardContent>
    </Card>
  );
}

export function ShipStatusStrip({
  isRunning = false,
  onMakeTrustworthy,
  onReviewLater,
  state,
}: {
  isRunning?: boolean;
  onMakeTrustworthy?: () => void;
  onReviewLater?: () => void;
  state: TrustGateState;
}) {
  const hasChanges = state.reasonChips.find((chip) => /changed/.test(chip));
  const message =
    state.status === "trusted"
      ? "Safe to continue."
      : state.status === "resolving"
        ? hasChanges
          ? `${hasChanges} under safety check.`
          : "Safety check running."
        : state.status === "unknown"
          ? "Repo safety check is available when you need it."
          : hasChanges
            ? "Blocked because this change has no proof yet."
            : "Repo needs a safety check before commit.";

  return (
    <div
      className={cn(
        "mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-[var(--panel)]/55 px-3 py-2 shadow-none backdrop-blur-xl",
      )}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Repo Safety
        </p>
        <p className="truncate text-[11px] font-medium text-foreground/85">
          {message}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {state.status !== "trusted" ? (
          <button
            className="rounded-full border border-border/60 bg-transparent px-2.5 py-1 text-[10px] font-medium text-foreground/80 transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isRunning}
            onClick={onMakeTrustworthy}
            type="button"
          >
            {isRunning ? "Running..." : "Run Factory verification"}
          </button>
        ) : null}
        <button
          className="rounded-full border border-transparent bg-transparent px-2 py-1 text-[10px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
          onClick={onReviewLater}
          type="button"
        >
          Review later
        </button>
      </div>
    </div>
  );
}

// ─── Private sub-components ───────────────────────────────────────────────────

function TrustGateHeader({ state }: { state: TrustGateState }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Active Gate
        </p>
        <p className={cn("mt-1 break-words text-[16px] font-semibold leading-6", toneValueClassName(state.tone))}>
          {state.headline}
        </p>
      </div>
      <TonePill label={state.confidenceLabel === "verified" ? "Verified" : "Needs check"} tone={state.tone} />
    </div>
  );
}

function TrustGateFactGrid({ facts }: { facts: TrustGateFact[] }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2">
      {facts.map((fact) => (
        <div className="rounded-2xl border border-border/60 bg-[var(--panel)]/35 px-2.5 py-2" key={fact.label}>
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {fact.label}
          </dt>
          <dd className={cn("mt-1 break-words text-[11px] font-medium", toneValueClassName(fact.tone))}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TrustGateRecommendation({ state }: { state: TrustGateState }) {
  return (
    <div className="mt-3 rounded-2xl border border-border/50 bg-transparent px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
      <p className="break-words text-foreground">{state.explanation}</p>
      <p className="mt-2 break-words">
        <span className="font-medium text-foreground">Recommended:</span>{" "}
        {state.recommendedAction}
      </p>
    </div>
  );
}

function TrustGateActions({
  canMakeTrustworthy,
  detailsOpen,
  isRunning,
  onMakeTrustworthy,
  onReviewChanges,
  onToggleDetails,
  primaryShowsDetails,
  showOverride,
}: {
  canMakeTrustworthy: boolean;
  detailsOpen: boolean;
  isRunning: boolean;
  onMakeTrustworthy?: () => void;
  onReviewChanges?: () => void;
  onToggleDetails: () => void;
  primaryShowsDetails: boolean;
  showOverride: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        className="inline-flex flex-1 items-center justify-center rounded-xl border border-border/70 bg-[var(--panel)]/70 px-3 py-2 text-[11px] font-medium text-foreground shadow-none transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-[var(--panel)] disabled:cursor-default disabled:opacity-60"
        disabled={isRunning}
        onClick={primaryShowsDetails ? onToggleDetails : canMakeTrustworthy ? onMakeTrustworthy : undefined}
        type="button"
      >
        {primaryShowsDetails ? "Show details" : isRunning ? "Running..." : "Run Factory verification"}
      </button>
      {onReviewChanges ? (
        <button
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isRunning}
          onClick={onReviewChanges}
          type="button"
        >
          Review changes
        </button>
      ) : null}
      <button
        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[11px] font-medium text-muted-foreground transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:text-foreground"
        onClick={onToggleDetails}
        type="button"
      >
        {detailsOpen ? "Hide details" : "Why"}
      </button>
      {showOverride ? (
        <button
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-300 transition duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-amber-500/15"
          type="button"
        >
          Push anyway
        </button>
      ) : null}
    </div>
  );
}

function TrustGateDetails({ state }: { state: TrustGateState }) {
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-transparent p-2.5 text-[10px] leading-4 text-muted-foreground">
      {state.reasons.slice(0, 3).map((reason) => (
        <p className="break-words" key={reason}>
          {reason}
        </p>
      ))}
      {state.missingProof.length > 0 ? (
        <p className="break-words">
          Missing proof: {state.missingProof.slice(0, 3).join(", ")}
        </p>
      ) : null}
      {state.touchedRiskSurfaces.length > 0 ? (
        <p className="break-all font-mono">
          Risk surface: {state.touchedRiskSurfaces.slice(0, 2).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TrustGateFact {
  label: string;
  value: string;
  tone: SignalTone;
}

function humanizeState(value: string) {
  return value.replace(/_/g, " ");
}

function getTrustGateFacts(state: TrustGateState): TrustGateFact[] {
  const changedFiles = state.reasonChips.find((chip) => /changed/.test(chip)) ?? "No changed files";
  return [
    {
      label: "Validation",
      value: humanizeState(state.validationState),
      tone: state.validationState === "passed" ? "good" : state.validationState === "failed" ? "bad" : "watch",
    },
    {
      label: "Proof",
      value: humanizeState(state.evidencePackState),
      tone: state.evidencePackState === "signed_strong" ? "good" : "watch",
    },
    {
      label: "Changes",
      value: changedFiles,
      tone: changedFiles === "No changed files" ? "muted" : "watch",
    },
    {
      label: "Risk",
      value: state.touchedRiskSurfaces.length > 0 ? `${state.touchedRiskSurfaces.length} risky surface${state.touchedRiskSurfaces.length === 1 ? "" : "s"}` : "No risky surface",
      tone: state.touchedRiskSurfaces.length > 0 ? "warn" : "good",
    },
  ];
}
