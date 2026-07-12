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
    if (!value || !BEHAVIOR_MODES.includes(value.mode)) return DEFAULT_BEHAVIOR_PREFERENCE;
    return {
      mode: value.mode,
      custom: { ...DEFAULT_BEHAVIOR_PREFERENCE.custom, ...value.custom },
    };
  } catch {
    return DEFAULT_BEHAVIOR_PREFERENCE;
  }
}

export function saveBehaviorPreference(workspaceId: string, value: BehaviorPreference) {
  if (!workspaceId || typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}${workspaceId}`, JSON.stringify(value));
}
