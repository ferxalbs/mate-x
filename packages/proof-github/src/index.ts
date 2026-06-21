import type { ProofChangedFile, ProofInput } from '../../proof-core/src';

export type GitHubFetchErrorCode = 'malformed-url' | 'rate-limited' | 'not-found' | 'private-repo' | 'network-failure';

export class GitHubFetchError extends Error {
  code: GitHubFetchErrorCode;

  constructor(code: GitHubFetchErrorCode, message: string) {
    super(message);
    this.name = 'GitHubFetchError';
    this.code = code;
  }
}

export interface ParsedPullRequestUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

interface GitHubPullRequestResponse {
  title?: string;
  head?: { sha?: string };
  base?: { sha?: string };
}

interface GitHubChangedFileResponse {
  filename: string;
  additions?: number;
  deletions?: number;
  status?: string;
  patch?: string;
}

export function parseGitHubPullRequestUrl(url: string): ParsedPullRequestUrl {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new GitHubFetchError('malformed-url', 'Enter a valid GitHub pull request URL.');
  }

  if (parsed.hostname !== 'github.com') {
    throw new GitHubFetchError('malformed-url', 'Only github.com pull request URLs are supported.');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const pullIndex = parts.indexOf('pull');
  const prNumber = Number(parts[pullIndex + 1]);
  if (parts.length < 4 || pullIndex !== 2 || !Number.isInteger(prNumber) || prNumber <= 0) {
    throw new GitHubFetchError('malformed-url', 'Use a URL like https://github.com/owner/repo/pull/123.');
  }

  return { owner: parts[0], repo: parts[1], prNumber };
}

function classifyStatus(status: number): GitHubFetchErrorCode {
  if (status === 403 || status === 429) return 'rate-limited';
  if (status === 401) return 'private-repo';
  if (status === 404) return 'not-found';
  return 'network-failure';
}

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const code = classifyStatus(response.status);
    throw new GitHubFetchError(code, `GitHub request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

function normalizeFiles(files: GitHubChangedFileResponse[]): ProofChangedFile[] {
  return files.map((file) => ({
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
    status: file.status,
    patch: file.patch,
  }));
}

export async function fetchGitHubPullRequestInput(url: string, token?: string): Promise<ProofInput> {
  const parsed = parseGitHubPullRequestUrl(url);
  const apiBase = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.prNumber}`;

  try {
    const [pr, files] = await Promise.all([
      githubJson<GitHubPullRequestResponse>(apiBase, token),
      githubJson<GitHubChangedFileResponse[]>(`${apiBase}/files?per_page=100`, token),
    ]);

    return {
      sourceType: 'github-pr',
      repo: { owner: parsed.owner, name: parsed.repo },
      prNumber: parsed.prNumber,
      prTitle: pr.title,
      headSha: pr.head?.sha,
      baseSha: pr.base?.sha,
      changedFiles: normalizeFiles(files),
    };
  } catch (error) {
    if (error instanceof GitHubFetchError) throw error;
    throw new GitHubFetchError('network-failure', 'Could not reach GitHub. Paste diff or file list manually.');
  }
}
