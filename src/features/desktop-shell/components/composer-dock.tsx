
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chat-store";
import { useSidebar } from "../../../components/ui/sidebar";
import { ComposerScrollButton } from "./composer-scroll-button";

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
  const { state: sidebarState } = useSidebar();
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
        "pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8",
        sidebarState === "expanded" ? "md:left-(--sidebar-width)" : "md:left-0",
      )}
      data-testid="composer-dock"
    >
      <div
        ref={measureRef}
        className={cn(
          "pointer-events-auto relative mx-auto w-full min-w-0 bg-transparent",
          settings.compactMode ? "max-w-[680px]" : "max-w-[820px]",
        )}
      >
        <ComposerScrollButton />
        {children}
      </div>
    </div>
  );
}
