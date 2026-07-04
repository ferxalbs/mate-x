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
});
