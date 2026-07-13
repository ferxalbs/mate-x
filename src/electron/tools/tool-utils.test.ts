import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  clampNumber,
  isPathInsideRoot,
  limitTextOutput,
  resolveWorkspacePath,
} from "./tool-utils";

describe("resolveWorkspacePath / isPathInsideRoot", () => {
  const root = resolve("/tmp/mate-x-workspace-fixture");

  test("resolves relative paths inside the workspace", () => {
    assert.equal(
      resolveWorkspacePath(root, "src/app.ts"),
      resolve(root, "src/app.ts"),
    );
    assert.equal(resolveWorkspacePath(root, "."), root);
    assert.equal(resolveWorkspacePath(root, ""), root);
  });

  test("rejects parent traversal", () => {
    assert.throws(
      () => resolveWorkspacePath(root, "../outside"),
      /Path must remain within the active workspace/,
    );
    assert.throws(
      () => resolveWorkspacePath(root, "src/../../outside"),
      /Path must remain within the active workspace/,
    );
  });

  test("rejects absolute paths outside the workspace", () => {
    assert.throws(
      () => resolveWorkspacePath(root, "/etc/passwd"),
      /Path must remain within the active workspace/,
    );
  });

  test("accepts absolute paths that remain inside the workspace", () => {
    const inside = resolve(root, "nested/file.ts");
    assert.equal(resolveWorkspacePath(root, inside), inside);
  });

  test("rejects null bytes", () => {
    assert.throws(() => resolveWorkspacePath(root, "foo\0bar"), /Invalid path/);
  });

  test("does not treat filenames starting with .. as escapes", () => {
    const target = resolve(root, "..config");
    assert.equal(isPathInsideRoot(root, target), true);
    assert.equal(resolveWorkspacePath(root, "..config"), target);
  });

  test("isPathInsideRoot rejects parent of root", () => {
    assert.equal(isPathInsideRoot(root, resolve(root, "..")), false);
    assert.equal(isPathInsideRoot(root, join(root, "child")), true);
  });
});

describe("limitTextOutput / clampNumber", () => {
  test("limitTextOutput truncates with omitted count", () => {
    const out = limitTextOutput("abcdefghij", 4);
    assert.match(out, /^abcd\n\.\.\. \(truncated 6 characters\)$/);
  });

  test("clampNumber floors and bounds", () => {
    assert.equal(clampNumber(3.9, 1, 10, 5), 3);
    assert.equal(clampNumber(100, 1, 10, 5), 10);
    assert.equal(clampNumber("x", 1, 10, 5), 5);
    assert.equal(clampNumber(Number.NaN, 1, 10, 5), 5);
  });
});
