import {
  BugBeetleIcon,
  CheckCircleIcon,
  GitDiffIcon,
  PathIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../../lib/utils";

interface QuickActionCardProps {
  evidence: string;
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

function QuickActionCard({
  evidence,
  icon,
  title,
  onClick,
  disabled,
}: QuickActionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[104px] w-full flex-col justify-between rounded-2xl border border-border/70 bg-transparent p-4 text-left shadow-none transition-[background-color,border-color,transform] duration-[var(--motion-menu)] ease-[var(--ease-out)] hover:border-foreground/15 hover:bg-foreground/[0.03] active:scale-[0.97] motion-reduce:transform-none [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="text-foreground/75 transition-colors duration-[var(--motion-press)] ease-[var(--ease-out)] group-hover:text-foreground">
        {icon}
      </div>
      <div className="mt-4">
        <div className="text-[13px] font-medium leading-snug text-foreground/90">
          {title}
        </div>
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {evidence}
        </div>
      </div>
    </button>
  );
}

interface QuickActionCardsProps {
  onSelectAction: (prompt: string) => void;
  disabled?: boolean;
}

const QUICK_ACTIONS = [
  {
    id: "review",
    title: "Review current changes",
    evidence: "Risk-ranked findings with file evidence",
    icon: <GitDiffIcon className="size-[20px]" />,
    prompt:
      "Review the current repository changes. Rank concrete risks, cite the affected files, and recommend the smallest safe next step.",
  },
  {
    id: "validate",
    title: "Validate a fix",
    evidence: "Checks run, results, and remaining risk",
    icon: <CheckCircleIcon className="size-[20px]" />,
    prompt:
      "Validate the current fix. Run the relevant checks, explain the evidence, and identify any remaining risk without changing unrelated code.",
  },
  {
    id: "trace",
    title: "Trace a risky path",
    evidence: "Source-to-sink path and trust boundaries",
    icon: <PathIcon className="size-[20px]" />,
    prompt:
      "Trace a risky path through this repository from input to sensitive sink. Cite the data flow, trust boundaries, and missing controls.",
  },
  {
    id: "explain",
    title: "Explain repository risk",
    evidence: "Risk model grounded in repository signals",
    icon: <BugBeetleIcon className="size-[20px]" />,
    prompt:
      "Explain this repository's most important security and reliability risks using concrete local evidence and confidence levels.",
  },
] as const;

export function QuickActionCards({
  onSelectAction,
  disabled,
}: QuickActionCardsProps) {
  // Keep latest callback without re-subscribing the window listener every parent render.
  const onSelectActionRef = useRef(onSelectAction);
  useEffect(() => {
    onSelectActionRef.current = onSelectAction;
  }, [onSelectAction]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (disabled || (!event.metaKey && !event.ctrlKey)) return;

      const action = QUICK_ACTIONS[Number(event.key) - 1];
      if (!action) return;

      event.preventDefault();
      onSelectActionRef.current(action.prompt);
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [disabled]);

  return (
      <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {QUICK_ACTIONS.map((action) => (
          <QuickActionCard
            key={action.id}
            evidence={action.evidence}
            title={action.title}
            icon={action.icon}
            disabled={disabled}
            onClick={() => onSelectAction(action.prompt)}
          />
        ))}
      </div>
  );
}
