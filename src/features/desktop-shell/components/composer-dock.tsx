
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chat-store";

interface ComposerDockProps {
  children: ReactNode;
}

const COMPOSER_INSET_VAR = "--mate-composer-inset";
const DEFAULT_INSET_PX = 148;

/**
 * Fixed bottom composer dock.
 * - Reserves scroll space via CSS variable on documentElement (actual measured height).
 * - Does not couple padding to blurEnabled.
 * - Outer shell is pointer-events-none; only the composer chrome captures clicks.
 */
export function ComposerDock({
  children,
}: ComposerDockProps) {
  const settings = useChatStore((state) => state.settings);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = measureRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      document.documentElement.style.setProperty(
        COMPOSER_INSET_VAR,
        `${DEFAULT_INSET_PX}px`,
      );
      return;
    }

    const apply = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      // Extra breathing room so final messages / approval controls stay visible above the dock.
      const inset = Math.max(DEFAULT_INSET_PX, height + 24);
      document.documentElement.style.setProperty(COMPOSER_INSET_VAR, `${inset}px`);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 transition-all duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] pointer-events-none px-4 pb-3 sm:px-8",
      )}
      data-testid="composer-dock"
    >
      <div
        ref={measureRef}
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
