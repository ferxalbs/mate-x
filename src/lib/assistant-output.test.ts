import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  sanitizeAssistantOutput,
  sanitizePublicProgress,
} from "./assistant-output";

describe("assistant output boundary", () => {
  test("removes serialized tool calls from assistant text", () => {
    assert.equal(
      sanitizeAssistantOutput(
        '{"call":"file_editor","arguments":{"path":"/private/a.ts"}}',
      ),
      "",
    );
  });

  test("redacts absolute paths from otherwise useful public progress", () => {
    const progress = sanitizePublicProgress(
      "Updated /Users/fer/project/src/runtime.ts and C:\\repo\\service.ts.",
    );

    assert.equal(progress.includes("/Users/fer"), false);
    assert.equal(progress.includes("C:\\repo"), false);
    assert.match(progress, /Updated \[relevant file\]/);
  });
});
