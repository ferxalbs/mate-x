
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chat-store";

interface ComposerDockProps {
  children: ReactNode;
  hasMessages: boolean;
}

export function ComposerDock({
  children,
  hasMessages,
}: ComposerDockProps) {
  const settings = useChatStore((state) => state.settings);

  return (
    <div
      className={cn(
        "bg-transparent transition-all duration-300",
        "px-4 pb-6 sm:px-8",
      )}
    >
      <div
        className={cn(
          "relative mx-auto w-full min-w-0 bg-transparent transition-all duration-300",
          settings.compactMode ? "max-w-[680px]" : "max-w-[820px]",
        )}
      >

        {children}
      </div>
    </div>
  );
}
