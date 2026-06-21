import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { createMateXGitHubIntegration } from "./proof-github-boundary";

describe("proof GitHub boundary", () => {
  test("lists current MaTE X workspace repository without browser token", async () => {
    const github = createMateXGitHubIntegration({
      id: "workspace-1",
      name: "mate-x",
      path: "/repo",
    });

    const result = await github.listWorkspaceRepos("workspace-1");

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value[0].provider, "local");
  });

  test("private GitHub operations fail as not_configured until GitHub App exists", async () => {
    const github = createMateXGitHubIntegration(null);
    const result = await github.getPullRequest("repo-1", 12);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_configured");
  });
});
