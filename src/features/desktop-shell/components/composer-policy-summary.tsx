import { HugeiconsIcon } from "@hugeicons/react";
import { Shield01Icon } from "@hugeicons/core-free-icons";

import type { WorkspaceWriteAccess } from "../../../contracts/workspace";
import type { BehaviorMode } from "../../../contracts/behavior-mode";

export const TRUST_LABELS: Record<WorkspaceWriteAccess, string> = {
  "read-only": "Read only",
  "approval-required": "Ask before changes",
  workspace: "Workspace changes",
};

export function ComposerPolicySummary({
  behavior,
  trust,
}: {
  behavior: BehaviorMode;
  trust: WorkspaceWriteAccess;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <HugeiconsIcon icon={Shield01Icon} aria-hidden className="size-3.5 shrink-0" />
      <span className="max-w-52 truncate">
        {behavior === "execute" ? "Work" : behavior === "review" ? "Review" : "Plan"} · {TRUST_LABELS[trust]}
      </span>
    </span>
  );
}
