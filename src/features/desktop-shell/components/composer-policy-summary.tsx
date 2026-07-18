import { ShieldCheckIcon } from "@phosphor-icons/react";

import type {
  BehaviorMode,
  BehaviorPreference,
} from "../../../contracts/behavior-mode";
import type { WorkspaceTrustAutonomy } from "../../../contracts/workspace";

export const BEHAVIOR_MODE_LABELS: Record<BehaviorMode, string> = {
  auto: "Auto",
  guided: "Guided",
  review: "Review",
  custom: "Custom",
};

export const TRUST_LABELS: Record<WorkspaceTrustAutonomy, string> = {
  "plan-only": "Plan only",
  "approval-required": "Ask before changes",
  "trusted-patch": "Scoped changes",
};

export function ComposerPolicySummary({
  behavior,
  trust,
}: {
  behavior: BehaviorPreference;
  trust: WorkspaceTrustAutonomy;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="max-w-52 truncate">
        {TRUST_LABELS[trust]} · {BEHAVIOR_MODE_LABELS[behavior.mode]}
      </span>
    </span>
  );
}
