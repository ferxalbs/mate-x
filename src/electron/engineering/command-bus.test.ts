import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ERR_CODES } from '../../contracts/engineering-task';
import { EngineeringCommandBus } from './command-bus';
import { InMemoryEngineeringRepository as EngineeringRepository } from './repository';

function bus() {
  const repo = new EngineeringRepository();
  repo.ensureSchema();
  return new EngineeringCommandBus(repo);
}

describe('EngineeringCommandBus CaptureTask [NES-1.3]', () => {
  it('captures non-empty objective as status captured (not specified)', () => {
    const b = bus();
    const result = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'Add rate limiting to the API',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((result.data as any).status, 'captured');
    assert.notEqual((result.data as any).status, 'specified');
    assert.equal(result.aggregateVersion, 1);
    assert.ok((result.data as any).engineeringTaskId.startsWith('etask_'));
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.type, 'TaskCaptured');
  });

  it('rejects empty objective', () => {
    const b = bus();
    const result = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: '   ',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, ERR_CODES.ERR_OBJECTIVE_EMPTY);
  });

  it('rejects missing workspace', () => {
    const b = bus();
    const result = b.dispatch({
      type: 'CaptureTask',
      workspaceId: '',
      objectiveSeed: 'x',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, ERR_CODES.ERR_WORKSPACE_REQUIRED);
  });

  it('survives rehydrate (process restart mock)', () => {
    const repo = new EngineeringRepository();
    repo.ensureSchema();
    const b1 = new EngineeringCommandBus(repo);
    const created = b1.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'Persist me',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // New bus instance same repo = restart mock
    const b2 = new EngineeringCommandBus(repo);
    const loaded = b2.getTask((created.data as any).engineeringTaskId);
    assert.ok(loaded);
    assert.equal(loaded!.objectiveSeed, 'Persist me');
    assert.equal(loaded!.status, 'captured');
    assert.equal(loaded!.aggregateVersion, 1);
    assert.equal(repo.getEvents((created.data as any).engineeringTaskId).length, 1);
  });
});

describe('EngineeringCommandBus transitions [NES-1.3]', () => {
  it('rejects illegal transition', () => {
    const b = bus();
    const created = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'x',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const bad = b.dispatch({
      type: 'ApprovePlanAndTasks',
      engineeringTaskId: (created.data as any).engineeringTaskId,
      workspaceId: 'ws_1',
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.error.code, ERR_CODES.ERR_ILLEGAL_TRANSITION);
  });

  it('enforces aggregateVersion optimistic concurrency', () => {
    const b = bus();
    const created = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'x',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const ok = b.dispatch({
      type: 'StartClarification',
      engineeringTaskId: (created.data as any).engineeringTaskId,
      workspaceId: 'ws_1',
      expectedAggregateVersion: 1,
    });
    assert.equal(ok.ok, true);
    const conflict = b.dispatch({
      type: 'FreezeSpecification',
      engineeringTaskId: (created.data as any).engineeringTaskId,
      workspaceId: 'ws_1',
      expectedAggregateVersion: 1,
    });
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.error.code, ERR_CODES.ERR_VERSION_CONFLICT);
  });

  it('RejectApproval never transitions to executing', () => {
    const b = bus();
    const created = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'x',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = (created.data as any).engineeringTaskId;
    for (const type of [
      'FreezeSpecification',
      'StartPlanCompilation',
      'CompletePlanCompilation',
      'CompileTaskGraph',
      'SubmitForApproval',
    ] as const) {
      const r = b.dispatch({ type, engineeringTaskId: id, workspaceId: 'ws_1' });
      assert.equal(r.ok, true, type);
    }
    const rejected = b.dispatch({
      type: 'RejectApproval',
      engineeringTaskId: id,
      workspaceId: 'ws_1',
      reasonCode: 'scope',
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.notEqual((rejected.data as any).status, 'executing');
    assert.equal((rejected.data as any).status, 'planned');
  });

  it('agent cannot ApprovePlanAndTasks', () => {
    const b = bus();
    const created = b.dispatch({
      type: 'CaptureTask',
      workspaceId: 'ws_1',
      objectiveSeed: 'x',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = (created.data as any).engineeringTaskId;
    for (const type of [
      'FreezeSpecification',
      'StartPlanCompilation',
      'CompletePlanCompilation',
      'CompileTaskGraph',
      'SubmitForApproval',
    ] as const) {
      assert.equal(
        b.dispatch({ type, engineeringTaskId: id, workspaceId: 'ws_1' }).ok,
        true,
      );
    }
    const denied = b.dispatch({
      type: 'ApprovePlanAndTasks',
      engineeringTaskId: id,
      workspaceId: 'ws_1',
      actor: { kind: 'agent', agentId: 'a1', adapterId: 'rainy' },
    });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.error.code, ERR_CODES.ERR_AGENT_CANNOT_APPROVE);
  });
});
