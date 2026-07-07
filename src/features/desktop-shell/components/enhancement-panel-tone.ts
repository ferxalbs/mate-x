import type { SignalTone } from "./enhancement-panel-utils";

export function toneSurfaceClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "border-destructive/35 bg-destructive/[0.05]";
  }
  if (tone === "warn") {
    return "border-amber-500/35 bg-amber-500/[0.05]";
  }
  if (tone === "watch") {
    return "border-yellow-500/30 bg-yellow-500/[0.045]";
  }
  if (tone === "good") {
    return "border-emerald-500/30 bg-emerald-500/[0.045]";
  }

  return "border-[var(--panel-border)]/35 bg-transparent";
}

export function toneTextClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "border-destructive/45 text-destructive";
  }
  if (tone === "warn") {
    return "border-amber-500/45 text-amber-600";
  }
  if (tone === "watch") {
    return "border-yellow-500/45 text-yellow-600";
  }
  if (tone === "good") {
    return "border-emerald-500/45 text-emerald-600";
  }

  return "border-[var(--panel-border)]/45 text-muted-foreground";
}

export function toneDotClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "bg-destructive";
  }
  if (tone === "warn") {
    return "bg-amber-500";
  }
  if (tone === "watch") {
    return "bg-yellow-500";
  }
  if (tone === "good") {
    return "bg-emerald-500";
  }

  return "bg-muted-foreground";
}

export function toneValueClassName(tone: SignalTone) {
  if (tone === "bad") {
    return "text-destructive";
  }
  if (tone === "warn") {
    return "text-amber-500";
  }
  if (tone === "watch") {
    return "text-yellow-500";
  }
  if (tone === "good") {
    return "text-emerald-500";
  }

  return "text-muted-foreground";
}

export function impactTone(risk: string): SignalTone {
  if (risk === "High") {
    return "bad";
  }
  if (risk === "Medium") {
    return "warn";
  }
  if (risk === "Low risk") {
    return "good";
  }
  if (risk === "Unknown") {
    return "warn";
  }

  return "muted";
}

export function cleanVerdictLabel(verdict: string) {
  return verdict.replace(/\*/g, "").trim() || "Pending";
}

export function getSecurityRiskTone(
  verdict: string,
  fallbackRisk: string,
): SignalTone {
  const label = cleanVerdictLabel(verdict).toLowerCase();

  if (label.includes("critical") || label.includes("high")) {
    return "bad";
  }
  if (label.includes("medium")) {
    return "warn";
  }
  if (label.includes("low")) {
    return "good";
  }

  return impactTone(fallbackRisk);
}
