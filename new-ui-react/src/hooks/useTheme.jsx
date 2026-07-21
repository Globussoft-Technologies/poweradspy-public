import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';

const ThemeContext = createContext();

export const THEMES = {
  dark: {
    key: 'dark',
    label: 'Dark',
    bg: '#0a0a0a',
    // cardBg/surface/border used to sit within ~1-2% luminance of `bg`
    // (#111/#161616/#1c1c1c vs #0a0a0a), so cards, dropdowns, and hairlines
    // never visually separated from the page — the "everything is muddy"
    // report. Stepped up to a real elevation ladder (page → card → surface),
    // mirroring the clear bg→white jump light mode gets for free.
    cardBg: '#1c1c1f',
    surface: '#24252a',
    border: '#34353b',
    text: '#ffffff',
    textSecondary: '#aaaaaa',
    // Was #666666 on #0a0a0a (~3.4:1, fails WCAG AA for text). Brightened
    // to clear 4.5:1 so secondary labels/icons read clearly, like light
    // mode's #64748b does against its own background.
    textMuted: '#8a8a90',
    accent: '#6366f1',
  },
  light: {
    key: 'light',
    label: 'Light',
    // Page bg = slate-100. Sidebar/header are overridden to pure white in
    // index.css, so the page sits one shade darker than the chrome —
    // mirrors the dark-mode hierarchy where the chrome reads lighter
    // than the page.
    bg: '#f1f5f9',
    cardBg: '#ffffff',
    surface: '#fafafa',
    border: '#e5e5e5',
    // Slate-900 — the spec-mandated primary text colour in light mode.
    // Used everywhere text-theme-text resolves and as the target for
    // remapped text-white/XX utilities in the light-mode override layer.
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    accent: '#6366f1',
  },
  midnight: {
    key: 'midnight',
    label: 'Midnight',
    bg: '#0c1222',
    cardBg: '#111827',
    surface: '#1a2332',
    border: '#1e2d3d',
    text: '#e2e8f0',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    accent: '#818cf8',
  },
};

const STORAGE_KEY = 'pas-theme';

// Synchronously mirror the picked theme onto <html>: CSS vars, data-theme,
// and the `dark` class (shadcn/tailwind rely on it). Must run synchronously
// so it can sit inside startViewTransition's flushSync without missing the
// snapshot.
const applyThemeToDOM = (themeKey) => {
  /* v8 ignore next -- callers (setTheme guard + readInitialTheme validation) only pass valid keys; the `|| THEMES.light` fallback is defensive */
  const t = THEMES[themeKey] || THEMES.light;
  const root = document.documentElement;
  root.setAttribute('data-theme', themeKey);
  root.classList.toggle('dark', themeKey !== 'light');
  root.style.setProperty('--color-bg', t.bg);
  root.style.setProperty('--color-card', t.cardBg);
  root.style.setProperty('--color-surface', t.surface);
  root.style.setProperty('--color-border', t.border);
  root.style.setProperty('--color-text', t.text);
  root.style.setProperty('--color-text-secondary', t.textSecondary);
  root.style.setProperty('--color-text-muted', t.textMuted);
  root.style.setProperty('--color-accent', t.accent);
};

const readInitialTheme = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch {}
  return 'light';
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  // useLayoutEffect so the DOM matches React state before paint — prevents a
  // one-frame flash of the wrong theme on first render.
  useLayoutEffect(() => {
    applyThemeToDOM(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES[next]) return;
    // Mutate DOM first so callers inside startViewTransition/flushSync get a
    // synchronous before/after snapshot; React state catches up on the same tick.
    applyThemeToDOM(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  const cycleTheme = useCallback(() => {
    const keys = Object.keys(THEMES);
    const idx = keys.indexOf(theme);
    setTheme(keys[(idx + 1) % keys.length]);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, cycleTheme, colors: THEMES[theme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
