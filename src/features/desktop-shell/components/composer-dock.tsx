
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chat-store";

interface ComposerDockProps {
  children: ReactNode;
}

export function ComposerDock({
  children,
}: ComposerDockProps) {
  const settings = useChatStore((state) => state.settings);

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 pointer-events-none px-4 pb-6 sm:px-8",
      )}
    >
      <div
        className={cn(
          "relative mx-auto w-full min-w-0 bg-transparent transition-all duration-300 pointer-events-auto",
          settings.compactMode ? "max-w-[680px]" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
