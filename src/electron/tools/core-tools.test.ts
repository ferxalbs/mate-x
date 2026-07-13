import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTool } from "./read";
import { lsTool } from "./ls";
import { pwdTool } from "./pwd";
import { isToolFailureOutput } from "../repo-service/agentic-runtime/helpers";
import type { AppSettings } from "../../contracts/settings";

const settings = {} as AppSettings;

describe("core filesystem tools", () => {
  test("read returns content and fails structured on missing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-tools-"));
    await writeFile(join(root, "hello.ts"), "export const x = 1;\n", "utf8");

    const content = await readTool.execute(
      { path: "hello.ts" },
      { workspacePath: root, settings },
    );
    assert.match(content, /export const x = 1/);
    assert.equal(isToolFailureOutput(content), false);

    const missing = await readTool.execute(
      { path: "missing.ts" },
      { workspacePath: root, settings },
    );
    assert.equal(isToolFailureOutput(missing), true);
    assert.match(missing, /MISSING_RESOURCE/);

    const escaped = await readTool.execute(
      { path: "../outside" },
      { workspacePath: root, settings },
    );
    assert.equal(isToolFailureOutput(escaped), true);
  });

  test("ls lists directories and reports files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-tools-ls-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "a\n", "utf8");

    const listing = await lsTool.execute(
      { path: "." },
      { workspacePath: root, settings },
    );
    assert.match(listing, /\[DIR\] src/);

    const fileStat = await lsTool.execute(
      { path: "src/a.ts" },
      { workspacePath: root, settings },
    );
    assert.match(fileStat, /Path is a file/);
  });

  test("pwd returns structured workspace context", async () => {
    const root = await mkdtemp(join(tmpdir(), "mate-x-tools-pwd-"));
    const out = await pwdTool.execute({}, { workspacePath: root, settings });
    assert.match(out, /Workspace Root:/);
    assert.match(out, /"ok":true/);
    assert.equal(isToolFailureOutput(out), false);
  });
});
