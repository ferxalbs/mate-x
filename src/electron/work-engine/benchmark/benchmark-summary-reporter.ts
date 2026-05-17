import type { WorkEngineBenchmarkSummary } from "./benchmark-types";

export interface FixtureBenchmarkSummaryInput {
  deterministicSummary: WorkEngineBenchmarkSummary;
  adversarialTestCount: number;
  fixtureScenarioCount: number;
  categoriesCovered: string[];
  failedScenarioIds: string[];
}

export function formatWorkEngineBenchmarkSummary(input: FixtureBenchmarkSummaryInput) {
  return [
    "Work Engine Benchmark Summary",
    `- deterministic pass rate: ${formatPercent(input.deterministicSummary.passRate)} (${input.deterministicSummary.passed}/${input.deterministicSummary.total})`,
    `- adversarial test count: ${input.adversarialTestCount}`,
    `- fixture scenario count: ${input.fixtureScenarioCount}`,
    `- categories covered: ${input.categoriesCovered.join(", ")}`,
    `- failed scenario ids: ${input.failedScenarioIds.length > 0 ? input.failedScenarioIds.join(", ") : "none"}`,
  ].join("\n");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
