import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSqliteRuntimePolicy } from "./sqlite-runtime-policy";

test("SQLite 3.45.1 is gated to serialized rollback-journal writes", () => {
  assert.deepEqual(resolveSqliteRuntimePolicy("3.45.1"), {
    version: "3.45.1",
    journalMode: "DELETE",
    concurrentWritersQualified: false,
    reason:
      "Embedded SQLite is not qualified for concurrent WAL writers; rollback journal serialization is enforced.",
  });
});

test("qualified SQLite builds may use WAL", () => {
  const policy = resolveSqliteRuntimePolicy("3.50.2");
  assert.equal(policy.journalMode, "WAL");
  assert.equal(policy.concurrentWritersQualified, true);
});
