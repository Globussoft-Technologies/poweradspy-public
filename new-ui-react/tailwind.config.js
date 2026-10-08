import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        theme: {
          bg: 'var(--color-bg)',
          card: 'var(--color-card)',
          surface: 'var(--color-surface)',
          border: 'var(--color-border)',
          text: 'var(--color-text)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-muted': 'var(--color-text-muted)',
          accent: 'var(--color-accent)',
        },
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0)' },
          '50%': { boxShadow: '0 0 12px 4px rgba(239, 68, 68, 0.3)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out 3',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
      plugins: [],
    }
  },
  plugins: [
    // `pwa:` — installed app on a phone-sized screen, in any browser that can
    // install it (Chrome, Edge, Samsung Internet, Opera, iOS Safari). Keyed off
    // the `pwa-mobile` class the inline script in index.html puts on <html>,
    // so the website (any browser, any width) and the installed desktop app
    // keep their current UI. Detection logic lives in hooks/useInstalledMobile.js.
    plugin(({ addVariant }) => {
      addVariant('pwa', '.pwa-mobile &');
    }),
  ],
}
