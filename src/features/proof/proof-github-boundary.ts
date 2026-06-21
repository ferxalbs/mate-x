import type { ProofChangedFile, ProofInput, ProofRepoRef } from "../../../packages/proof-core/src";

export type ProofGitHubResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_configured" | "not_found" | "rate_limited" | "network_error"; message: string };

export interface WorkspaceRepository {
  id: string;
  name: string;
  path: string;
  provider: "local" | "github";
  github?: ProofRepoRef;
}

export interface ProofGitHubIntegration {
  listWorkspaceRepos(workspaceId: string): Promise<ProofGitHubResult<WorkspaceRepository[]>>;
  getPullRequest(repositoryId: string, pullRequestNumber: number): Promise<ProofGitHubResult<ProofInput>>;
  getPullRequestFiles(repositoryId: string, pullRequestNumber: number): Promise<ProofGitHubResult<ProofChangedFile[]>>;
  getPullRequestChecks(repositoryId: string, pullRequestNumber: number): Promise<ProofGitHubResult<string[]>>;
  createProofCheckRun(repositoryId: string, capsuleId: string): Promise<ProofGitHubResult<{ checkRunId: string }>>;
  commentProofResult(repositoryId: string, pullRequestNumber: number, capsuleId: string): Promise<ProofGitHubResult<{ commentId: string }>>;
}

export function createMateXGitHubIntegration(workspace: { id: string; name: string; path: string } | null): ProofGitHubIntegration {
  return {
    async listWorkspaceRepos(workspaceId) {
      if (!workspace || workspace.id !== workspaceId) {
        return { ok: true, value: [] };
      }

      return {
        ok: true,
        value: [{ id: workspace.id, name: workspace.name, path: workspace.path, provider: "local" }],
      };
    },
    async getPullRequest() {
      return notConfigured("GitHub App installation not connected for this workspace.");
    },
    async getPullRequestFiles() {
      return notConfigured("GitHub App installation not connected for this workspace.");
    },
    async getPullRequestChecks() {
      return notConfigured("GitHub Checks integration not connected for this workspace.");
    },
    async createProofCheckRun() {
      return notConfigured("GitHub Checks integration not connected for this workspace.");
    },
    async commentProofResult() {
      return notConfigured("GitHub PR comments integration not connected for this workspace.");
    },
  };
}

function notConfigured(message: string): ProofGitHubResult<never> {
  return { ok: false, reason: "not_configured", message };
}
