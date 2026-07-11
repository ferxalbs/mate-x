export type GitSafetyAction = "commit" | "commit-push" | "push-pr" | "push";

/** Mirror of main-process GitGateEvaluation — never authoritative alone. */
export interface GitSafetyState {
  validated?: boolean;
  status?: string;
  code?: string;
  message?: string;
  proofHandle?: string | null;
}

export function shouldGateGitAction(
  action: GitSafetyAction,
  state: GitSafetyState | undefined,
) {
  if (!["commit", "commit-push", "push-pr", "push"].includes(action)) {
    return false;
  }

  // Fail closed: only explicit main-process-mirrored validated=true unlocks UI.
  return state?.validated !== true;
}

export function getGitGateBlockedCopy() {
  return {
    reason: "Blocked because this change has no proof yet.",
    primaryCta: "Run verification",
  };
}
