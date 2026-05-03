import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'oled' | 'blue' | 'deepblue' | 'deeppurple' | 'casimiri' | 'greenspace' | 'midnight' | 'system';

type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
};

const STORAGE_KEY = 'mate-x:theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;

function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getStoredTheme(): Theme {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (
    raw === 'light' ||
    raw === 'dark' ||
    raw === 'oled' ||
    raw === 'blue' ||
    raw === 'deepblue' ||
    raw === 'deeppurple' ||
    raw === 'casimiri' ||
    raw === 'greenspace' ||
    raw === 'midnight' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'system';
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add('no-transitions');
  }

  const isDark =
    theme === 'dark' ||
    theme === 'oled' ||
    theme === 'blue' ||
    theme === 'deepblue' ||
    theme === 'deeppurple' ||
    theme === 'casimiri' ||
    theme === 'greenspace' ||
    theme === 'midnight' ||
    (theme === 'system' && getSystemDark());
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('theme-oled', theme === 'oled');
  document.documentElement.classList.toggle('theme-blue', theme === 'blue');
  document.documentElement.classList.toggle('theme-deepblue', theme === 'deepblue');
  document.documentElement.classList.toggle('theme-deeppurple', theme === 'deeppurple');
  document.documentElement.classList.toggle('theme-casimiri', theme === 'casimiri');
  document.documentElement.classList.toggle('theme-greenspace', theme === 'greenspace');
  document.documentElement.classList.toggle('theme-midnight', theme === 'midnight');

  if (suppressTransitions) {
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  }
}

applyTheme(getStoredTheme());

function getSnapshot(): ThemeSnapshot {
  const theme = getStoredTheme();
  const systemDark = theme === 'system' ? getSystemDark() : false;

  if (lastSnapshot && lastSnapshot.theme === theme && lastSnapshot.systemDark === systemDark) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark };
  return lastSnapshot;
}

function subscribe(listener: () => void) {
  listeners.push(listener);

  const query = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system', true);
      emitChange();
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(getStoredTheme(), true);
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
  const theme = snapshot.theme;
  const resolvedTheme: 'light' | 'dark' =
    theme === 'system'
      ? snapshot.systemDark
        ? 'dark'
        : 'light'
      : theme === 'oled' ||
        theme === 'blue' ||
        theme === 'deepblue' ||
        theme === 'deeppurple' ||
        theme === 'casimiri' ||
        theme === 'greenspace' ||
        theme === 'midnight'
        ? 'dark'
        : theme;

  const setTheme = useCallback((nextTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme, true);
    emitChange();
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, resolvedTheme, setTheme } as const;
}
