import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { performance } from "node:perf_hooks";
import {
  getStaticToolDefinition,
  getStaticToolDefinitionCount,
  listStaticToolDefinitions,
} from "./tool-definitions-catalog";
import { lazyToolLoaders } from "./tool-registry";
import { toStrictObjectSchema, validateToolArguments } from "./tool-schema";
import {
  ensureStructuredToolOutput,
  isStructuredToolFailureOutput,
} from "./tool-result";

describe("static tool definition catalog", () => {
  test("contains all expected high-traffic tools", () => {
    const count = getStaticToolDefinitionCount();
    assert.ok(count >= 55, `expected >=55 defs, got ${count}`);
    for (const name of [
      "rg",
      "read",
      "ls",
      "git_diag",
      "sandbox_run",
      "run_tests",
      "file_editor",
      "eslint_scan",
      "attack_surface_scan",
    ]) {
      assert.ok(getStaticToolDefinition(name), `missing ${name}`);
    }
  });

  test("aliases resolve to canonical definitions", () => {
    const byAlias = getStaticToolDefinition("git");
    const byName = getStaticToolDefinition("git_diag");
    assert.ok(byAlias);
    assert.ok(byName);
    assert.equal(byAlias!.name, "git_diag");
    assert.equal(byAlias!.name, byName!.name);
  });

  test("cold-path discovery does not require execute loaders", () => {
    const t0 = performance.now();
    const defs = listStaticToolDefinitions();
    const ms = performance.now() - t0;
    assert.ok(defs.length > 0);
    // Should be near-instant vs multi-hundred-ms full module load.
    assert.ok(ms < 50, `static discovery too slow: ${ms}ms`);
  });

  test("every definition strictifies and validates empty optional payloads", () => {
    for (const def of listStaticToolDefinitions()) {
      const strict = toStrictObjectSchema(def.parameters);
      assert.equal(strict.type, "object");
      assert.equal(strict.additionalProperties, false);

      const required = def.parameters.required ?? [];
      if (required.length === 0) {
        assert.equal(
          validateToolArguments(
            {
              name: def.name,
              description: def.description,
              parameters: def.parameters,
              execute: async () => "",
            },
            {},
          ),
          null,
        );
      }
    }
  });

  test("registry keys are covered by static aliases or names", () => {
    const missing: string[] = [];
    for (const [key] of lazyToolLoaders) {
      if (!getStaticToolDefinition(key)) {
        missing.push(key);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe("ensureStructuredToolOutput migration safety net", () => {
  test("wraps legacy Error strings", () => {
    const out = ensureStructuredToolOutput("Error: boom happened", "demo");
    assert.equal(isStructuredToolFailureOutput(out), true);
    assert.match(out, /"ok":false/);
    assert.match(out, /boom happened/);
  });

  test("passes through structured success", () => {
    const original = '{"ok":true,"status":"completed","data":{"x":1}}';
    assert.equal(ensureStructuredToolOutput(original, "demo"), original);
  });

  test("passes through normal success text", () => {
    const original = "No matches found.";
    assert.equal(ensureStructuredToolOutput(original, "rg"), original);
  });
});
