import { HugeiconsIcon } from "@hugeicons/react";
import { Shield01Icon } from "@hugeicons/core-free-icons";


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
      <HugeiconsIcon icon={Shield01Icon} aria-hidden className="size-3.5 shrink-0" />
      <span className="max-w-52 truncate">
        {TRUST_LABELS[trust]} · {BEHAVIOR_MODE_LABELS[behavior.mode]}
      </span>
    </span>
  );
}
