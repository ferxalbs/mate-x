import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCriticLoop } from "./critic-loop";
import { evaluateCriticLoopClaims } from "./critic-loop-claims";

describe("critic-loop workspace path containment", () => {
  test("verifyCriticLoop treats parent-traversal claims as non-existent", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-critic-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "inside.ts"), "export const ok = 1;\n", "utf8");

    // Real file just outside the workspace. Unchecked join()/absolute pass-through
    // would mark the escaped claim as existing.
    await writeFile(join(root, "..", "outside-secret.ts"), "secret\n", "utf8");

    const verification = await verifyCriticLoop({
      workspacePath: root,
      prompt: "review",
      finalContent: [
        "Touched src/inside.ts during the audit.",
        "Also referenced src/../../outside-secret.ts.",
      ].join("\n"),
      statusLines: [],
      events: [],
      toolExecutions: [],
    });

    const inside = verification.claimedFiles.find((entry) => entry.path === "src/inside.ts");
    const escaped = verification.claimedFiles.filter((entry) =>
      entry.path.includes("outside-secret"),
    );

    assert.ok(inside, "expected in-workspace claim to be extracted");
    assert.equal(inside.exists, true);
    assert.ok(escaped.length > 0, "expected escaped path claim to be extracted");

    for (const entry of escaped) {
      assert.equal(
        entry.exists,
        false,
        `escaped claim must not resolve outside workspace: ${entry.path}`,
      );
    }
  });

  test("evaluateCriticLoopClaims does not report escaped paths as existing", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-critic-claims-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "ok\n", "utf8");
    await writeFile(join(root, "..", "sibling-secret.ts"), "secret\n", "utf8");

    const warnings = await evaluateCriticLoopClaims({
      workspacePath: root,
      prompt: "audit",
      finalContent: "failed to locate src/../../sibling-secret.ts",
      modifiedFiles: [],
      commandsRan: [],
      validationStatus: "not_run",
      toolExecutions: [],
    });

    assert.equal(
      warnings.some((warning) => warning.includes("Claimed missing file exists")),
      false,
    );
  });

  test("evaluateCriticLoopClaims still flags real missing-file false claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-critic-present-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "present.ts"), "ok\n", "utf8");

    const warnings = await evaluateCriticLoopClaims({
      workspacePath: root,
      prompt: "audit",
      finalContent: "ENOENT: not found src/present.ts",
      modifiedFiles: [],
      commandsRan: [],
      validationStatus: "not_run",
      toolExecutions: [],
    });

    assert.ok(
      warnings.some((warning) =>
        warning.includes("Claimed missing file exists in workspace: src/present.ts"),
      ),
    );
  });
});
