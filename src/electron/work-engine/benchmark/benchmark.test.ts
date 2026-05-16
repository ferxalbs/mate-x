import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { runWorkEngineBenchmark } from "./benchmark-runner";

describe("Work Engine Benchmark Suite v1", () => {
  test("deterministic scenarios pass at 100 percent", () => {
    const run = runWorkEngineBenchmark();
    assert.equal(run.summary.total >= 20, true);
    assert.equal(run.summary.passRate, 1, formatFailures(run.results));
  });

  test("covers required categories", () => {
    const { summary } = runWorkEngineBenchmark();
    for (const category of [
      "patch_validation",
      "security",
      "evidence",
      "privacy",
      "failure_memory",
      "intent_runbook",
    ]) {
      assert.equal(summary.byCategory[category]?.total > 0, true, `${category} missing`);
      assert.equal(summary.byCategory[category]?.passRate, 1, `${category} pass rate below 100%`);
    }
  });

  test("regression protections hold", () => {
    const { results } = runWorkEngineBenchmark();
    for (const result of results) {
      assert.equal(
        result.failures.some((failure) =>
          /fallback bypass|model_claim|unsupported vulnerability|evidence prose|validation failure/.test(failure),
        ),
        false,
        `${result.id}: ${result.failures.join("; ")}`,
      );
    }
  });
});

function formatFailures(results: ReturnType<typeof runWorkEngineBenchmark>["results"]) {
  return results
    .filter((result) => !result.passed)
    .map((result) => `${result.id}: ${result.failures.join("; ")}`)
    .join("\n");
}
