import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { measurePackagedApplicationPerformance } from './packaged-performance';

describe('Packaged application performance [CLOSURE 5]', () => {
  it('records service-path metrics without secrets; BrowserWindow not final without probe', async () => {
    delete process.env.MATE_X_PERF_PROBE_JSON;
    const report = await measurePackagedApplicationPerformance({ sampleCount: 8 });

    assert.ok(report.metrics.length >= 8);
    for (const m of report.metrics) {
      if (m.source === 'proxy-not-final') {
        // BrowserWindow metrics without real probe must not claim samples as final
        assert.equal(m.sampleCount, 0, m.name);
        continue;
      }
      assert.ok(m.sampleCount > 0, m.name);
      assert.ok(Number.isFinite(m.p50Ms), m.name);
      assert.ok(Number.isFinite(m.p95Ms), m.name);
      assert.ok(m.p95Ms >= m.p50Ms, m.name);
    }

    assert.equal(report.realElectronProbes, false);
    assert.equal(report.finalEvidence, false);
    assert.ok(report.notes.some((n) => n.toLowerCase().includes('not final')));

    assert.ok(report.fixtures.small.fileCount > 0);
    assert.ok(report.fixtures.large.fileCount > report.fixtures.small.fileCount);
    assert.ok(report.memory.afterStartupMb > 0);
    assert.ok(report.host.cpuCount > 0);

    const json = JSON.stringify(report);
    assert.equal(json.includes('sk-'), false);
    assert.equal(json.toLowerCase().includes('api_key'), false);
    assert.equal(json.toLowerCase().includes('password'), false);
    assert.equal(json.includes('RAINY_API_KEY'), false);

    const cycle = report.metrics.find((m) => m.name === 'engineering_task_cycle');
    assert.ok(cycle);
    assert.ok(cycle!.p95Ms < 5000, `cycle p95 ${cycle!.p95Ms}`);
  });

  it('accepts real Electron probe JSON and marks final evidence', async () => {
    process.env.MATE_X_PERF_PROBE_JSON = JSON.stringify({
      coldProcessStartMs: [1200, 1100, 1300, 1250, 1180, 1220, 1150, 1280],
      readyToShowMs: [1200, 1100, 1300, 1250, 1180, 1220, 1150, 1280],
      rendererInteractiveMs: [1800, 1700, 1900, 1850, 1750, 1820, 1780, 1880],
      persistedWorkspaceVisibleMs: [0.2, 0.15, 0.18, 0.12, 0.22, 0.19, 0.14, 0.16],
      persistedEngineeringTaskVisibleMs: [0.1, 0.12, 0.09, 0.11, 0.13, 0.1, 0.08, 0.12],
      source: 'packaged-electron-probe',
    });

    const report = await measurePackagedApplicationPerformance({
      sampleCount: 8,
      requireRealElectronProbes: true,
    });

    assert.equal(report.realElectronProbes, true);
    assert.equal(report.finalEvidence, true);

    const r2s = report.metrics.find((m) => m.name === 'browser_window_ready_to_show');
    const ri = report.metrics.find((m) => m.name === 'renderer_interactive');
    assert.ok(r2s);
    assert.ok(ri);
    assert.equal(r2s!.source, 'real-electron-probe');
    assert.equal(ri!.source, 'real-electron-probe');
    assert.ok(r2s!.sampleCount >= 8);
    assert.ok(ri!.p95Ms >= ri!.p50Ms);

    delete process.env.MATE_X_PERF_PROBE_JSON;
  });

  it('requireRealElectronProbes throws without probe JSON', async () => {
    delete process.env.MATE_X_PERF_PROBE_JSON;
    await assert.rejects(
      () =>
        measurePackagedApplicationPerformance({
          sampleCount: 4,
          requireRealElectronProbes: true,
        }),
      /Real Electron BrowserWindow probes required/,
    );
  });
});
