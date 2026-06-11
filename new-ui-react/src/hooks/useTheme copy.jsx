import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const THEMES = {
  dark: {
    key: 'dark',
    label: 'Dark',
    bg: '#0a0a0a',
    cardBg: '#111',
    surface: '#161616',
    border: '#1c1c1c',
    text: '#ffffff',
    textSecondary: '#aaaaaa',
    textMuted: '#666666',
    accent: '#6366f1',
  },
  light: {
    key: 'light',
    label: 'Light',
    bg: '#f5f5f5',
    cardBg: '#ffffff',
    surface: '#fafafa',
    border: '#e5e5e5',
    text: '#111111',
    textSecondary: '#555555',
    textMuted: '#999999',
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

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('pas-theme');
    return saved && THEMES[saved] ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('pas-theme', theme);
    const t = THEMES[theme];
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.setProperty('--color-bg', t.bg);
    root.style.setProperty('--color-card', t.cardBg);
    root.style.setProperty('--color-surface', t.surface);
    root.style.setProperty('--color-border', t.border);
    root.style.setProperty('--color-text', t.text);
    root.style.setProperty('--color-text-secondary', t.textSecondary);
    root.style.setProperty('--color-text-muted', t.textMuted);
    root.style.setProperty('--color-accent', t.accent);
  }, [theme]);

  const cycleTheme = () => {
    const keys = Object.keys(THEMES);
    const idx = keys.indexOf(theme);
    setTheme(keys[(idx + 1) % keys.length]);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme, colors: THEMES[theme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
