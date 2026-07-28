import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const viteMainConfig = readFileSync("vite.main.config.ts", "utf8");

describe("Vite main-process configuration", () => {
  it("keeps dynamic imports in main.js so rebuilds cannot delete live chunks", () => {
    assert.match(viteMainConfig, /codeSplitting:\s*false/);
  });
});
