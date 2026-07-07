import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveAssistantRunOptions } from './assistant-runbooks';

describe('resolveAssistantRunOptions', () => {
  it('defaults assistant access to approval required', () => {
    assert.equal(resolveAssistantRunOptions().access, 'approval');
  });

  it('preserves explicit full access for trusted callers', () => {
    assert.equal(resolveAssistantRunOptions({ access: 'full' } as Parameters<typeof resolveAssistantRunOptions>[0]).access, 'full');
  });

  it('forces Factory mode to approval access and verification runbook', () => {
    const options = resolveAssistantRunOptions({
      access: 'full',
      mode: 'factory',
      runbookId: 'review_classify_summarize',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.access, 'approval');
    assert.equal(options.runbookId, 'patch_test_verify');
  });

  it('forces Ship mode to approval access and verification runbook', () => {
    const options = resolveAssistantRunOptions({
      access: 'full',
      mode: 'ship',
      runbookId: 'review_classify_summarize',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.access, 'approval');
    assert.equal(options.runbookId, 'patch_test_verify');
  });
});
