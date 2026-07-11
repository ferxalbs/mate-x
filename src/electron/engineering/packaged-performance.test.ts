import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { measurePackagedApplicationPerformance } from './packaged-performance';

describe('Packaged application performance [CLOSURE 5]', () => {
  it('records p50/p95 for app-path metrics without secrets', async () => {
    const report = await measurePackagedApplicationPerformance({ sampleCount: 8 });

    assert.ok(report.metrics.length >= 8);
    for (const m of report.metrics) {
      assert.ok(m.sampleCount > 0, m.name);
      assert.ok(Number.isFinite(m.p50Ms), m.name);
      assert.ok(Number.isFinite(m.p95Ms), m.name);
      assert.ok(m.p95Ms >= m.p50Ms, m.name);
    }

    assert.ok(report.fixtures.small.fileCount > 0);
    assert.ok(report.fixtures.large.fileCount > report.fixtures.small.fileCount);
    assert.ok(report.memory.afterStartupMb > 0);
    assert.ok(report.host.cpuCount > 0);

    const json = JSON.stringify(report);
    assert.equal(json.includes('sk-'), false);
    assert.equal(json.toLowerCase().includes('api_key'), false);
    assert.equal(json.toLowerCase().includes('password'), false);
    assert.equal(json.includes('RAINY_API_KEY'), false);

    // Soft budgets — mark pass flags; do not fail CI on flaky hosts for cold start proxies
    const cycle = report.metrics.find((m) => m.name === 'engineering_task_cycle');
    assert.ok(cycle);
    assert.ok(cycle!.p95Ms < 5000, `cycle p95 ${cycle!.p95Ms}`);

    console.log('[packaged-perf]', JSON.stringify({
      host: report.host,
      fixtures: report.fixtures,
      memory: report.memory,
      metrics: report.metrics.map((m) => ({
        name: m.name,
        p50: m.p50Ms,
        p95: m.p95Ms,
        n: m.sampleCount,
        budget: m.budgetMs,
        pass: m.pass,
        coldOrWarm: m.coldOrWarm,
      })),
    }));
  });
});
