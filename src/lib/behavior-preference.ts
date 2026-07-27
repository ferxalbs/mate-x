import {
  BEHAVIOR_MODES,
  DEFAULT_BEHAVIOR_PREFERENCE,
  type BehaviorPreference,
} from "../contracts/behavior-mode";

const PREFIX = "mate-x:behavior:";

export function loadBehaviorPreference(workspaceId: string): BehaviorPreference {
  if (!workspaceId || typeof window === "undefined") return DEFAULT_BEHAVIOR_PREFERENCE;
  try {
    const value = JSON.parse(window.localStorage.getItem(`${PREFIX}${workspaceId}`) ?? "null");
    if (!value) return DEFAULT_BEHAVIOR_PREFERENCE;
    const legacyMode = value.mode as string;
    const mode: unknown =
      legacyMode === "auto" || legacyMode === "custom"
        ? "execute"
        : legacyMode === "guided"
          ? "plan"
          : legacyMode;
    if (
      typeof mode !== "string" ||
      !BEHAVIOR_MODES.includes(mode as (typeof BEHAVIOR_MODES)[number])
    ) {
      return DEFAULT_BEHAVIOR_PREFERENCE;
    }
    return { mode: mode as (typeof BEHAVIOR_MODES)[number] };
  } catch {
    return DEFAULT_BEHAVIOR_PREFERENCE;
  }
}

export function saveBehaviorPreference(workspaceId: string, value: BehaviorPreference) {
  if (!workspaceId || typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}${workspaceId}`, JSON.stringify(value));
}
