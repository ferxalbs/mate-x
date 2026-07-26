import { useEffect, useRef } from "react";

interface VisibilityIntervalOptions {
  enabled?: boolean;
  runImmediately?: boolean;
  runOnFocus?: boolean;
  runOnVisibility?: boolean;
}

export function useVisibilityInterval(
  task: () => void | Promise<void>,
  intervalMs: number,
  options: VisibilityIntervalOptions = {},
): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  const {
    enabled = true,
    runImmediately = true,
    runOnFocus = true,
    runOnVisibility = true,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let running = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (!mounted || document.hidden) return;
      timer = window.setTimeout(run, intervalMs);
    };

    const run = () => {
      if (!mounted || document.hidden || running) return;
      running = true;
      let result: void | Promise<void>;
      try {
        result = taskRef.current();
      } catch {
        result = undefined;
      }

      Promise.resolve(result)
        .catch(() => undefined)
        .finally(() => {
          running = false;
          schedule();
        });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else if (runOnVisibility) {
        run();
      } else {
        schedule();
      }
    };

    const handleFocus = () => {
      if (runOnFocus) run();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    if (runImmediately) run();
    else schedule();

    return () => {
      mounted = false;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled, intervalMs, runImmediately, runOnFocus, runOnVisibility]);
}
