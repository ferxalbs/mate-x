import { useState } from "react";

import type { SignalTone, TrustGateState } from "./enhancement-panel-utils";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { TonePill } from "./enhancement-panel-primitives";
import type { OutcomeMap } from "../../../contracts/engineering-task";
import {
  toneSurfaceClassName,
  toneValueClassName,
} from "./enhancement-panel-tone";

export function TrustGateCard({
  isRunning = false,
  onMakeTrustworthy,
  onReviewChanges,
  showOverride = false,
  outcomeMap,
  state,
}: {
  isRunning?: boolean;
  onMakeTrustworthy?: () => void;
  onReviewChanges?: () => void;
  showOverride?: boolean;
  outcomeMap?: OutcomeMap;
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
        "control-surface mb-4 rounded-2xl border border-border/70 bg-card text-card-foreground shadow-none",
        toneSurfaceClassName(state.tone),
      )}
    >
      <CardContent className="p-3">
        <TrustGateHeader state={state} />
        {outcomeMap ? <OutcomeCheck map={outcomeMap} /> : null}
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

function OutcomeCheck({ map }: { map: OutcomeMap }) {
  const proven = map.entries.filter((entry) => entry.state === "proven").length;
  const critical = map.entries.filter((entry) => entry.state === "missing" || entry.state === "violated" || entry.state === "weak").slice(0, 2);
  const drift = map.scopeDrift.slice(0, 1);
  return (
    <div className="mt-3 rounded-2xl border border-border/70 bg-panel px-3 py-2 text-[13px]">
      <p className="mate-text-metadata">Outcome check</p>
      <p className="mt-1 font-medium text-foreground">{proven} proven{critical.length ? ` · ${critical.length} needs check` : " · Ready"}</p>
      {critical.map((entry) => <p className="mt-1 break-words text-muted-foreground" key={entry.outcomeId}><span className="font-medium text-foreground">{entry.state === "violated" ? "Blocked" : entry.state === "weak" ? "Evidence is weak" : "Missing"}</span> {entry.statement}</p>)}
      {drift.map((item) => <p className="mt-1 break-words text-muted-foreground" key={item}><span className="font-medium text-foreground">Scope drift</span> {item}</p>)}
    </div>
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
          ? "Repo safety check is available."
          : hasChanges
            ? "Blocked: change has no proof yet."
            : "Repo needs a safety check before commit.";

  const badgeLabel =
    state.status === "trusted"
      ? "Trusted"
      : state.status === "resolving"
        ? "Checking"
        : state.status === "unknown"
          ? "Available"
          : "Needs check";

  return (
    <div className="control-surface mb-3 rounded-2xl border border-border/70 bg-card text-card-foreground p-3.5 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Repo Safety
        </span>
        <TonePill label={badgeLabel} tone={state.tone} />
      </div>
      <p className="mt-1 text-[12.5px] font-medium leading-snug text-foreground">
        {message}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {state.status !== "trusted" ? (
          <button
            className="h-7.5 flex-1 rounded-xl bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground transition-all duration-150 active:scale-[0.97] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isRunning}
            onClick={onMakeTrustworthy}
            type="button"
          >
            {isRunning ? "Running..." : "Run verification"}
          </button>
        ) : null}
        <button
          className="control-surface h-7.5 rounded-xl border border-border/70 bg-card px-3 text-[11.5px] font-medium text-muted-foreground transition-all duration-150 hover:text-foreground hover:border-border active:scale-[0.97]"
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
        <p className="mate-text-metadata">
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
        <div className="control-surface rounded-xl border border-border/70 bg-card text-card-foreground px-2.5 py-2" key={fact.label}>
          <dt className="mate-text-metadata">
            {fact.label}
          </dt>
          <dd className={cn("mt-1 break-words text-[13px] font-medium", toneValueClassName(fact.tone))}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TrustGateRecommendation({ state }: { state: TrustGateState }) {
  return (
    <div className="mate-text-secondary mt-3 rounded-2xl border border-border/50 bg-transparent px-2.5 py-2">
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
        className="inline-flex min-h-8 flex-1 items-center justify-center rounded-xl border border-border/70 bg-panel px-3 py-2 text-[13px] font-medium text-foreground shadow-none transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] disabled:cursor-default disabled:opacity-60 motion-reduce:transform-none"
        disabled={isRunning}
        onClick={primaryShowsDetails ? onToggleDetails : canMakeTrustworthy ? onMakeTrustworthy : undefined}
        type="button"
      >
        {primaryShowsDetails ? "Show details" : isRunning ? "Running..." : "Run verification"}
      </button>
      {onReviewChanges ? (
        <button
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
          disabled={isRunning}
          onClick={onReviewChanges}
          type="button"
        >
          Review changes
        </button>
      ) : null}
      <button
        className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] motion-reduce:transform-none"
        onClick={onToggleDetails}
        type="button"
      >
        {detailsOpen ? "Hide details" : "Why"}
      </button>
      {showOverride ? (
        <button
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] font-medium text-amber-300 transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 active:scale-[0.97] motion-reduce:transform-none"
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
    <div className="mate-text-secondary mt-3 space-y-2 rounded-2xl border border-border/60 bg-transparent p-2.5">
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
