import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const COMPOSER_SOURCES = [
  "composer-panel.tsx",
  "composer-policy-summary.tsx",
  "composer-run-settings.tsx",
  "composer-attachments.tsx",
  "composer-permission-prompt.tsx",
  "composer-core-input.tsx",
] as const;

async function readComposerSurface() {
  const sources = COMPOSER_SOURCES.map((file) => {
    const path = fileURLToPath(new URL(file, import.meta.url));
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  });
  return sources.join("\n");
}

test("composer preserves canonical run payload options", async () => {
  const source = await readComposerSurface();

  for (const field of [
    "reasoningEnabled:",
    "reasoning:",
    "pathKind:",
    "access:",
    "serviceTier,",
    "runbookId:",
    "attachments:",
  ]) {
    assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("composer keeps policy approval actions visible and wired", async () => {
  const source = await readComposerSurface();

  assert.match(source, /Approval required/);
  assert.match(source, /Review command/);
  assert.match(source, /Approve once/);
  assert.match(source, /onResolvePolicyStop/);
  assert.match(source, /approve_once/);
  assert.match(source, /safer_alternative/);
});

test("composer keeps scoped trust choices and direct cancellation", async () => {
  const source = await readComposerSurface();

  assert.match(source, /Plan only/);
  assert.match(source, /Ask before changes/);
  assert.match(source, /Scoped changes/);
  assert.match(source, /cancelActiveRun/);
  assert.match(source, /handleCancelRun/);
  assert.match(source, /Attach files/);
});

test("composer keyboard order stays objective, essentials, then Run", async () => {
  const source = await readComposerSurface();
  const objective = source.indexOf("<ComposerCoreInput");
  const attachment = source.indexOf('aria-label="Attach files"');
  const settings = source.indexOf("<ComposerRunSettings");
  const run = source.indexOf('aria-label={isRunning ? "Stop" : "Run"}');

  assert.ok(objective >= 0);
  assert.ok(attachment > objective);
  assert.ok(settings > attachment);
  assert.ok(run > settings);
  assert.doesNotMatch(source, /Voice input/);
});
