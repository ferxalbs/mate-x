import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  batchFilesForRg,
  classifyDynamicCodeEvidenceSeverity,
  classifyEgressEvidenceSeverity,
  classifySqlEvidenceSeverity,
  classifyWeakCryptoEvidenceSeverity,
  sourceRoleFor,
} from "./attack_surface_scan";

describe("attack surface scan SQL triage", () => {
  it("downgrades static DDL in SQL tagged templates", () => {
    assert.equal(
      classifySqlEvidenceSeverity("await db.execute(sql`ALTER TABLE models_registry ADD COLUMN IF NOT EXISTS capabilities TEXT`)"),
      "info",
    );
  });

  it("keeps static SQL tagged templates below high priority", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM models_registry`)"),
      "info",
    );
  });

  it("treats Drizzle-style SQL interpolation as parameterized unless raw helpers are used", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`)", "src/api/v1/users/routes.ts"),
      "info",
    );
  });

  it("keeps unsafe raw SQL high even outside API routes", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(raw(`SELECT * FROM ${table}`))", "src/lib/models/registry.ts"),
      "high",
    );
  });

  it("keeps non-route SQL tag interpolation as audit context", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`)", "src/lib/models/registry.ts"),
      "info",
    );
  });

  it("downgrades Math.random retry jitter", () => {
    assert.equal(
      classifyWeakCryptoEvidenceSeverity("const jitter = Math.floor(Math.random() * 120)"),
      "info",
    );
  });

  it("keeps Math.random token generation high", () => {
    assert.equal(
      classifyWeakCryptoEvidenceSeverity("const token = Math.random().toString(36).slice(2)"),
      "high",
    );
  });
});

describe("attack surface scan dynamic execution triage", () => {
  it("downgrades hardcoded Redis Lua using KEYS and ARGV", () => {
    assert.equal(
      classifyDynamicCodeEvidenceSeverity("await redis.eval(`redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])`, [key], [now])"),
      "info",
    );
  });

  it("keeps dynamic Redis eval as review-worthy", () => {
    assert.equal(
      classifyDynamicCodeEvidenceSeverity("await redis.eval(scriptFromRequest, [key], [value])"),
      "medium",
    );
  });
});

describe("attack surface scan egress triage", () => {
  it("downgrades constant host fetch calls", () => {
    assert.equal(
      classifyEgressEvidenceSeverity("const response = await fetch(OPENROUTER_ANTHROPIC_MESSAGES_URL, {", "src/lib/llm/anthropic.ts"),
      "info",
    );
  });

  it("keeps environment-backed base URLs as medium signal", () => {
    assert.equal(
      classifyEgressEvidenceSeverity("const response = await fetch(`${import.meta.env.VITE_API_URL}/agents/research`, {", "src/pages/ResearchPage.tsx"),
      "medium",
    );
  });

  it("keeps API route user-controlled URLs high", () => {
    assert.equal(
      classifyEgressEvidenceSeverity("const response = await fetch(req.query.callbackUrl, {", "src/api/v1/webhooks/routes.ts"),
      "high",
    );
  });

  it("keeps dynamic endpoint variables medium until source proof exists", () => {
    assert.equal(
      classifyEgressEvidenceSeverity("const response = await fetch(safeEndpoint, {", "src/lib/tools/runtime.ts"),
      "medium",
    );
  });
});

describe("attack surface scan rg batching", () => {
  it("splits file arguments before they exceed the configured limit", () => {
    assert.deepEqual(
      batchFilesForRg(["src/a.ts", "src/bbbbb.ts", "src/c.ts"], 18),
      [["src/a.ts"], ["src/bbbbb.ts"], ["src/c.ts"]],
    );
  });

  it("keeps small file sets in one rg invocation", () => {
    assert.deepEqual(
      batchFilesForRg(["src/a.ts", "src/b.ts"], 80),
      [["src/a.ts", "src/b.ts"]],
    );
  });
});

describe("attack surface scan source roles", () => {
  it("classifies root deployment scripts as tooling, not active runtime code", () => {
    assert.equal(
      sourceRoleFor("scripts/deploy/deploy-cloudrun.ts", "const result = Bun.spawnSync(args)"),
      "tooling",
    );
  });

  it("classifies root load-test scripts as tooling", () => {
    assert.equal(
      sourceRoleFor("scripts/loadtest/run.ts", "const response = await fetch(config.url)"),
      "tooling",
    );
  });

  it("keeps application tool implementations active", () => {
    assert.equal(
      sourceRoleFor("src/electron/tools/sandbox_run.ts", "const child = spawn(cmd, cmdArgs)"),
      "active",
    );
  });
});
