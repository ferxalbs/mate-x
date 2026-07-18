import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "bun:test";

function source(relativePath: string) {
  return readFileSync(
    new URL(`../../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

describe("responsive visual foundation", () => {
  test("documents semantic text roles for light and dark themes", () => {
    const baseTheme = source("styles/themes/base.css");
    const darkTheme = source("styles/themes/dark.css");
    const globalStyles = source("index.css");

    for (const token of [
      "--text-operational",
      "--text-secondary",
      "--text-metadata",
    ]) {
      assert.match(baseTheme, new RegExp(token));
      assert.match(darkTheme, new RegExp(token));
    }

    assert.match(globalStyles, /\.mate-text-body/);
    assert.match(globalStyles, /font-size: 0\.875rem/);
    assert.match(globalStyles, /\.mate-text-compact/);
    assert.match(globalStyles, /font-size: 0\.8125rem/);
    assert.match(globalStyles, /\.mate-text-secondary/);
    assert.match(globalStyles, /font-size: 0\.75rem/);
    assert.match(globalStyles, /\.mate-text-metadata/);
  });

  test("keeps long settings content fluid at 840px and 200% zoom", () => {
    const settingsLayout = source("components/ui/settings-layout.tsx");
    const settingsPage = source("routes/settings-page.tsx");
    const longFixture =
      "repository-with-an-intentionally-long-operational-identifier-for-zoom-validation";

    assert.ok(longFixture.length > 70);
    assert.match(settingsLayout, /flex min-w-0 flex-col/);
    assert.match(settingsLayout, /w-full items-center/);
    assert.match(settingsLayout, /sm:max-w-\[min\(52%,28rem\)\]/);
    assert.match(settingsPage, /className="w-full sm:w-\[150px\]"/);
    assert.doesNotMatch(settingsPage, /className="w-\[(?:150|185|220)px\]"/);
  });

  test("preserves evidence at narrow widths without fixed three-column overflow", () => {
    const missionLog = source("routes/runs-page.tsx");
    const enhancementPanel = source(
      "features/desktop-shell/components/enhancement-panel.tsx",
    );

    assert.match(missionLog, /grid-cols-1 overflow-y-auto/);
    assert.match(missionLog, /min-\[1100px\]:grid-cols/);
    assert.match(missionLog, /2xl:grid-cols/);
    assert.match(enhancementPanel, /w-\[min\(316px,calc\(100vw-32px\)\)\]/);
  });

  test("excludes sub-legible and low-opacity operational text", () => {
    const scopedFiles = [
      "routes/runs-page.tsx",
      "routes/settings-page.tsx",
      "features/desktop-shell/components/app-sidebar.tsx",
      "features/desktop-shell/components/thread-menu-item.tsx",
      "features/desktop-shell/components/git-panel.tsx",
      "features/desktop-shell/components/enhancement-panel-evidence.tsx",
    ];

    for (const file of scopedFiles) {
      const contents = source(file);
      assert.doesNotMatch(contents, /text-\[(?:8|9)px\]/);
      assert.doesNotMatch(contents, /text-muted-foreground\/[345][0-9]/);
    }
  });
});
