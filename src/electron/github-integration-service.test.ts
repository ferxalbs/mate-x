import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  detectGitHubRemote,
  getChangedFiles,
  getCurrentBranch,
  getLocalDiff,
  getPullRequestChecks,
  getPullRequestFiles,
  getPullRequestForBranch,
  parseChangedFiles,
  parseGitHubRemote,
} from "./github-integration-service";

const execFileAsync = promisify(execFile);

describe("GitHub integration service", () => {
  test("parses GitHub remotes", () => {
    assert.deepEqual(parseGitHubRemote("git@github.com:owner/repo.git"), {
      owner: "owner",
      repo: "repo",
      remoteUrl: "git@github.com:owner/repo.git",
    });
    assert.equal(parseGitHubRemote("https://gitlab.com/owner/repo.git"), null);
  });

  test("parses changed files from git name-status output", () => {
    assert.deepEqual(parseChangedFiles("M\tsrc/a.ts\nA\tsrc/b.ts\nR100\told.ts\tnew.ts\n"), [
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
      { path: "new.ts", status: "renamed" },
    ]);
  });

  test("detects GitHub owner/repo, branch, diff, and changed files from local repo", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "matex-github-"));
    try {
      await git(repoPath, ["init"]);
      await git(repoPath, ["config", "user.email", "matex@example.invalid"]);
      await git(repoPath, ["config", "user.name", "MaTE X"]);
      await writeFile(join(repoPath, "README.md"), "one\n", "utf8");
      await git(repoPath, ["add", "README.md"]);
      await git(repoPath, ["commit", "-m", "init"]);
      await git(repoPath, ["remote", "add", "origin", "https://github.com/acme/widgets.git"]);
      await git(repoPath, ["checkout", "-b", "feature/proof"]);
      await writeFile(join(repoPath, "README.md"), "one\ntwo\n", "utf8");

      const remote = await detectGitHubRemote(repoPath);
      const branch = await getCurrentBranch(repoPath);
      const diff = await getLocalDiff(repoPath);
      const files = await getChangedFiles(repoPath);

      assert.equal(remote.ok, true);
      if (remote.ok) assert.deepEqual({ owner: remote.value.owner, repo: remote.value.repo }, { owner: "acme", repo: "widgets" });
      assert.deepEqual(branch, { ok: true, value: "feature/proof" });
      assert.equal(diff.ok, true);
      if (diff.ok) assert.match(diff.value, /\+two/);
      assert.equal(files.ok, true);
      if (files.ok) assert.deepEqual(files.value, [{ path: "README.md", status: "modified" }]);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  test("network-backed functions return not_configured", async () => {
    const pr = await getPullRequestForBranch();
    const files = await getPullRequestFiles();
    const checks = await getPullRequestChecks();

    assert.equal(pr.ok, false);
    assert.equal(files.ok, false);
    assert.equal(checks.ok, false);
    if (!pr.ok) assert.equal(pr.reason, "not_configured");
    if (!files.ok) assert.equal(files.reason, "not_configured");
    if (!checks.ok) assert.equal(checks.reason, "not_configured");
  });
});

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}
