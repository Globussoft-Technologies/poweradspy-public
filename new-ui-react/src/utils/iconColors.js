// Shared icon-color palette + light-theme remap.
//
// Icon color utilities are authored for the dark theme (bright `-400`/hex tones on
// a dark surface). In light theme those read as washed-out/dull on white, so we swap
// each to a darker, higher-contrast variant. Used by every surface that renders
// colored lucide icons on a themeable background (AnalyticsModal detail rows +
// engagement metrics, MasonryCard engagement stats) so the palette can't drift
// between them.
//
// Usage: className={iconColorClass('text-violet-400', isLight)}

export const LIGHT_ICON_COLOR = {
  'text-blue-400': 'text-blue-600',
  'text-emerald-400': 'text-emerald-600',
  'text-orange-400': 'text-orange-600',
  'text-pink-400': 'text-pink-600',
  'text-yellow-400': 'text-yellow-600',
  'text-cyan-400': 'text-cyan-600',
  'text-purple-400': 'text-purple-600',
  'text-red-500': 'text-red-600',
  'text-teal-400': 'text-teal-600',
  'text-violet-400': 'text-violet-600',
  'text-fuchsia-400': 'text-fuchsia-600',
  'text-green-400': 'text-green-600',
  'text-indigo-400': 'text-indigo-600',
  'text-sky-400': 'text-sky-600',
  'text-amber-400': 'text-amber-600',
  'text-[#6b99ff]': 'text-[#2f5fd0]',
  'text-[#5f8ae7]': 'text-[#2f5fd0]',
  'text-slate-400': 'text-slate-600',
};

/**
 * Resolve an icon color class for the active theme.
 * Light theme → the darker mapped variant (or the original if unmapped).
 * Dark theme  → the original color, at 80% opacity when `dim` (the softer
 *   detail-row look) or full strength when `dim=false` (higher contrast, e.g.
 *   the engagement-metric row testers asked to make punchier).
 */
export const iconColorClass = (color, isLight, dim = true) =>
  isLight ? (LIGHT_ICON_COLOR[color] || color) : (dim ? `${color} opacity-80` : color);
