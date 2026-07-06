import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, mock, test } from "bun:test";

(mock as any).module("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? resolve(tmpdir(), "matex-user-data") : tmpdir()),
  },
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: () => undefined,
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => false,
  },
}));

const {
  parseEvidencePackDirectory,
  parseFailureMemoryImportPath,
  parsePublicKeyPem,
  parseStoragePrefix,
  parseWorkspaceId,
} = await import("./guards");

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1234567890abcdefghijklmnopqrstuvwxyz==
-----END PUBLIC KEY-----`;

describe("ipc guards", () => {
  test("parseWorkspaceId rejects malformed ids", () => {
    assert.throws(() => parseWorkspaceId("../workspace"), /Invalid workspaceId/);
    assert.equal(parseWorkspaceId(" workspace-1 "), "workspace-1");
  });

  test("parseStoragePrefix rejects traversal and absolute prefixes", () => {
    assert.throws(() => parseStoragePrefix("../packs"), /safe relative key prefix/);
    assert.throws(() => parseStoragePrefix("/absolute"), /safe relative key prefix/);
    assert.equal(parseStoragePrefix("evidence-packs/"), "evidence-packs/");
  });

  test("parseFailureMemoryImportPath only allows temp or app-data zip archives", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "matex-guards-"));
    try {
      const zipPath = join(tempDir, "failure-memory.zip");
      assert.equal(parseFailureMemoryImportPath(zipPath), zipPath);
      assert.throws(() => parseFailureMemoryImportPath("/etc/passwd"), /temp or app data/);
      assert.throws(() => parseFailureMemoryImportPath(join(tempDir, "notes.txt")), /\.zip archive/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parseEvidencePackDirectory requires workspace evidence folders", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "matex-evidence-storage-"));
    try {
      assert.equal(parseEvidencePackDirectory(tempDir), tempDir);

      const workspaceEvidence = join(tmpdir(), "repo", ".mate-x", "evidence", "task-1");
      assert.equal(parseEvidencePackDirectory(workspaceEvidence), workspaceEvidence);

      assert.throws(
        () => parseEvidencePackDirectory("/tmp/random-folder"),
        /workspace \.mate-x\/evidence task folder/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("parsePublicKeyPem validates PEM envelope", () => {
    assert.equal(parsePublicKeyPem(PUBLIC_KEY_PEM), PUBLIC_KEY_PEM);
    assert.throws(() => parsePublicKeyPem("not-a-key"), /Invalid public key PEM/);
  });
});
