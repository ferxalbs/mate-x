import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ToolExecutionRecord } from '../evidence-pack';
import type { WorkPlan } from './types';
import {
  evaluateValidationGate,
  mutationOccurredInLedger,
} from './validation-gate';

function plan(required = true): WorkPlan {
  return {
    id: 'wp1',
    objective: 'test',
    risk: 'medium',
    mode: 'build',
    validationPlan: {
      required,
      primaryCommand: 'bun test',
      fallbackCommand: null,
    },
  } as unknown as WorkPlan;
}

function tool(
  toolName: string,
  output = '',
): ToolExecutionRecord {
  return {
    toolName,
    output,
  } as ToolExecutionRecord;
}

describe('validation gate NES-5.1 [strict ledger]', () => {
  it('blocks when validation required and no tools ran', () => {
    const gate = evaluateValidationGate(plan(), [], 'still working');
    assert.equal(gate.allowed, false);
  });

  it('allows text waive only when mutation ledger empty', () => {
    const gate = evaluateValidationGate(
      plan(),
      [tool('read', 'file contents')],
      'No changes detected; read-only review.',
    );
    assert.equal(gate.allowed, true);
  });

  it('mutation + no-changes prose still blocks (adversarial)', () => {
    const gate = evaluateValidationGate(
      plan(),
      [tool('auto_patch', 'patched src/foo.ts'), tool('file_editor', 'wrote')],
      'No changes detected. Nothing to validate. Read-only.',
    );
    assert.equal(gate.allowed, false);
    assert.ok(
      gate.warnings.some((w) => /mutation ledger/i.test(w)),
    );
  });

  it('mutationOccurredInLedger detects patch tools', () => {
    assert.equal(mutationOccurredInLedger([tool('auto_patch')]), true);
    assert.equal(mutationOccurredInLedger([tool('read')]), false);
    assert.equal(
      mutationOccurredInLedger([tool('run_tests', 'patch_attempted')]),
      true,
    );
  });

  it('allows when validation tools ran after mutation', () => {
    const gate = evaluateValidationGate(
      plan(),
      [tool('auto_patch', 'ok'), tool('run_tests', 'pass')],
      'All tests passed',
    );
    assert.equal(gate.allowed, true);
  });
});
