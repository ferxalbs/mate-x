import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("proof product integration", () => {
  test("router and sidebar expose Proof Mode in MaTE X shell", async () => {
    const router = await readFile("src/router.tsx", "utf8");
    const sidebar = await readFile("src/features/desktop-shell/components/app-sidebar.tsx", "utf8");

    assert.match(router, /path: '\/proof'/);
    assert.match(sidebar, /Proof Mode/);
  });

  test("client code does not expose GitHub token env vars", async () => {
    const proofPage = await readFile("src/features/proof/proof-page.tsx", "utf8");
    const githubBoundary = await readFile("src/features/proof/proof-github-boundary.ts", "utf8");

    assert.equal(proofPage.includes("VITE_GITHUB_TOKEN"), false);
    assert.equal(proofPage.includes("GITHUB_TOKEN"), false);
    assert.equal(githubBoundary.includes("VITE_GITHUB_TOKEN"), false);
    assert.equal(githubBoundary.includes("GITHUB_TOKEN"), false);
  });
});
