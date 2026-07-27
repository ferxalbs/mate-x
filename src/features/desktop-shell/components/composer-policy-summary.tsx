import { HugeiconsIcon } from "@hugeicons/react";
import { Shield01Icon } from "@hugeicons/core-free-icons";


import type {
  BehaviorMode,
  BehaviorPreference,
} from "../../../contracts/behavior-mode";
import type { WorkspaceWriteAccess } from "../../../contracts/workspace";

export const BEHAVIOR_MODE_LABELS: Record<BehaviorMode, string> = {
  review: "Review",
  plan: "Plan",
  execute: "Execute",
};

export const BEHAVIOR_MODE_DESCRIPTIONS: Record<BehaviorMode, string> = {
  review: "Read-only findings with no mutations.",
  plan: "Inspect and produce an executable implementation plan.",
  execute: "Apply scoped changes and validate results.",
};

export const TRUST_LABELS: Record<WorkspaceWriteAccess, string> = {
  "read-only": "Read only",
  "approval-required": "Ask before changes",
  workspace: "Workspace changes",
};

export function ComposerPolicySummary({
  behavior,
  trust,
}: {
  behavior: BehaviorPreference;
  trust: WorkspaceWriteAccess;
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
