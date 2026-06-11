// Tailwind v4 is handled by the @tailwindcss/vite plugin (see vite.config.js),
// so no Tailwind PostCSS plugin is needed here. This empty config exists to
// stop PostCSS from walking up the directory tree and picking up the
// Tailwind v3 config in a parent folder (D:\Ab Saurav\postcss.config.js),
// which is incompatible with the v4 `@import "tailwindcss"` syntax.
export default {
  plugins: {},
}
