import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

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
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'system';
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add('no-transitions');
  }

  const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
  document.documentElement.classList.toggle('dark', isDark);

  if (suppressTransitions) {
    document.documentElement.offsetHeight;
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
    theme === 'system' ? (snapshot.systemDark ? 'dark' : 'light') : theme;

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
