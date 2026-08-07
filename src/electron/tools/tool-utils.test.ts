import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  clampNumber,
  isPathInsideRoot,
  limitTextOutput,
  resolveWorkspacePath,
  resolveWorkspacePathForRead,
  resolveWorkspacePathForWrite,
  writeWorkspaceFileSecure,
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

describe("canonical workspace filesystem boundary", () => {
  test("rejects reads through a symlink that escapes the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "matex-tool-utils-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "matex-tool-utils-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "outside secret");
      await symlink(outside, join(workspace, "linked"));

      await assert.rejects(
        () => resolveWorkspacePathForRead(workspace, "linked/secret.txt"),
        /outside the active workspace/,
      );
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  test("rejects writes through a symlink and leaves the outside target unchanged", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "matex-tool-utils-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "matex-tool-utils-outside-"));
    try {
      const outsideFile = join(outside, "target.txt");
      await writeFile(outsideFile, "outside original");
      await symlink(outsideFile, join(workspace, "target.txt"));

      await assert.rejects(
        () => resolveWorkspacePathForWrite(workspace, "target.txt"),
        /symbolic link|outside the active workspace/,
      );
      await assert.rejects(
        () => writeWorkspaceFileSecure(workspace, "target.txt", "must not write"),
        /symbolic link|outside the active workspace/,
      );
      assert.equal(await readFile(outsideFile, "utf8"), "outside original");
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  test("atomically writes a regular file after canonical revalidation", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "matex-tool-utils-workspace-"));
    try {
      await writeWorkspaceFileSecure(workspace, "nested/result.txt", "safe", {
        createDirectories: true,
      });
      assert.equal(await readFile(join(workspace, "nested/result.txt"), "utf8"), "safe");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
