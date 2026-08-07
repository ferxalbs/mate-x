import assert from "node:assert/strict";
import { describe, mock, test } from "bun:test";
import { createHash } from "node:crypto";

mock.module("electron", (() => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp/matex-privacy-model-test",
  },
})) as any);

const {
  isPinnedModelRevision,
  verifyPrivacyModelAsset,
} = await import("./privacy-model-loader");

describe("privacy model supply-chain verification", () => {
  test("accepts immutable revisions and rejects mutable refs", () => {
    assert.equal(isPinnedModelRevision("c49fa626439c153644585e59a89ab1b7a0d8b863"), true);
    assert.equal(isPinnedModelRevision("main"), false);
    assert.equal(isPinnedModelRevision("v0.15"), false);
  });

  test("verifies downloaded assets against the pinned SHA-256", () => {
    const bytes = Buffer.from("trusted model asset", "utf8");
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(verifyPrivacyModelAsset("model.onnx", bytes, expected), expected);
    assert.throws(
      () => verifyPrivacyModelAsset("model.onnx", bytes, "0".repeat(64)),
      /SHA-256 verification/,
    );
    assert.throws(
      () => verifyPrivacyModelAsset("model.onnx", bytes, undefined),
      /no valid SHA-256/i,
    );
  });
});
