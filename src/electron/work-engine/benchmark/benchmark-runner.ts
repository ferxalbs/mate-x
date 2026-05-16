import { buildBenchmarkScenarios } from "./benchmark-fixtures";
import type { WorkEngineBenchmarkResult, WorkEngineBenchmarkSummary } from "./benchmark-types";
import { evaluateScenario, summarizeBenchmark } from "./benchmark-evaluator";

export interface WorkEngineBenchmarkRun {
  results: WorkEngineBenchmarkResult[];
  summary: WorkEngineBenchmarkSummary;
}

export function runWorkEngineBenchmark(): WorkEngineBenchmarkRun {
  const scenarios = buildBenchmarkScenarios();
  const results = scenarios.map(evaluateScenario);
  return {
    results,
    summary: summarizeBenchmark(scenarios, results),
  };
}
