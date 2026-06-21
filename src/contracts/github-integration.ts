export type GitHubIntegrationState =
  | "disabled"
  | "enabled_not_configured"
  | "configured"
  | "error"
  | "local_only";

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  remoteUrl: string;
}

export interface GitHubChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
}

export interface GitHubLocalEvidence {
  repository: GitHubRepositoryRef | null;
  branch: string | null;
  diff: string;
  changedFiles: GitHubChangedFile[];
}

export type GitHubIntegrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "disabled" | "not_configured" | "not_git_repo" | "not_github_remote" | "error"; message: string };

export interface GitHubIntegrationStatus {
  state: GitHubIntegrationState;
  repository: GitHubRepositoryRef | null;
  branch: string | null;
  message: string;
}

export interface GitHubPullRequestSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
}

export interface GitHubCheckSummary {
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
}
