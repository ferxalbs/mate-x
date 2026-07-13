import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { execFileAbortable, spawnAbortable, killProcessTree } from "./process";

describe("abortable process helpers", () => {
  test("execFileAbortable rejects when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        execFileAbortable(process.execPath, ["-e", "setTimeout(()=>{}, 5000)"], {
          signal: controller.signal,
        }),
      (error: unknown) => (error as Error).name === "AbortError",
    );
  });

  test("execFileAbortable kills long work on abort", async () => {
    const controller = new AbortController();
    const pending = execFileAbortable(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 30);

    await assert.rejects(
      () => pending,
      (error: unknown) => (error as Error).name === "AbortError",
    );
  });

  test("spawnAbortable hard-kills on abort", async () => {
    const controller = new AbortController();
    const child = spawnAbortable(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal, detached: process.platform !== "win32" },
    );

    const closed = new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });

    controller.abort();
    // Fallback kill if platform race leaves process briefly alive.
    setTimeout(() => killProcessTree(child.pid), 100);
    await closed;
    assert.ok(true);
  });
});
