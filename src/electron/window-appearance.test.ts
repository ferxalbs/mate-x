import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

import { DEFAULT_APP_SETTINGS, type AppSettings } from '../contracts/settings';
import { applyWindowAppearance, resolveWindowAppearance } from './window-appearance';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...overrides };
}

describe('window appearance policy', () => {
  it('uses opaque light and dark backgrounds in solid mode', () => {
    assert.deepEqual(
      resolveWindowAppearance(settings({ appearance: 'light' }), 'darwin', true),
      {
        backgroundColor: '#ffffff',
        nativeMaterialEnabled: false,
      },
    );
    assert.equal(
      resolveWindowAppearance(settings({ appearance: 'dark' }), 'darwin', false)
        .backgroundColor,
      '#111111',
    );
  });

  it('uses system appearance for solid fallback color', () => {
    assert.equal(
      resolveWindowAppearance(settings({ appearance: 'system' }), 'darwin', true)
        .backgroundColor,
      '#111111',
    );
    assert.equal(
      resolveWindowAppearance(settings({ appearance: 'system' }), 'darwin', false)
        .backgroundColor,
      '#ffffff',
    );
  });

  it('never enables native materials — CSS glass owns all blur', () => {
    assert.deepEqual(
      resolveWindowAppearance(settings({ vibrancyMode: 'sidebar' }), 'darwin', true),
      {
        backgroundColor: '#111111',
        nativeMaterialEnabled: false,
      },
    );
    assert.deepEqual(
      resolveWindowAppearance(
        settings({ appearance: 'light', vibrancyMode: 'special' }),
        'win32',
        true,
      ),
      {
        backgroundColor: '#ffffff',
        nativeMaterialEnabled: false,
      },
    );
  });

  it('keeps unsupported platforms opaque', () => {
    assert.deepEqual(
      resolveWindowAppearance(settings({ vibrancyMode: 'special' }), 'linux', true),
      {
        backgroundColor: '#111111',
        nativeMaterialEnabled: false,
      },
    );
  });

  it('sets opaque window backing at runtime without native material calls', () => {
    const calls: string[] = [];
    const window = {
      setBackgroundColor: (color: string) => calls.push(`background:${color}`),
    };

    applyWindowAppearance(
      window,
      settings({ appearance: 'dark', vibrancyMode: 'special' }),
      'darwin',
      false,
    );
    applyWindowAppearance(
      window,
      settings({ appearance: 'dark', vibrancyMode: 'solid' }),
      'darwin',
      false,
    );
    applyWindowAppearance(
      window,
      settings({ appearance: 'light', vibrancyMode: 'special' }),
      'win32',
      false,
    );

    assert.deepEqual(calls, [
      'background:#111111',
      'background:#111111',
      'background:#ffffff',
    ]);
  });
});

