import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveAssistantRunOptions } from './assistant-runbooks';

describe('resolveAssistantRunOptions', () => {
  it('defaults assistant access to approval required', () => {
    assert.equal(resolveAssistantRunOptions().access, 'approval');
  });

  it('preserves explicit full access for trusted callers', () => {
    assert.equal(
      resolveAssistantRunOptions({
        access: 'full',
      } as Parameters<typeof resolveAssistantRunOptions>[0]).access,
      'full',
    );
  });

  it('maps verify_only pathKind to verification runbook', () => {
    const options = resolveAssistantRunOptions({
      access: 'full',
      pathKind: 'verify_only',
      runbookId: 'review_classify_summarize',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.pathKind, 'verify_only');
    assert.equal(options.runbookId, 'patch_test_verify');
  });

  it('maps chat_help pathKind to review runbook', () => {
    const options = resolveAssistantRunOptions({
      access: 'approval',
      pathKind: 'chat_help',
      runbookId: 'patch_test_verify',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.pathKind, 'chat_help');
    assert.equal(options.runbookId, 'review_classify_summarize');
  });

  it('does not accept AssistantMode product modes on the public contract', () => {
    const options = resolveAssistantRunOptions({
      access: 'full',
      pathKind: 'full',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);
    assert.equal(options.pathKind, 'full');
    assert.equal('mode' in options, false);
  });
});
