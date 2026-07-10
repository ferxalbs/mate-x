import {
  TelescopeIcon,
  HammerIcon,
  RefreshCcwIcon,
  BugIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

interface QuickActionCardProps {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

function QuickActionCard({ icon, title, onClick, disabled }: QuickActionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex h-[110px] w-full min-w-[160px] max-w-[200px] flex-1 flex-col justify-between rounded-2xl border border-[var(--panel-border)]/40 bg-[var(--mate-panel-bg)] p-4 text-left shadow-none transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:bg-accent/50 hover:border-border/70",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="flex items-center text-foreground/70 transition-colors group-hover:text-foreground">
        {icon}
      </div>
      <div className="mt-4 text-[13px] font-medium leading-tight text-foreground/90">
        {title}
      </div>
    </button>
  );
}

interface QuickActionCardsProps {
  onSelectAction: (prompt: string) => void;
  disabled?: boolean;
}

export function QuickActionCards({ onSelectAction, disabled }: QuickActionCardsProps) {
  const actions = [
    {
      id: 'explore',
      title: "Explore and understand code",
      icon: <TelescopeIcon className="size-[18px] text-blue-500" />,
      prompt: "Explain how the current repository is structured and what its main components are."
    },
    {
      id: 'build',
      title: "Build a new feature, app, or tool",
      icon: <HammerIcon className="size-[18px] text-purple-500" />,
      prompt: "I want to build a new feature. How should we approach it?"
    },
    {
      id: 'review',
      title: "Review code and suggest changes",
      icon: <RefreshCcwIcon className="size-[18px] text-emerald-500" />,
      prompt: "Review the recent changes in the repository and suggest any improvements."
    },
    {
      id: 'fix',
      title: "Fix issues and failures",
      icon: <BugIcon className="size-[18px] text-amber-500" />,
      prompt: "Help me find and fix any issues or failures in the current codebase."
    }
  ];

  return (
    <div className="flex w-full flex-wrap justify-center gap-3 px-4">
      {actions.map((action) => (
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
