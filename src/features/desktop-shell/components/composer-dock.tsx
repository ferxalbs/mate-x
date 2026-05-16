import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chat-store";

interface ComposerDockProps {
  children: ReactNode;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  showScrollButton: boolean;
}

export function ComposerDock({
  children,
  hasMessages,
  onScrollToBottom,
  showScrollButton,
}: ComposerDockProps) {
  const settings = useChatStore((state) => state.settings);
  const floating = hasMessages && settings.floatingInput;

  return (
    <div
      className={cn(
        "bg-transparent transition-all duration-300",
        floating
          ? "pointer-events-none absolute inset-x-0 bottom-0 z-40 pb-4"
          : "px-8 pb-6",
      )}
    >
      <div
        className={cn(
          "relative mx-auto w-full bg-transparent transition-all duration-300",
          floating ? "pointer-events-auto px-4" : "",
          settings.compactMode ? "max-w-[680px]" : "max-w-[820px]",
        )}
      >
        {showScrollButton ? (
          <div className="pointer-events-none absolute inset-x-0 -top-12 z-10 flex justify-center transition-all">
            <Button
              className="pointer-events-auto h-8 rounded-full border-[var(--panel-border)]/40 bg-[var(--panel)]/88 px-3 text-[11px] text-muted-foreground backdrop-blur-xl hover:bg-accent"
              onClick={onScrollToBottom}
              size="xs"
              variant="outline"
            >
              <ChevronDownIcon className="size-3.5" />
              Scroll to bottom
            </Button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
