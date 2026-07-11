import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RainyModelCatalogEntry } from '../../../contracts/rainy';
import { buildModelPowerOptions, getModelPowerLabel } from './model-power-selector';

const model = (id: string, label: string, output = '0'): RainyModelCatalogEntry => ({
  id,
  label,
  description: null,
  ownedBy: null,
  supportedApiModes: ['responses'],
  preferredApiMode: 'responses',
  pricing: { input: '0', output },
});

describe('model power selector', () => {
  it('keeps only GPT-5.6 and Claude families ordered from fastest to smartest', () => {
    const options = buildModelPowerOptions([
      model('openai/gpt-5.6-sol-pro', 'GPT-5.6 Sol Pro', '20'),
      model('anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6', '8'),
      model('other/model', 'Unrelated Model'),
      model('openai/gpt-5.6-luna-light', 'GPT-5.6 Luna Light', '1'),
      model('anthropic/claude-opus-4.6', 'Claude Opus 4.6', '15'),
    ]);

    assert.deepEqual(options.map(({ model: entry }) => entry.id), [
      'openai/gpt-5.6-luna-light',
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.6',
      'openai/gpt-5.6-sol-pro',
    ]);
  });

  it('uses declared price to order variants in the same power tier', () => {
    const options = buildModelPowerOptions([
      model('anthropic/claude-opus-expensive', 'Claude Opus Expensive', '30'),
      model('openai/gpt-5.6-sol', 'GPT-5.6 Sol', '12'),
    ]);

    assert.deepEqual(options.map(({ model: entry }) => entry.id), [
      'openai/gpt-5.6-sol',
      'anthropic/claude-opus-expensive',
    ]);
  });

  it('labels the endpoints and intermediate family modes', () => {
    assert.equal(getModelPowerLabel(0, 4), 'Faster');
    assert.equal(getModelPowerLabel(1, 4), 'Balanced');
    assert.equal(getModelPowerLabel(3, 4), 'Smartest');
  });
});
