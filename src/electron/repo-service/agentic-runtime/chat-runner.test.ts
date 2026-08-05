import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, mock, test } from "bun:test";

process.env.RAINY_API_BASE_URL ??= "https://rainy.test";

(mock as any).module("electron", () => ({
  app: {
    getPath: () => tmpdir(),
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => false,
  },
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: () => undefined,
  },
}));

const { projectVisibleAssistantPass } = await import("./chat-runner");

describe("chat runner public draft projection", () => {
  test("a second pass stream does not prepend the previous completed draft", () => {
    const previousPass = "This is acme-demo. The first pass is complete.";
    const currentPassStream = "Architecture: services call the mocked SDK.";
    const visibleContent = projectVisibleAssistantPass(currentPassStream);

    assert.equal(visibleContent, currentPassStream);
    assert.doesNotMatch(visibleContent, new RegExp(previousPass));
  });
});
