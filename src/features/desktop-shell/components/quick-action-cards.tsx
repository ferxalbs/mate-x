import { HugeiconsIcon } from "@hugeicons/react";
import { Bug01Icon, CheckmarkCircle01Icon, GitBranchIcon, RouteIcon } from "@hugeicons/core-free-icons";

import { motion } from "framer-motion";
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
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", damping: 25, stiffness: 400 }}
      className={cn(
        "group relative flex w-full flex-col items-start gap-2 rounded-xl border border-border/40 bg-transparent p-3 text-left shadow-none transition-colors duration-[250ms] hover:border-foreground/15 hover:bg-foreground/[0.02] motion-reduce:transform-none",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex items-center gap-2 text-foreground/75 transition-colors duration-[150ms] group-hover:text-foreground">
        <div className="shrink-0">{icon}</div>
        <div className="text-[12px] font-medium leading-none text-foreground/90">
          {title}
        </div>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
        {evidence}
      </div>
    </motion.button>
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
    icon: <HugeiconsIcon icon={GitBranchIcon} className="size-[20px]" />,
    prompt:
      "Review the current repository changes. Rank concrete risks, cite the affected files, and recommend the smallest safe next step.",
  },
  {
    id: "validate",
    title: "Validate a fix",
    evidence: "Checks run, results, and remaining risk",
    icon: <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-[20px]" />,
    prompt:
      "Validate the current fix. Run the relevant checks, explain the evidence, and identify any remaining risk without changing unrelated code.",
  },
  {
    id: "trace",
    title: "Trace a risky path",
    evidence: "Source-to-sink path and trust boundaries",
    icon: <HugeiconsIcon icon={RouteIcon} className="size-[20px]" />,
    prompt:
      "Trace a risky path through this repository from input to sensitive sink. Cite the data flow, trust boundaries, and missing controls.",
  },
  {
    id: "explain",
    title: "Explain repository risk",
    evidence: "Risk model grounded in repository signals",
    icon: <HugeiconsIcon icon={Bug01Icon} className="size-[20px]" />,
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
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
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
