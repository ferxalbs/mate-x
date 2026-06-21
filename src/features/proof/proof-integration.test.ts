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
    const settingsPage = await readFile("src/routes/settings-page.tsx", "utf8");
    const preload = await readFile("src/preload.ts", "utf8");

    assert.equal(proofPage.includes("VITE_GITHUB_TOKEN"), false);
    assert.equal(proofPage.includes("GITHUB_TOKEN"), false);
    assert.equal(settingsPage.includes("VITE_GITHUB_TOKEN"), false);
    assert.equal(settingsPage.includes("GITHUB_TOKEN"), false);
    assert.equal(preload.includes("VITE_GITHUB_TOKEN"), false);
    assert.equal(preload.includes("GITHUB_TOKEN"), false);
  });

  test("settings integrations exposes GitHub as normal MaTE X integration", async () => {
    const settingsPage = await readFile("src/routes/settings-page.tsx", "utf8");
    const settingsContract = await readFile("src/contracts/settings.ts", "utf8");

    assert.match(settingsPage, /title="GitHub"/);
    assert.match(settingsPage, /Proof Mode, evidence checks, and PR verification/);
    assert.match(settingsContract, /githubIntegrationEnabled/);
  });

  test("Proof Mode consumes local GitHub evidence through MaTE X IPC", async () => {
    const proofPage = await readFile("src/features/proof/proof-page.tsx", "utf8");

    assert.match(proofPage, /window\.mate\.github\.collectLocalEvidence/);
    assert.match(proofPage, /sourceIntegration/);
    assert.match(proofPage, /local_only/);
  });
});
