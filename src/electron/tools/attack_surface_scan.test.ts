import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { classifySqlEvidenceSeverity } from "./attack_surface_scan";

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
      classifySqlEvidenceSeverity("const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`)"),
      "high",
    );
  });
});
