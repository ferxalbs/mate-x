import type { CSSProperties } from "react";

import type { Theme } from "../../../hooks/use-theme";
import { cn } from "../../../lib/utils";

const SHINE_COLOR_STOPS = {
  default: ["rgba(77, 124, 255, 0.18)", "rgba(20, 184, 166, 0.14)", "rgba(244, 114, 182, 0.12)"],
  oled: ["rgba(56, 189, 248, 0.16)", "rgba(168, 85, 247, 0.12)", "rgba(16, 185, 129, 0.1)"],
  blue: ["rgba(59, 130, 246, 0.24)", "rgba(6, 182, 212, 0.16)", "rgba(129, 140, 248, 0.12)"],
  deepblue: ["rgba(14, 165, 233, 0.24)", "rgba(37, 99, 235, 0.18)", "rgba(45, 212, 191, 0.12)"],
  deeppurple: ["rgba(168, 85, 247, 0.24)", "rgba(236, 72, 153, 0.14)", "rgba(96, 165, 250, 0.12)"],
  casimiri: ["rgba(251, 146, 60, 0.16)", "rgba(244, 114, 182, 0.12)", "rgba(45, 212, 191, 0.1)"],
  greenspace: ["rgba(34, 197, 94, 0.22)", "rgba(20, 184, 166, 0.16)", "rgba(132, 204, 22, 0.1)"],
  midnight: ["rgba(45, 212, 191, 0.2)", "rgba(59, 130, 246, 0.16)", "rgba(168, 85, 247, 0.12)"],
} as const;

export function getUniversalBackgroundStyle(
  theme: Theme,
  liquidGlassEnabled: boolean,
  shineEnabled: boolean,
) {
  const shineColors = SHINE_COLOR_STOPS[theme] ?? SHINE_COLOR_STOPS.midnight;

  return {
    "--mate-shell-a": shineColors[0],
    "--mate-shell-b": shineColors[1],
    "--mate-shell-c": shineColors[2],
    "--mate-shell-field-opacity": shineEnabled ? "0.72" : "0",
    "--mate-shell-base":
      "linear-gradient(135deg, color-mix(in srgb, var(--background) 88%, var(--mate-shell-a)), var(--background) 42%, color-mix(in srgb, var(--background) 90%, var(--mate-shell-c)))",
    "--mate-shell-field":
      "radial-gradient(circle at 18% 16%, var(--mate-shell-a), transparent 28%), radial-gradient(circle at 76% 18%, var(--mate-shell-b), transparent 30%), radial-gradient(circle at 82% 82%, var(--mate-shell-c), transparent 34%)",
    "--mate-shell-glass":
      "linear-gradient(180deg, color-mix(in srgb, var(--panel) 70%, transparent), color-mix(in srgb, var(--background) 86%, transparent))",
    "--mate-page-bg": liquidGlassEnabled ? "transparent" : "var(--background)",
    "--mate-surface-bg": liquidGlassEnabled
      ? "color-mix(in srgb, var(--surface) 58%, transparent)"
      : "var(--surface)",
    "--mate-panel-bg": liquidGlassEnabled
      ? "color-mix(in srgb, var(--panel) 54%, transparent)"
      : "var(--panel)",
    "--mate-control-bg": liquidGlassEnabled
      ? "color-mix(in srgb, var(--background) 28%, transparent)"
      : "var(--background)",
  } as CSSProperties;
}

export function UniversalBackground({
  className,
  field = true,
}: {
  className?: string;
  field?: boolean;
}) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", className)}>
      <div className="absolute inset-0 bg-[image:var(--mate-shell-base)]" />
      {field ? (
        <div className="absolute inset-0 bg-[image:var(--mate-shell-field)] opacity-[var(--mate-shell-field-opacity)] blur-2xl saturate-150" />
      ) : null}
      <div className="absolute inset-0 bg-[image:var(--mate-shell-glass)] backdrop-blur-2xl" />
    </div>
  );
}
