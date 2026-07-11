/**
 * Performance harness for acceptance budgets (R9 / PF-*).
 * Does not record prompts, secrets, or repository source content.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { EngineeringCommandBus } from './command-bus';
import { createPhaseHandler } from './phase-handler';
import { computeReadiness } from './readiness';
import { evaluateProofFreshness } from './ship-proof';
import { evaluateGitGate } from './git-gate';
import { LibSqlEngineeringRepository } from './repository';
import { ensureDefaultPolicyPack } from './policy-pack';
import { nowIso, sha256Hex } from './ids';

const SAMPLE = 25;
const dirs: string[] = [];

after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function measure(fn: () => void, n = SAMPLE): { p50: number; p95: number; samples: number[] } {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), samples };
}

describe('Performance harness [R9]', () => {
  it('records CaptureTask, readiness, GitGate p50/p95 without sensitive payloads', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mate-x-perf-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'mate-x.db');
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const bus = new EngineeringCommandBus(repo);
    bus.setPhaseHandler(createPhaseHandler(repo));
    const policy = ensureDefaultPolicyPack(repo);

    const memBefore =
      typeof process.memoryUsage === 'function'
        ? process.memoryUsage().heapUsed
        : 0;

    const capture = measure(() => {
      const r = bus.dispatch({
        type: 'CaptureTask',
        workspaceId: 'ws_perf',
        // Objective is a short synthetic fixture — not user private content
        objectiveSeed: `fixture-objective-${Math.random().toString(16).slice(2)}`,
      });
      assert.equal(r.ok, true);
    });

    const readiness = measure(() => {
      computeReadiness({
        status: 'ready',
        openCriticalDecisions: 0,
        openPolicyStops: 0,
        consistencyCriticalCount: 0,
        requiredValidationMissing: false,
        requiredValidationFailed: false,
        validationRuns: [
          {
            validationRunId: 'vr',
            validationPlanId: 'vp',
            validationId: 'v',
            engineeringTaskId: 'etask_x',
            relatedTaskIds: [],
            relatedReqIds: [],
            executable: 'bun',
            args: ['test'],
            cwd: '/tmp',
            startedAt: nowIso(),
            completedAt: nowIso(),
            exitCode: 0,
            timedOut: false,
            cancelled: false,
            outputSummary: 'ok',
            headSha: 'abc1234',
            diffHash: sha256Hex('d'),
            policyHash: policy.policyHash,
            passed: true,
          },
        ],
        coverage: {
          reportId: 'c',
          engineeringTaskId: 'etask_x',
          generatedAt: nowIso(),
          gaps: [],
          actionableGapCount: 0,
          inputsHash: sha256Hex('cov'),
        },
        proof: null,
        proofAnchorsMatch: true,
        privacyBlocked: false,
        policyMustBlocked: false,
        leaseHardConflict: false,
        highFindings: 0,
        mutationWithoutEvidence: false,
      });
    });

    const gitGate = measure(() => {
      evaluateGitGate({
        repo,
        proofHandle: null,
        current: {
          workspaceId: 'ws_perf',
          headSha: 'abc1234',
          diffHash: sha256Hex('d'),
          policyHash: policy.policyHash,
        },
      });
    });

    const proofFresh = measure(() => {
      evaluateProofFreshness(
        {
          proofId: 'p',
          engineeringTaskId: 'etask_x',
          proofHandle: 'ph_x',
          anchors: {
            workspaceId: 'ws_perf',
            repositorySnapshotHash: sha256Hex('/repo'),
            baseSha: null,
            headSha: 'abc1234',
            diffHash: sha256Hex('d'),
            policyHash: policy.policyHash,
            specificationVersion: 1,
            planVersion: 1,
            taskGraphVersion: 1,
            generatedAt: nowIso(),
          },
          validationRunIds: [],
          coverageReportId: 'c',
          status: 'valid',
          generatedAt: nowIso(),
          traces: [],
        },
        {
          workspaceId: 'ws_perf',
          headSha: 'abc1234',
          diffHash: sha256Hex('d'),
          policyHash: policy.policyHash,
        },
      );
    });

    const reload = measure(() => {
      repo.listTasks('ws_perf');
    });

    const memAfter =
      typeof process.memoryUsage === 'function'
        ? process.memoryUsage().heapUsed
        : 0;

    // Soft budgets from acceptance gates (CI hosts vary — assert finiteness + soft upper)
    assert.ok(capture.p95 < 200, `CaptureTask p95 ${capture.p95}`);
    assert.ok(readiness.p95 < 100, `readiness p95 ${readiness.p95}`);
    assert.ok(gitGate.p95 < 50, `gitGate p95 ${gitGate.p95}`);
    assert.ok(proofFresh.p95 < 50, `proofFresh p95 ${proofFresh.p95}`);
    assert.ok(reload.p95 < 300, `reload p95 ${reload.p95}`);

    // Metrics record only aggregate timings — no source/prompts/secrets
    const report = {
      hardware: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      repositoryFixtureSize: 'empty-temp-db',
      sampleCount: SAMPLE,
      warmCold: 'warm-process',
      memoryBaselineBytes: memBefore,
      memoryFinalBytes: memAfter,
      metrics: {
        captureTaskMs: { p50: capture.p50, p95: capture.p95 },
        readinessMs: { p50: readiness.p50, p95: readiness.p95 },
        gitGateMs: { p50: gitGate.p50, p95: gitGate.p95 },
        proofFreshMs: { p50: proofFresh.p50, p95: proofFresh.p95 },
        taskReloadMs: { p50: reload.p50, p95: reload.p95 },
      },
      regressionThresholdNote:
        'PF-01 Capture p95 < 50ms ideal; CI soft-warn if host flaky',
    };
    assert.ok(!JSON.stringify(report).includes('sk-'));
    assert.ok(!JSON.stringify(report).toLowerCase().includes('password'));
    // Surface for evidence append
    console.log('[perf-harness]', JSON.stringify(report));

    repo.close?.();
  });
});
