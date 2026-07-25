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

  it('preserves an explicit review runbook for verify_only', () => {
    const options = resolveAssistantRunOptions({
      access: 'full',
      pathKind: 'verify_only',
      runbookId: 'review_classify_summarize',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.pathKind, 'verify_only');
    assert.equal(options.runbookId, 'review_classify_summarize');
  });

  it('defaults verify_only to the verification runbook when no runbook is supplied', () => {
    const options = resolveAssistantRunOptions({
      access: 'approval',
      pathKind: 'verify_only',
    } as Parameters<typeof resolveAssistantRunOptions>[0]);

    assert.equal(options.runbookId, 'patch_test_verify');
  });

  it('preserves and defaults the canonical autonomy policy', () => {
    assert.deepEqual(resolveAssistantRunOptions().autonomyPolicy, {
      id: 'auto_scoped',
    });

    const custom = resolveAssistantRunOptions({
      access: 'approval',
      autonomyPolicy: {
        id: 'custom',
        custom: {
          askBeforeEdits: false,
          askBeforeCommands: true,
          askBeforeNetwork: false,
          askBeforeGit: true,
          autoValidate: false,
        },
      },
      reasoningEnabled: true,
      reasoning: 'high',
    });

    assert.deepEqual(custom.autonomyPolicy, {
      id: 'custom',
      custom: {
        askBeforeEdits: false,
        askBeforeCommands: true,
        askBeforeNetwork: false,
        askBeforeGit: true,
        autoValidate: false,
      },
    });
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
