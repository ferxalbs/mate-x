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
    "serviceTier,",
    "attachments:",
  ]) {
    assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /pathKind:\s*["']full["']/);
  assert.doesNotMatch(source, /access:\s*["']approval["']/);
  assert.doesNotMatch(source, /runbookId:\s*["']patch_test_verify["']/);
});

test("composer keeps policy approval actions visible and wired", async () => {
  const source = await readComposerSurface();

  assert.match(source, /Approval required/);
  assert.match(source, /Cancel/);
  assert.match(source, /Approve once/);
  assert.match(source, /onResolvePolicyStop/);
  assert.match(source, /approve_once/);
  assert.match(source, /safer_alternative/);
});

test("composer keeps scoped trust choices and direct cancellation", async () => {
  const source = await readComposerSurface();

  assert.match(source, /Read only/);
  assert.match(source, /Ask before changes/);
  assert.match(source, /Workspace changes/);
  assert.match(source, /cancelActiveRun/);
  assert.match(source, /handleCancelRun/);
  assert.match(source, /Attach files/);
});

test("composer reflects a model activated outside its route tree", async () => {
  const source = await readComposerSurface();

  assert.match(source, /subscribeToModelChanges/);
  assert.match(source, /setModelValue\(nextModel\)/);
  assert.match(source, /listModels\(true\)/);
  assert.match(source, /listModelLaunches\(true\)/);
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
