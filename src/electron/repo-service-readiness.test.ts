import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentRuntimeReadiness } from './orchestration/agent-runtime-readiness';

describe('SDK orchestrator readiness', () => {
  it('preserves the startup failure for an actionable agent-run error', () => {
    const readiness = new AgentRuntimeReadiness<object>();
    readiness.setInitializationError(new Error('Invalid secure storage credentials'));

    assert.equal(
      readiness.getErrorMessage(),
      'Agent runtime failed to initialize: Invalid secure storage credentials',
    );
  });

  it('reports a recoverable not-ready state when startup has no captured failure', () => {
    const readiness = new AgentRuntimeReadiness<object>();

    assert.equal(
      readiness.getErrorMessage(),
      'Agent runtime is not ready. Restart MaTE X and try again.',
    );
  });

  it('clears a captured failure after the orchestrator becomes ready', () => {
    const readiness = new AgentRuntimeReadiness<object>();
    readiness.setInitializationError(new Error('Transient startup failure'));
    readiness.setRuntime({});

    assert.equal(readiness.getErrorMessage(), null);
  });
});
