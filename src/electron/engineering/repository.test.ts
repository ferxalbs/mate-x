import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DomainEvent, EngineeringTask } from '../../contracts/engineering-task';
import { ENGINEERING_SCHEMA_SQL, ENGINEERING_SCHEMA_VERSION } from './schema';
import { InMemoryEngineeringRepository as EngineeringRepository } from './repository';
import { newEngineeringTaskId, nowIso, sha256Hex } from './ids';

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

function makeEvent(
  taskId: string,
  seq: number,
  type: string,
): DomainEvent {
  const payload = { seq };
  return {
    eventId: `evt_${seq}`,
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

describe('EngineeringRepository schema [NES-1.2]', () => {
  it('schema statements are idempotent CREATE IF NOT EXISTS', () => {
    assert.ok(ENGINEERING_SCHEMA_VERSION >= 1);
    for (const sql of ENGINEERING_SCHEMA_SQL) {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/);
    }
    assert.ok(ENGINEERING_SCHEMA_SQL.some((s) => s.includes('engineering_tasks')));
    assert.ok(ENGINEERING_SCHEMA_SQL.some((s) => s.includes('engineering_events')));
    assert.ok(ENGINEERING_SCHEMA_SQL.some((s) => s.includes('engineering_leases')));
    assert.ok(ENGINEERING_SCHEMA_SQL.some((s) => s.includes('engineering_proofs')));
  });

  it('ensureSchema is idempotent', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    repo.ensureSchema();
    assert.equal(repo.getSchemaVersion(), 1);
  });
});

describe('EngineeringRepository transactions [NES-1.2]', () => {
  it('persists task + event atomically', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    const task = makeTask();
    const event = makeEvent(task.engineeringTaskId, 1, 'TaskCaptured');
    repo.applyTransaction({ task, events: [event] });

    const loaded = repo.getTask(task.engineeringTaskId);
    assert.ok(loaded);
    assert.equal(loaded!.status, 'captured');
    assert.equal(loaded!.aggregateVersion, 1);
    const events = repo.getEvents(task.engineeringTaskId);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, 'TaskCaptured');
  });

  it('simulated abort leaves prior version intact', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    const task = makeTask({ aggregateVersion: 1 });
    repo.applyTransaction({
      task,
      events: [makeEvent(task.engineeringTaskId, 1, 'TaskCaptured')],
    });

    repo.simulateAbortOnNextWrite();
    const next = { ...task, aggregateVersion: 2, status: 'clarifying' as const };
    assert.throws(
      () =>
        repo.applyTransaction({
          task: next,
          events: [makeEvent(task.engineeringTaskId, 2, 'ClarificationStarted')],
        }),
      /SIMULATED_ABORT/,
    );

    const loaded = repo.getTask(task.engineeringTaskId);
    assert.equal(loaded!.aggregateVersion, 1);
    assert.equal(loaded!.status, 'captured');
    assert.equal(repo.getEvents(task.engineeringTaskId).length, 1);
  });

  it('lists tasks by workspace', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    const a = makeTask({ workspaceId: 'ws_a', title: 'A' });
    const b = makeTask({ workspaceId: 'ws_b', title: 'B' });
    repo.applyTransaction({
      task: a,
      events: [makeEvent(a.engineeringTaskId, 1, 'TaskCaptured')],
    });
    repo.applyTransaction({
      task: b,
      events: [makeEvent(b.engineeringTaskId, 1, 'TaskCaptured')],
    });
    assert.equal(repo.listTasks('ws_a').length, 1);
    assert.equal(repo.listTasks('ws_a')[0]!.title, 'A');
    assert.equal(repo.listTasks('ws_b').length, 1);
  });
});
