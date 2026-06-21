import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitHubChangedFile,
  GitHubCheckSummary,
  GitHubIntegrationResult,
  GitHubIntegrationStatus,
  GitHubLocalEvidence,
  GitHubPullRequestSummary,
  GitHubRepositoryRef,
} from "../contracts/github-integration";

const execFileAsync = promisify(execFile);

export async function detectGitHubRemote(workspacePath: string): Promise<GitHubIntegrationResult<GitHubRepositoryRef>> {
  const remote = await git(workspacePath, ["remote", "get-url", "origin"]);
  if (!remote.ok) return remote.reason === "error" ? fail("not_git_repo", "No git origin remote found.") : remote;

  const repository = parseGitHubRemote(remote.value.trim());
  if (!repository) return fail("not_github_remote", "Origin remote is not a GitHub repository.");
  return ok(repository);
}

export async function getCurrentBranch(workspacePath: string): Promise<GitHubIntegrationResult<string>> {
  const branch = await git(workspacePath, ["branch", "--show-current"]);
  if (!branch.ok) return branch;
  const value = branch.value.trim();
  return value ? ok(value) : fail("error", "Detached HEAD or no current branch.");
}

export async function getLocalDiff(workspacePath: string): Promise<GitHubIntegrationResult<string>> {
  const diff = await git(workspacePath, ["diff", "--no-ext-diff", "--", "."]);
  return diff.ok ? ok(diff.value) : diff;
}

export async function getChangedFiles(workspacePath: string): Promise<GitHubIntegrationResult<GitHubChangedFile[]>> {
  const changed = await git(workspacePath, ["diff", "--name-status", "--", "."]);
  if (!changed.ok) return changed;
  return ok(parseChangedFiles(changed.value));
}

export async function collectGitHubLocalEvidence(workspacePath: string): Promise<GitHubIntegrationResult<GitHubLocalEvidence>> {
  const [repository, branch, diff, changedFiles] = await Promise.all([
    detectGitHubRemote(workspacePath),
    getCurrentBranch(workspacePath),
    getLocalDiff(workspacePath),
    getChangedFiles(workspacePath),
  ]);

  if (!diff.ok) return diff;
  if (!changedFiles.ok) return changedFiles;

  return ok({
    repository: repository.ok ? repository.value : null,
    branch: branch.ok ? branch.value : null,
    diff: diff.value,
    changedFiles: changedFiles.value,
  });
}

export async function getIntegrationStatus(workspacePath: string, enabled: boolean): Promise<GitHubIntegrationStatus> {
  if (!enabled) {
    return { state: "disabled", repository: null, branch: null, message: "GitHub integration disabled." };
  }

  const evidence = await collectGitHubLocalEvidence(workspacePath);
  if (!evidence.ok) {
    return { state: "error", repository: null, branch: null, message: evidence.message };
  }

  if (!evidence.value.repository) {
    return {
      state: "enabled_not_configured",
      repository: null,
      branch: evidence.value.branch,
      message: "Enabled, but current workspace has no GitHub origin remote.",
    };
  }

  return {
    state: "local_only",
    repository: evidence.value.repository,
    branch: evidence.value.branch,
    message: "Local git evidence available. GitHub network metadata not configured.",
  };
}

export async function getPullRequestForBranch(): Promise<GitHubIntegrationResult<GitHubPullRequestSummary>> {
  return fail("not_configured", "GitHub network auth not configured. Local git evidence still works.");
}

export async function getPullRequestFiles(): Promise<GitHubIntegrationResult<GitHubChangedFile[]>> {
  return fail("not_configured", "GitHub PR file API not configured. Use local changed files.");
}

export async function getPullRequestChecks(): Promise<GitHubIntegrationResult<GitHubCheckSummary[]>> {
  return fail("not_configured", "GitHub checks API not configured. Use local validation output.");
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepositoryRef | null {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const ssh = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2], remoteUrl };

  const https = normalized.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (https) return { owner: https[1], repo: https[2], remoteUrl };

  const gh = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/);
  if (gh) return { owner: gh[1], repo: gh[2], remoteUrl };

  return null;
}

export function parseChangedFiles(output: string): GitHubChangedFile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, firstPath, secondPath] = line.split(/\t+/);
      const statusCode = rawStatus.charAt(0);
      const status: GitHubChangedFile["status"] =
        statusCode === "A" ? "added" :
        statusCode === "M" ? "modified" :
        statusCode === "D" ? "deleted" :
        statusCode === "R" ? "renamed" :
        "unknown";
      return {
        path: secondPath || firstPath || "",
        status,
      };
    })
    .filter((file) => file.path.length > 0);
}

async function git(workspacePath: string, args: string[]): Promise<GitHubIntegrationResult<string>> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: workspacePath,
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15_000,
    });
    return ok(result.stdout);
  } catch (error) {
    return fail("error", error instanceof Error ? error.message : "Git command failed.");
  }
}

function ok<T>(value: T): GitHubIntegrationResult<T> {
  return { ok: true, value };
}

function fail<T>(reason: Exclude<GitHubIntegrationResult<T>, { ok: true }>["reason"], message: string): GitHubIntegrationResult<T> {
  return { ok: false, reason, message };
}
