import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';

import { resolveRunIntentOutcome } from '../capability-resolver';
import { classifyWorkIntent } from './intent';

const acmeReviewPrompt = `The Acme SDK was upgraded to v3.

Find every incompatible use of the old customer API, explain what will break,
and identify the required migration. Do not modify the repository.`;

const acmeExecutePrompt = `Migrate every Acme SDK v2 customer API call to v3.

Update the three runtime service call sites, search for remaining deprecated
usages, and run the focused tests plus typecheck. Do not modify tests unless required.`;

describe('work intent classification', () => {
  const cases = [
    ['Do not modify anything. Show me what should change.', 'inspect'],
    ['Tell me how you would fix this.', 'inspect'],
    ['Identify the required migration.', 'inspect'],
    ['Review and fix the errors.', 'patch'],
    ['Edit README.md.', 'patch'],
    [acmeExecutePrompt, 'patch'],
    [acmeReviewPrompt, 'inspect'],
  ] as const;

  for (const [prompt, expectedIntent] of cases) {
    test(`${prompt} → ${expectedIntent}`, () => {
      assert.equal(classifyWorkIntent(prompt), expectedIntent);
    });
  }

  test('explicit read-only constraints take precedence over mutation language', () => {
    assert.equal(
      classifyWorkIntent('Explain the fix without making any code changes.'),
      'inspect',
    );
  });

  test('scoped mutation constraints do not make the whole request read-only', () => {
    assert.equal(
      classifyWorkIntent('Fix the runtime. Do not modify tests unless required.'),
      'patch',
    );
  });

  test('Review pre-blocks only unambiguous mutation intent', () => {
    assert.equal(
      resolveRunIntentOutcome({
        behaviorMode: 'review',
        intent: classifyWorkIntent('Edit README.md.'),
      })?.blocker.code,
      'MODE_READ_ONLY',
    );
    assert.equal(
      resolveRunIntentOutcome({
        behaviorMode: 'review',
        intent: classifyWorkIntent(acmeReviewPrompt),
      }),
      undefined,
    );
  });

  test('Execute does not pre-block explicit mutation intent', () => {
    assert.equal(
      resolveRunIntentOutcome({
        behaviorMode: 'execute',
        intent: classifyWorkIntent('Edit README.md.'),
      }),
      undefined,
    );
  });
});
