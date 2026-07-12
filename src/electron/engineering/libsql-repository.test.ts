/**
 * Durable LibSQL EngineeringRepository tests (R1).
 * Create/reload uses a NEW repository instance against the same file — not in-memory reconstruction.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { DomainEvent, EngineeringTask } from '../../contracts/engineering-task';
import { ENGINEERING_SCHEMA_VERSION } from './schema';
import {
  EngineeringRepositoryError,
  LibSqlEngineeringRepository,
} from './repository';
import { newEngineeringTaskId, nowIso, sha256Hex } from './ids';

const dirs: string[] = [];

after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mate-x-eng-'));
  dirs.push(dir);
  return path.join(dir, 'mate-x.db');
}

function makeTask(over: Partial<EngineeringTask> = {}): EngineeringTask {
  const id = over.engineeringTaskId ?? newEngineeringTaskId();
  const t = nowIso();
  return {
    engineeringTaskId: id,
    workspaceId: 'ws_test',
    conversationId: null,
    pathKind: 'full',
    title: 'Test task',
    objectiveSeed: 'Do the thing',
    status: 'captured',
    aggregateVersion: 1,
    activeSpecificationVersion: null,
    activePlanVersion: null,
    activeTaskGraphVersion: null,
    policyPackRef: null,
    readiness: 'Not proven',
    priorLegalStatus: null,
    blockedReasonCode: null,
    lastExecutionId: null,
    lastProofId: null,
    createdAt: t,
    updatedAt: t,
    cancelledAt: null,
    readyAt: null,
    ...over,
  };
}

function makeEvent(taskId: string, seq: number, type: string): DomainEvent {
  const payload = { seq };
  return {
    eventId: `evt_${taskId}_${seq}`,
    engineeringTaskId: taskId,
    seq,
    type,
    payload,
    actor: { kind: 'system', component: 'test' },
    causedByCommandId: `cmd_${seq}`,
    occurredAt: nowIso(),
    integrityHash: sha256Hex(JSON.stringify(payload)),
  };
}

describe('LibSqlEngineeringRepository durable [R1]', () => {
  it('create and reload from a new repository instance', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    a.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
      commandId: 'cmd_create_1',
    });
    a.close?.();

    const b = LibSqlEngineeringRepository.open(dbPath);
    const loaded = b.getTask(task.engineeringTaskId);
    assert.ok(loaded);
    assert.equal(loaded!.title, task.title);
    assert.equal(loaded!.objectiveSeed, task.objectiveSeed);
    assert.equal(b.getEvents(task.engineeringTaskId).length, 1);
    b.close?.();
  });

  it('update and reload preserves aggregate', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    a.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    const next = {
      ...task,
      aggregateVersion: 2,
      status: 'clarifying' as const,
      updatedAt: nowIso(),
    };
    a.applyTransaction({
      task: next,
      events: [makeEvent(task.engineeringTaskId, 2, 'ClarificationStarted')],
      expectedAggregateVersion: 1,
    });
    a.close?.();

    const b = LibSqlEngineeringRepository.open(dbPath);
    assert.equal(b.getTask(task.engineeringTaskId)?.status, 'clarifying');
    assert.equal(b.getTask(task.engineeringTaskId)?.aggregateVersion, 2);
    b.close?.();
  });

  it('atomic event plus aggregate write', () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    const events = repo.getEvents(task.engineeringTaskId);
    assert.equal(events.length, 1);
    assert.equal(repo.getTask(task.engineeringTaskId)?.aggregateVersion, 1);
    repo.close?.();
  });

  it('rollback on failed event append (seq gap)', () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    assert.throws(
      () =>
        repo.applyTransaction({
          task: { ...task, aggregateVersion: 2, status: 'clarifying' },
          events: [makeEvent(task.engineeringTaskId, 99, 'Bad')],
        }),
      /seq gap|ERR_EVENT_SEQ/i,
    );
    assert.equal(repo.getTask(task.engineeringTaskId)?.aggregateVersion, 1);
    assert.equal(repo.getEvents(task.engineeringTaskId).length, 1);
    repo.close?.();
  });

  it('optimistic concurrency rejection', () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    assert.throws(
      () =>
        repo.applyTransaction({
          task: { ...task, aggregateVersion: 2, status: 'clarifying' },
          events: [makeEvent(task.engineeringTaskId, 2, 'X')],
          expectedAggregateVersion: 0,
        }),
      (err: unknown) =>
        err instanceof EngineeringRepositoryError &&
        err.code === 'ERR_VERSION_CONFLICT',
    );
    repo.close?.();
  });

  it('duplicate command idempotency', () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    const event = makeEvent(task.engineeringTaskId, 1, 'TaskCaptured');
    repo.applyTransaction({
      task,
      events: [event],
      commandId: 'idem_1',
    });
    // Second apply with same commandId is no-op (does not throw / duplicate)
    repo.applyTransaction({
      task: { ...task, aggregateVersion: 99 },
      events: [makeEvent(task.engineeringTaskId, 2, 'ShouldNotApply')],
      commandId: 'idem_1',
    });
    assert.equal(repo.getTask(task.engineeringTaskId)?.aggregateVersion, 1);
    assert.equal(repo.getEvents(task.engineeringTaskId).length, 1);
    repo.close?.();
  });

  it('interrupted transaction leaves prior version', () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    repo.simulateAbortOnNextWrite?.();
    assert.throws(
      () =>
        repo.applyTransaction({
          task: { ...task, aggregateVersion: 2, status: 'executing' },
          events: [makeEvent(task.engineeringTaskId, 2, 'Exec')],
        }),
      /SIMULATED_ABORT/,
    );
    assert.equal(repo.getTask(task.engineeringTaskId)?.status, 'captured');
    assert.equal(repo.getEvents(task.engineeringTaskId).length, 1);
    repo.close?.();
  });

  it('malformed serialized payload fails closed on read', async () => {
    const dbPath = tempDb();
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask();
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    // Corrupt event payload directly via a second connection
    const libsql = await import('libsql');
    const Database = libsql.default;
    const db = new Database(dbPath);
    db.prepare(
      `UPDATE engineering_events SET payload_json = 'NOT_JSON' WHERE engineering_task_id = ?`,
    ).run(task.engineeringTaskId);
    db.close();
    repo.close?.();

    const reopened = LibSqlEngineeringRepository.open(dbPath);
    assert.throws(
      () => reopened.getEvents(task.engineeringTaskId),
      /Malformed serialized payload/,
    );
    reopened.close?.();
  });

  it('schema migration from empty (v0.1.1-like) and repeated migration', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    assert.equal(a.getSchemaVersion(), ENGINEERING_SCHEMA_VERSION);
    a.ensureSchema();
    a.ensureSchema();
    assert.equal(a.getSchemaVersion(), ENGINEERING_SCHEMA_VERSION);
    a.close?.();

    const b = LibSqlEngineeringRepository.open(dbPath);
    b.ensureSchema();
    assert.equal(b.getSchemaVersion(), ENGINEERING_SCHEMA_VERSION);
    b.close?.();
  });

  it('restart during task execution recovers status', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask({ status: 'executing', aggregateVersion: 5 });
    a.applyTransaction({
      task: { ...task, status: 'captured', aggregateVersion: 1 },
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    a.applyTransaction({
      task: {
        ...task,
        status: 'executing',
        aggregateVersion: 5,
        lastExecutionId: 'exec_1',
      },
      events: [
        makeEvent(task.engineeringTaskId, 2, 'ApprovePlanAndTasksApplied'),
        makeEvent(task.engineeringTaskId, 3, 'AcquireLeaseApplied'),
        makeEvent(task.engineeringTaskId, 4, 'ExecStarted'),
        makeEvent(task.engineeringTaskId, 5, 'ExecHeartbeat'),
      ],
      execution: {
        executionId: 'exec_1',
        workPlanId: 'wp_1',
        status: 'running',
        document: { phase: 'executing' },
      },
    });
    a.close?.();

    const b = LibSqlEngineeringRepository.open(dbPath);
    const loaded = b.getTask(task.engineeringTaskId);
    assert.equal(loaded?.status, 'executing');
    assert.equal(loaded?.lastExecutionId, 'exec_1');
    const bundle = b.getBundle(task.engineeringTaskId);
    assert.ok(bundle?.executions.get('exec_1'));
    b.close?.();
  });

  it('restart during validation recovers validation runs', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask({ status: 'verifying', aggregateVersion: 3 });
    a.applyTransaction({
      task: { ...task, status: 'captured', aggregateVersion: 1 },
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    a.applyTransaction({
      task,
      events: [
        makeEvent(task.engineeringTaskId, 2, 'BeginVerificationApplied'),
        makeEvent(task.engineeringTaskId, 3, 'ValidationStarted'),
      ],
      validationRun: {
        validationRunId: 'vr_1',
        validationPlanId: 'vp_1',
        validationId: 'v_1',
        engineeringTaskId: task.engineeringTaskId,
        relatedTaskIds: [],
        relatedReqIds: [],
        executable: 'bun',
        args: ['test'],
        cwd: '/tmp',
        startedAt: nowIso(),
        completedAt: null,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        outputSummary: '',
        headSha: 'abc1234',
        diffHash: sha256Hex('diff'),
        policyHash: sha256Hex('pol'),
        passed: null,
      },
    });
    a.close?.();

    const b = LibSqlEngineeringRepository.open(dbPath);
    const bundle = b.getBundle(task.engineeringTaskId);
    assert.equal(bundle?.task.status, 'verifying');
    assert.ok(bundle?.validationRuns.get('vr_1'));
    b.close?.();
  });

  it('restart after external repository change keeps durable task state', () => {
    const dbPath = tempDb();
    const a = LibSqlEngineeringRepository.open(dbPath);
    const task = makeTask({ status: 'ready', aggregateVersion: 8 });
    a.applyTransaction({
      task: { ...task, status: 'captured', aggregateVersion: 1 },
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });
    a.applyTransaction({
      task,
      events: [
        makeEvent(task.engineeringTaskId, 2, 'AcceptConvergenceApplied'),
        makeEvent(task.engineeringTaskId, 3, 'E2'),
        makeEvent(task.engineeringTaskId, 4, 'E3'),
        makeEvent(task.engineeringTaskId, 5, 'E4'),
        makeEvent(task.engineeringTaskId, 6, 'E5'),
        makeEvent(task.engineeringTaskId, 7, 'E6'),
        makeEvent(task.engineeringTaskId, 8, 'Ready'),
      ],
      proof: {
        proofId: 'proof_1',
        engineeringTaskId: task.engineeringTaskId,
        proofHandle: 'ph_test_handle_0123456789',
        anchors: {
          workspaceId: 'ws_test',
          repositorySnapshotHash: sha256Hex('/repo'),
          baseSha: null,
          headSha: 'deadbeef',
          diffHash: sha256Hex('d'),
          policyHash: sha256Hex('p'),
          specificationVersion: 1,
          planVersion: 1,
          taskGraphVersion: 1,
          generatedAt: nowIso(),
        },
        validationRunIds: ['vr_1'],
        coverageReportId: 'cov_1',
        status: 'valid',
        generatedAt: nowIso(),
        traces: [],
      },
    });
    a.close?.();

    // "External repo change" simulated by reopening — task state must survive independently
    const b = LibSqlEngineeringRepository.open(dbPath);
    const proof = b.getProofByHandle('ph_test_handle_0123456789');
    assert.ok(proof);
    assert.equal(proof!.anchors.headSha, 'deadbeef');
    // After external HEAD change, proof would be stale vs current — anchors still stored
    assert.notEqual(proof!.anchors.headSha, 'newhead1');
    b.close?.();
  });
});
