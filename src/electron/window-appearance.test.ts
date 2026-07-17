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
        backgroundMaterial: undefined,
        nativeMaterialEnabled: false,
        vibrancy: undefined,
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

  it('uses transparent backing and one native material per supported platform', () => {
    assert.deepEqual(
      resolveWindowAppearance(settings({ vibrancyMode: 'sidebar' }), 'darwin', true),
      {
        backgroundColor: '#00000000',
        backgroundMaterial: undefined,
        nativeMaterialEnabled: true,
        vibrancy: 'under-window',
      },
    );
    assert.deepEqual(
      resolveWindowAppearance(settings({ vibrancyMode: 'special' }), 'win32', true),
      {
        backgroundColor: '#00000000',
        backgroundMaterial: 'mica',
        nativeMaterialEnabled: true,
        vibrancy: undefined,
      },
    );
  });

  it('keeps unsupported platforms opaque', () => {
    assert.deepEqual(
      resolveWindowAppearance(settings({ vibrancyMode: 'special' }), 'linux', true),
      {
        backgroundColor: '#111111',
        backgroundMaterial: undefined,
        nativeMaterialEnabled: false,
        vibrancy: undefined,
      },
    );
  });

  it('restores opaque backing when native material is removed at runtime', () => {
    const calls: string[] = [];
    const window = {
      setBackgroundColor: (color: string) => calls.push(`background:${color}`),
      setBackgroundMaterial: (material: 'mica' | 'none') => calls.push(`material:${material}`),
      setVibrancy: (type: 'under-window' | null) => calls.push(`vibrancy:${type}`),
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

    assert.deepEqual(calls, [
      'vibrancy:under-window',
      'background:#00000000',
      'vibrancy:null',
      'background:#111111',
    ]);
  });
});
