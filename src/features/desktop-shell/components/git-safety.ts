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
