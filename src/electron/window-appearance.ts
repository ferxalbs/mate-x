import type { AppSettings } from '../contracts/settings';

const LIGHT_BACKGROUND = '#ffffff';
const DARK_BACKGROUND = '#111111';

type WindowAppearancePlatform = 'darwin' | 'win32' | string;

/**
 * Electron window chrome target.
 * Native window materials (Mica, Acrylic, Windows OS vibrancy) are permanently disabled:
 * they interfere with Chromium/Windows DWM subpixel rendering and fight CSS backdrop-filter.
 * Window backing stays 100% opaque (#ffffff light / #111111 dark); all glass/blur is CSS-only.
 */
type WindowAppearanceTarget = {
  setBackgroundColor(color: string): void;
};

type WindowAppearance = {
  backgroundColor: string;
  nativeMaterialEnabled: false;
};

function resolveDarkAppearance(settings: AppSettings, systemDark: boolean): boolean {
  return settings.appearance === 'dark' || (settings.appearance === 'system' && systemDark);
}

export function resolveWindowAppearance(
  settings: AppSettings,
  _platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  return {
    // Opaque window backing so CSS glass blurs ambient + app content, not the desktop.
    // Native under-window materials cannot blur DOM content and break nested controls.
    backgroundColor: resolveDarkAppearance(settings, systemDark)
      ? DARK_BACKGROUND
      : LIGHT_BACKGROUND,
    nativeMaterialEnabled: false,
  };
}

export function applyWindowAppearance(
  window: WindowAppearanceTarget,
  settings: AppSettings,
  platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  const appearance = resolveWindowAppearance(settings, platform, systemDark);

  window.setBackgroundColor(appearance.backgroundColor);
  return appearance;
}

