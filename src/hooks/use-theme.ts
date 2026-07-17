import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { AppearancePreference, ThemePreference } from '../contracts/settings';

export type Appearance = AppearancePreference;
export type Theme = ThemePreference;

type ThemeSnapshot = {
  appearance: Appearance;
  theme: Theme;
  blurEnabled: boolean;
  systemDark: boolean;
};

const APPEARANCE_KEY = 'mate-x:appearance';
const THEME_KEY = 'mate-x:theme-v2';
const BLUR_KEY = 'mate-x:blur';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getStoredAppearance(): Appearance {
  const raw = localStorage.getItem(APPEARANCE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'system';
}

function getStoredTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  if (
    raw === 'default' ||
    raw === 'oled' ||
    raw === 'blue' ||
    raw === 'deepblue' ||
    raw === 'deeppurple' ||
    raw === 'casimiri' ||
    raw === 'greenspace' ||
    raw === 'midnight'
  ) {
    return raw;
  }
  return 'default';
}

function getStoredBlur(): boolean {
  const raw = localStorage.getItem(BLUR_KEY);
  // Default off — matches DEFAULT_APP_SETTINGS.blurEnabled (was true when unset).
  return raw === 'true';
}

function applyTheme(appearance: Appearance, theme: Theme, blurEnabled: boolean, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add('no-transitions');
  }

  const isDark = appearance === 'dark' || (appearance === 'system' && getSystemDark());
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('blur-enabled', blurEnabled);

  // Theme CSS owns glass tokens; clear legacy inline overrides that forced washout.
  document.documentElement.style.removeProperty('--blur-opacity');

  const themes: Theme[] = ['default', 'oled', 'blue', 'deepblue', 'deeppurple', 'casimiri', 'greenspace', 'midnight'];
  for (const t of themes) {
    document.documentElement.classList.toggle(`theme-${t}`, theme === t);
  }

  if (suppressTransitions) {
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  }
}

applyTheme(getStoredAppearance(), getStoredTheme(), getStoredBlur());

function getSnapshot(): ThemeSnapshot {
  const appearance = getStoredAppearance();
  const theme = getStoredTheme();
  const blurEnabled = getStoredBlur();
  const systemDark = appearance === 'system' ? getSystemDark() : false;

  if (
    lastSnapshot &&
    lastSnapshot.appearance === appearance &&
    lastSnapshot.theme === theme &&
    lastSnapshot.blurEnabled === blurEnabled &&
    lastSnapshot.systemDark === systemDark
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { appearance, theme, blurEnabled, systemDark };
  return lastSnapshot;
}

function subscribe(listener: () => void) {
  listeners.push(listener);

  const query = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    if (getStoredAppearance() === 'system') {
      applyTheme('system', getStoredTheme(), getStoredBlur(), true);
      emitChange();
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_KEY || event.key === THEME_KEY || event.key === BLUR_KEY) {
      applyTheme(getStoredAppearance(), getStoredTheme(), getStoredBlur(), true);
      emitChange();
    }
  };

  query.addEventListener('change', handleMediaChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    query.removeEventListener('change', handleMediaChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { appearance, theme, blurEnabled } = snapshot;

  const resolvedTheme: 'light' | 'dark' =
    appearance === 'system' ? (snapshot.systemDark ? 'dark' : 'light') : appearance;

  const setAppearance = useCallback((next: Appearance) => {
    localStorage.setItem(APPEARANCE_KEY, next);
    applyTheme(next, getStoredTheme(), getStoredBlur(), true);
    emitChange();
  }, []);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_KEY, next);
    applyTheme(getStoredAppearance(), next, getStoredBlur(), true);
    emitChange();
  }, []);

  const setBlurEnabled = useCallback((next: boolean) => {
    localStorage.setItem(BLUR_KEY, String(next));
    applyTheme(getStoredAppearance(), getStoredTheme(), next, true);
    emitChange();
  }, []);

  useEffect(() => {
    applyTheme(appearance, theme, blurEnabled);
  }, [appearance, theme, blurEnabled]);

  return { appearance, theme, blurEnabled, resolvedTheme, setAppearance, setTheme, setBlurEnabled } as const;
}
