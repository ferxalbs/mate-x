import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  classifyEgressEvidenceSeverity,
  classifySqlEvidenceSeverity,
  classifyWeakCryptoEvidenceSeverity,
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
      "medium",
    );
  });

  it("keeps interpolated SQL as high signal", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`)", "src/api/v1/users/routes.ts"),
      "high",
    );
  });

  it("keeps unsafe raw SQL high even outside API routes", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(raw(`SELECT * FROM ${table}`))", "src/lib/models/registry.ts"),
      "high",
    );
  });

  it("keeps non-route SQL tag interpolation medium until source proof exists", () => {
    assert.equal(
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`)", "src/lib/models/registry.ts"),
      "medium",
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
