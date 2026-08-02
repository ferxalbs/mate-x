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
    mode: 'execute',
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
  parsedOutput?: Record<string, unknown>,
): ToolExecutionRecord {
  return {
    toolName,
    output,
    parsedOutput,
  } as ToolExecutionRecord;
}

describe('validation gate NES-5.1 [strict ledger]', () => {
  it('blocks when validation required and no tools ran', () => {
    const gate = evaluateValidationGate(plan(), [], 'still working');
    assert.equal(gate.allowed, false);
  });

  it('does not treat no-change prose as a validation exemption', () => {
    const gate = evaluateValidationGate(
      plan(),
      [tool('read', 'file contents')],
      'No changes detected; read-only review.',
    );
    assert.equal(gate.allowed, false);
    assert.ok(gate.warnings.some((warning) => /validation required/i.test(warning)));
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
    assert.equal(mutationOccurredInLedger([tool('auto_patch', 'patched src/foo.ts')]), true);
    assert.equal(mutationOccurredInLedger([tool('read')]), false);
    assert.equal(
      mutationOccurredInLedger([tool('run_tests', 'patch_attempted')]),
      false,
    );
  });

  it('allows when validation tools ran after mutation', () => {
    const gate = evaluateValidationGate(
      plan(),
      [
        tool('auto_patch', 'patched src/foo.ts'),
        tool('run_tests', 'pass', {
          status: 'success',
          validationExecution: {
            executionId: 'validation-exec',
            command: 'bun test',
            processStarted: true,
            exitCode: 0,
            requirementId: 'test',
          },
        }),
      ],
      'All tests passed',
    );
    assert.equal(gate.allowed, true);
  });

  it('requires every planned validation requirement, not only one passing check', () => {
    const requiredPlan = {
      ...plan(),
      validationPlan: {
        required: true,
        primaryCommand: 'bun test',
        fallbackCommand: null,
        requirements: [
          { id: 'test', command: 'bun test', availability: 'resolved' },
          {
            id: 'typecheck',
            command: null,
            availability: 'unresolved',
            unavailableCause: 'TYPECHECK_UNAVAILABLE',
          },
        ],
      },
    } as WorkPlan;
    const gate = evaluateValidationGate(
      requiredPlan,
      [tool('run_tests', 'pass', {
        status: 'success',
        validationExecution: {
          executionId: 'test-exec',
          command: 'bun test',
          processStarted: true,
          exitCode: 0,
          requirementId: 'test',
        },
      })],
      'Tests passed',
    );

    assert.equal(gate.allowed, false);
  });

  it('allows an explicitly approved fallback for an unresolved requirement', () => {
    const requiredPlan = {
      ...plan(),
      validationPlan: {
        required: true,
        primaryCommand: 'bun test',
        fallbackCommand: null,
        requirements: [
          { id: 'test', command: 'bun test', availability: 'resolved' },
          {
            id: 'typecheck',
            command: null,
            availability: 'unresolved',
            unavailableCause: 'TYPECHECK_UNAVAILABLE',
          },
        ],
      },
    } as WorkPlan;
    const gate = evaluateValidationGate(
      requiredPlan,
      [
        tool('run_tests', 'pass', {
          status: 'success',
          validationExecution: {
            executionId: 'test-exec',
            command: 'bun test',
            processStarted: true,
            exitCode: 0,
            requirementId: 'test',
          },
        }),
        tool('sandbox_run', 'pass', {
          status: 'completed',
          validationExecution: {
            executionId: 'approved-typecheck-exec',
            command: 'bun x tsc --noEmit',
            processStarted: true,
            exitCode: 0,
            requirementId: 'typecheck',
            authorization: 'approved_override',
          },
        }),
      ],
      'Tests and typecheck passed',
    );

    assert.equal(gate.allowed, true);
  });
});
