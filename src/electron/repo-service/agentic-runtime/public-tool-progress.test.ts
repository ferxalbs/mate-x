import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { createPublicToolProgress } from "./public-tool-progress";

describe("public tool progress", () => {
  test("maps tool names to compact public statuses without arguments", () => {
    assert.deepEqual(createPublicToolProgress("read_many"), {
      detail: "",
      label: "Reading files",
      segmentKind: "tool",
      status: "active",
      type: "read",
      visibility: "public",
    });
    assert.equal(createPublicToolProgress("rg").label, "Searching repository");
    assert.equal(createPublicToolProgress("file_editor").label, "Editing files");
    assert.equal(createPublicToolProgress("run_tests").label, "Running validation");
    assert.equal(
      createPublicToolProgress("custom_workspace_tool").label,
      "Running workspace action",
    );
    assert.equal(createPublicToolProgress("read_many").detail, "");
  });
});
