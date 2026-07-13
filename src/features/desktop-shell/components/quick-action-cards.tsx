import {
  TelescopeIcon,
  HammerIcon,
  RefreshCcwIcon,
  BugIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../../lib/utils";

interface QuickActionCardProps {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

function QuickActionCard({
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
        "group relative flex min-h-[108px] w-full flex-col justify-between rounded-[20px] bg-foreground/[0.03] p-4 text-left transition-[transform,background-color] duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-0.5 hover:bg-foreground/[0.06] active:translate-y-0 active:scale-[0.985]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="text-foreground/75 transition-colors duration-200 group-hover:text-foreground">
        {icon}
      </div>
      <div className="mt-4">
        <div className="max-w-[150px] text-[12px] font-medium leading-snug text-foreground/90">
          {title}
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
    id: "explore",
    title: "Explore and understand code",
    icon: <TelescopeIcon className="size-[20px]" />,
    prompt:
      "Explain how the current repository is structured and what its main components are.",
  },
  {
    id: "build",
    title: "Build a new feature, app, or tool",
    icon: <HammerIcon className="size-[20px]" />,
    prompt: "I want to build a new feature. How should we approach it?",
  },
  {
    id: "review",
    title: "Review code and suggest changes",
    icon: <RefreshCcwIcon className="size-[20px]" />,
    prompt:
      "Review the recent changes in the repository and suggest any improvements.",
  },
  {
    id: "fix",
    title: "Fix issues and failures",
    icon: <BugIcon className="size-[20px]" />,
    prompt:
      "Help me find and fix any issues or failures in the current codebase.",
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
    <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
      {QUICK_ACTIONS.map((action) => (
        <QuickActionCard
          key={action.id}
          title={action.title}
          icon={action.icon}
          disabled={disabled}
          onClick={() => onSelectAction(action.prompt)}
        />
      ))}
    </div>
  );
}
