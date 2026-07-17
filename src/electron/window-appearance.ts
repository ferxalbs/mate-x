import type { AppSettings } from '../contracts/settings';

const TRANSPARENT_BACKGROUND = '#00000000';
const LIGHT_BACKGROUND = '#ffffff';
const DARK_BACKGROUND = '#111111';

type WindowAppearancePlatform = 'darwin' | 'win32' | string;

type WindowAppearanceTarget = {
  setBackgroundColor(color: string): void;
  setBackgroundMaterial(material: 'mica' | 'none'): void;
  setVibrancy(type: 'under-window' | null): void;
};

type WindowAppearance = {
  backgroundColor: string;
  backgroundMaterial: 'mica' | 'none' | undefined;
  nativeMaterialEnabled: boolean;
  vibrancy: 'under-window' | undefined;
};

function resolveDarkAppearance(settings: AppSettings, systemDark: boolean): boolean {
  return settings.appearance === 'dark' || (settings.appearance === 'system' && systemDark);
}

export function resolveWindowAppearance(
  settings: AppSettings,
  platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  const nativeMaterialEnabled =
    settings.vibrancyMode !== 'solid' && (platform === 'darwin' || platform === 'win32');

  return {
    backgroundColor: nativeMaterialEnabled
      ? TRANSPARENT_BACKGROUND
      : resolveDarkAppearance(settings, systemDark)
        ? DARK_BACKGROUND
        : LIGHT_BACKGROUND,
    backgroundMaterial:
      platform === 'win32' ? (nativeMaterialEnabled ? 'mica' : 'none') : undefined,
    nativeMaterialEnabled,
    vibrancy: platform === 'darwin' && nativeMaterialEnabled ? 'under-window' : undefined,
  };
}

export function applyWindowAppearance(
  window: WindowAppearanceTarget,
  settings: AppSettings,
  platform: WindowAppearancePlatform,
  systemDark: boolean,
): WindowAppearance {
  const appearance = resolveWindowAppearance(settings, platform, systemDark);

  if (platform === 'darwin') {
    window.setVibrancy(appearance.vibrancy ?? null);
  } else if (platform === 'win32') {
    window.setBackgroundMaterial(appearance.backgroundMaterial ?? 'none');
  }

  window.setBackgroundColor(appearance.backgroundColor);
  return appearance;
}
