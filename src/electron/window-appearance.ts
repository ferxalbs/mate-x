import type { AppSettings } from '../contracts/settings';

const LIGHT_BACKGROUND = '#ffffff';
const DARK_BACKGROUND = '#111111';

type WindowAppearancePlatform = 'darwin' | 'win32' | string;

/**
 * Electron window chrome target. Mica / acrylic / native vibrancy are never used:
 * they fight CSS backdrop-filter and produce unstable transparent controls.
 * Window stays solid; glass is CSS-only on single-layer surfaces.
 */
type WindowAppearanceTarget = {
  setBackgroundColor(color: string): void;
  setBackgroundMaterial?(material: 'none'): void;
  setVibrancy?(type: null): void;
};

type WindowAppearance = {
  backgroundColor: string;
  /** Always 'none' on Windows; undefined elsewhere. Mica is permanently disabled. */
  backgroundMaterial: 'none' | undefined;
  nativeMaterialEnabled: false;
  vibrancy: undefined;
};

function resolveDarkAppearance(settings: AppSettings, systemDark: boolean): boolean {
  return settings.appearance === 'dark' || (settings.appearance === 'system' && systemDark);
}

export function resolveWindowAppearance(
  settings: AppSettings,
  platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  return {
    // Opaque window backing so CSS glass blurs ambient + app content, not the desktop.
    // Native under-window materials cannot blur DOM content and break nested controls.
    backgroundColor: resolveDarkAppearance(settings, systemDark)
      ? DARK_BACKGROUND
      : LIGHT_BACKGROUND,
    backgroundMaterial: platform === 'win32' ? 'none' : undefined,
    nativeMaterialEnabled: false,
    vibrancy: undefined,
  };
}

export function applyWindowAppearance(
  window: WindowAppearanceTarget,
  settings: AppSettings,
  platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  const appearance = resolveWindowAppearance(settings, platform, systemDark);

  // Force-clear any leftover native materials from older builds.
  if (platform === 'darwin' && typeof window.setVibrancy === 'function') {
    window.setVibrancy(null);
  } else if (platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
    window.setBackgroundMaterial('none');
  }

  window.setBackgroundColor(appearance.backgroundColor);
  return appearance;
}
