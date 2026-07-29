import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/build.yml", "utf8");

describe("release workflow", () => {
  it("derives every release artifact from a validated version tag", () => {
    assert.match(workflow, /tags:\s*\n\s*- "v\*\.\*\.\*"/);
    assert.match(
      workflow,
      /release_version="\$\{release_tag#v\}"[\s\S]*Tag \$\{release_tag\} does not match package\.json version/,
    );
    assert.match(workflow, /artifact: mate-x-\$\{\{ needs\.gate\.outputs\.release_tag \}\}-macos-x64/);
    assert.match(workflow, /tag_name: \$\{\{ needs\.gate\.outputs\.release_tag \}\}/);
  });

  it("does not pin the workflow to a specific product version", () => {
    assert.doesNotMatch(workflow, /v0\.1\.3/);
    assert.doesNotMatch(workflow, /RELEASE_VERSION:/);
  });
});
