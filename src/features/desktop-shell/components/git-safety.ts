export type GitSafetyAction = "commit" | "commit-push" | "push-pr" | "push";

export interface GitSafetyState {
  validated?: boolean;
  status?: string;
}

export function shouldGateGitAction(
  action: GitSafetyAction,
  state: GitSafetyState | undefined,
) {
  if (!["commit", "commit-push", "push-pr", "push"].includes(action)) {
    return false;
  }

  return state?.validated !== true;
}

export function getGitGateBlockedCopy() {
  return {
    reason: "Blocked because this change has no proof yet.",
    primaryCta: "Run Factory verification",
  };
}
