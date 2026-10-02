/**
 * ThemeContext — dark / light mode
 *
 * Anti-flash strategy:
 *   resolveInitialTheme() runs at module-import time (top-level), applies
 *   data-theme to <html> synchronously, and returns the resolved value.
 *   React state initialises from document.documentElement.dataset.theme so
 *   it always agrees with what is already painted — no flicker.
 *
 * Persistence:
 *   localStorage key: 'voicescribe-theme'   values: 'light' | 'dark'
 *   Theme preference is the ONLY value stored under this key.
 *
 * System preference:
 *   If no localStorage entry exists, prefers-color-scheme is respected.
 *   The user can override at any time via the toggle.
 */

import { createContext, useCallback, useContext, useState } from 'react';

export const STORAGE_KEY = 'voicescribe-theme';

// ---------------------------------------------------------------------------
// Synchronous theme resolution — runs once at module load time.
// Applying the attribute here (before React renders) prevents the brief
// light-flash that a useEffect would cause.
// ---------------------------------------------------------------------------

/** Determine the correct theme without touching React state. */
function resolveInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private mode, security policy)
  }
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

// Apply synchronously — called once at import time.
// In test environments tests can pre-set document.documentElement.dataset.theme
// before importing/mounting and this will be respected by the useState below.
(function applyInitialTheme() {
  const theme = resolveInitialTheme();
  document.documentElement.dataset.theme = theme;
})();

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext({
  theme:       'light',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  // Read from the attribute already applied above.  This lets tests set
  // document.documentElement.dataset.theme in beforeEach and have it
  // reflected here without module-level caching issues.
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? 'light'
  );

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';

      // Flip the attribute immediately — CSS variables switch before repaint.
      document.documentElement.dataset.theme = next;

      // Persist the preference.
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore write errors (private mode, quota exceeded, etc.)
      }

      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
