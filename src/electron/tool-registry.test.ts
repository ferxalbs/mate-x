import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { lazyToolLoaders } from "./tool-registry";

describe("tool registry", () => {
  test("has no duplicate registry keys", () => {
    const keys = lazyToolLoaders.map(([name]) => name);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("registers canonical aliases for known historical mismatches", () => {
    const keys = new Set(lazyToolLoaders.map(([name]) => name));
    const required = [
      "git",
      "git_diag",
      "secrets",
      "secret_scan",
      "metadata",
      "file_metadata",
      "audit",
      "security_audit",
      "deps",
      "dependency_check",
      "pdf_report",
      "pdf_security_report",
    ];
    for (const key of required) {
      assert.equal(keys.has(key), true, `missing registry key: ${key}`);
    }
  });

  test("resolves alias and canonical keys to the same tool instance shape", async () => {
    const byKey = new Map(lazyToolLoaders);
    const git = await byKey.get("git")!();
    const gitDiag = await byKey.get("git_diag")!();
    assert.equal(git.name, "git_diag");
    assert.equal(gitDiag.name, "git_diag");
    assert.equal(typeof git.execute, "function");

    const secrets = await byKey.get("secrets")!();
    const secretScan = await byKey.get("secret_scan")!();
    assert.equal(secrets.name, secretScan.name);
  });
});
