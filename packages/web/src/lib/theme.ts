import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'finance-theme';

/** The persisted theme, defaulting to light (the app's new default look). */
export function getStoredTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return 'light';
}

/** Apply a theme to <html> (drives every CSS variable) and remember it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Set the initial theme before React renders, to avoid a flash of the wrong one. */
export function initTheme(): void {
  document.documentElement.setAttribute('data-theme', getStoredTheme());
}

/** React state bound to the current theme, with a setter that persists + applies. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, setThemeState];
}
