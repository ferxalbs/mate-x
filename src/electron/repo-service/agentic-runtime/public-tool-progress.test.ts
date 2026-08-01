import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { createPublicToolProgress } from "./public-tool-progress";

describe("public tool progress", () => {
  test("reports safe scope and results without raw arguments", () => {
    assert.deepEqual(createPublicToolProgress("read_many", {
      requests: [{ path: "/private/a.ts" }, { path: "/private/b.ts" }],
    }), {
      detail: "",
      label: "Reading 2 relevant files",
      segmentKind: "tool",
      status: "active",
      type: "read",
      visibility: "public",
    });
    assert.equal(createPublicToolProgress("rg").label, "Searching repository");
    assert.equal(createPublicToolProgress("file_editor").label, "Editing workspace file");
    assert.equal(
      createPublicToolProgress("run_tests", { command: "bun run typecheck" }).label,
      "Running typecheck",
    );
    assert.equal(
      createPublicToolProgress(
        "run_tests",
        { command: "bun run typecheck --project /private/path" },
        "completed",
      ).label,
      "Typecheck passed",
    );
    assert.equal(
      createPublicToolProgress(
        "run_tests",
        { scope: "full-suite" },
        "completed",
        { command: "bun test", requirementId: "test" },
      ).label,
      "Tests passed",
    );
    assert.equal(
      createPublicToolProgress("custom_workspace_tool").label,
      "Running workspace action",
    );
    assert.equal(
      JSON.stringify(createPublicToolProgress("read_many", {
        paths: ["/private/secret.ts"],
      })).includes("/private"),
      false,
    );
  });
});
