import { HugeiconsIcon } from "@hugeicons/react";
import { Bug01Icon, CheckmarkCircle01Icon, GitBranchIcon, RouteIcon } from "@hugeicons/core-free-icons";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

import { useTheme } from "../../../hooks/use-theme";
import { cn } from "../../../lib/utils";

interface QuickActionCardProps {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  variants?: Variants;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease: [0.23, 1, 0.32, 1],
    },
  },
};

function QuickActionCard({
  icon,
  title,
  onClick,
  disabled,
  variants,
}: QuickActionCardProps) {
  const { blurEnabled } = useTheme();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      variants={variants}
      whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 450, damping: 28 }}
      className={cn(
        "group relative flex items-center gap-2 rounded-full border border-border/40 px-3.5 py-1.5 text-left shadow-none transition-all duration-150 ease-out hover:border-foreground/25 hover:bg-foreground/[0.08] motion-reduce:transform-none cursor-pointer",
        blurEnabled ? "mate-glass-float" : "bg-foreground/[0.03]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="shrink-0 text-muted-foreground/80 transition-colors duration-150 group-hover:text-foreground">
        {icon}
      </div>
      <span className="text-[12.5px] font-medium leading-none tracking-tight text-foreground/85 transition-colors duration-150 group-hover:text-foreground">
        {title}
      </span>
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
    icon: <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />,
    prompt:
      "Review the current repository changes. Rank concrete risks, cite the affected files, and recommend the smallest safe next step.",
  },
  {
    id: "validate",
    title: "Validate a fix",
    evidence: "Checks run, results, and remaining risk",
    icon: <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-3.5" />,
    prompt:
      "Validate the current fix. Run the relevant checks, explain the evidence, and identify any remaining risk without changing unrelated code.",
  },
  {
    id: "trace",
    title: "Trace a risky path",
    evidence: "Source-to-sink path and trust boundaries",
    icon: <HugeiconsIcon icon={RouteIcon} className="size-3.5" />,
    prompt:
      "Trace a risky path through this repository from input to sensitive sink. Cite the data flow, trust boundaries, and missing controls.",
  },
  {
    id: "explain",
    title: "Explain repository risk",
    evidence: "Risk model grounded in repository signals",
    icon: <HugeiconsIcon icon={Bug01Icon} className="size-3.5" />,
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
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-wrap items-center justify-center gap-2.5 w-full"
    >
      {QUICK_ACTIONS.map((action) => (
        <QuickActionCard
          key={action.id}
          variants={cardVariants}
          title={action.title}
          icon={action.icon}
          disabled={disabled}
          onClick={() => onSelectAction(action.prompt)}
        />
      ))}
    </motion.div>
  );
}
