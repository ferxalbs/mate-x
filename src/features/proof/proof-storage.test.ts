import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { generateProofCapsule } from "../../../packages/proof-core/src";
import { serverProofStorageAdapter } from "./proof-storage";

describe("proof storage", () => {
  test("persists Proof Capsule through MaTE X storage adapter", async () => {
    const capsule = generateProofCapsule({
      sourceType: "manual",
      workspaceId: "workspace-storage",
      projectId: "project-storage",
      repositoryId: "repo-storage",
      createdByUserId: "user-storage",
      changedFiles: [{ path: "src/auth/session.ts" }],
      ciOutput: "bun run test passed",
    });

    const saved = await serverProofStorageAdapter.saveCapsule(capsule);
    const listed = await serverProofStorageAdapter.listCapsules("workspace-storage");

    assert.equal(saved.ok, true);
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal(listed.value[0].workspaceId, "workspace-storage");
  });

  test("redacted secrets are persisted, raw secret patch is not", async () => {
    const capsule = generateProofCapsule({
      sourceType: "manual",
      workspaceId: "workspace-redact",
      projectId: "project-redact",
      repositoryId: "repo-redact",
      createdByUserId: "user-redact",
      changedFiles: [{
        path: "src/config.ts",
        patch: "+ const token = 'ghp_1234567890abcdefghijklmnop'",
      }],
      ciOutput: "bun run test passed",
    });

    await serverProofStorageAdapter.saveCapsule(capsule);
    const stored = await serverProofStorageAdapter.getCapsule("workspace-redact", capsule.id);

    assert.equal(stored.ok, true);
    if (stored.ok) {
      const serialized = JSON.stringify(stored.value);
      assert.equal(serialized.includes("ghp_1234567890abcdefghijklmnop"), false);
      assert.equal(serialized.includes("[redacted-secret]"), true);
      assert.equal(stored.value.privacyPreflightResult.status, "redacted");
    }
  });
});
