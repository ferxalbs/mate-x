import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

const TRUST_SELECTOR_SOURCES = [
  new URL("../features/desktop-shell/components/composer-panel.tsx", import.meta.url),
  new URL("../features/onboarding/onboarding-flow.tsx", import.meta.url),
  new URL("./settings-trust-section.tsx", import.meta.url),
];

test("workspace trust selectors expose only scoped profiles", () => {
  const removedProfile = ["Un", "restricted"].join("");
  const removedAccessLabel = ["Full", "access"].join(" ");

  for (const sourceUrl of TRUST_SELECTOR_SOURCES) {
    const source = readFileSync(sourceUrl, "utf8");

    assert.doesNotMatch(
      source,
      new RegExp(`value=["']${removedProfile.toLowerCase()}["']`, "i"),
    );
    assert.doesNotMatch(
      source,
      new RegExp(`>\\s*(?:${removedProfile}|${removedAccessLabel})\\s*<`, "i"),
    );
    assert.match(source, /Plan only/);
    assert.match(source, /Ask before changes/);
    assert.match(source, /Scoped changes/);
  }
});
