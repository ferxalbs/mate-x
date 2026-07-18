import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

function read(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

test("topbar exposes one verdict trigger without repository duplication", () => {
  const source = read("chat-topbar.tsx");

  assert.doesNotMatch(source, /workspace\.name/);
  assert.doesNotMatch(source, /mate:enhancement-panel-command/);
  assert.equal(source.match(/toggleLivePanel/g)?.length, 2);
  assert.match(source, /max-\[1024px\]:sr-only/);
  assert.match(source, /overflow-x-auto/);
});

test("responsive enhancement panel overlays before the wide static layout", () => {
  const source = read("enhancement-panel.tsx");

  assert.match(source, /fixed inset-y-0 right-0/);
  assert.match(source, /min-\[1275px\]:static/);
  assert.match(source, /w-\[min\(316px,calc\(100vw-32px\)\)\]/);
});

test("primary composer keeps one direct objective path", () => {
  const composer = read("composer-panel.tsx");
  const input = read("composer-core-input.tsx");

  assert.match(composer, /max-w-\[820px\]/);
  assert.match(composer, /aria-label=\{isRunning \? "Stop" : "Run"\}/);
  assert.doesNotMatch(composer, /Voice input/);
  assert.match(input, /What do you want to verify in/);
  assert.match(input, /truncate/);
});
