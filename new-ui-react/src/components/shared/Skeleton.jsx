import React, { useMemo } from 'react';

/**
 * Shared skeleton/shimmer system — every data-fetching widget in the app should
 * build its loading state from these primitives instead of a one-off animate-pulse
 * div, so the loading experience (animation feel, timing, theme behaviour) is
 * identical everywhere.
 *
 * Colors come from the `.skeleton-block` CSS class (index.css), NOT a
 * `bg-theme-text/NN` opacity tint — an earlier version used that and it was
 * near-invisible in light mode: 10% black tinted onto the light theme's
 * already near-white page background (--color-bg: #f1f5f9) computes to a
 * color practically identical to the page itself. `.skeleton-block` instead
 * uses an EXPLICIT solid color per theme (mirroring `.media-shimmer`, the
 * same fix already applied once for MasonryCard's image-loading skeleton),
 * so contrast against the page is guaranteed regardless of theme.
 *
 * Deterministic "randomness": bar-width variance uses a seeded pseudo-random
 * (not Math.random()) so a skeleton's shape is stable across re-renders while
 * still loading — Math.random() would make bars visibly jump on every parent
 * re-render, which reads as jittery/broken rather than "alive".
 */

function seeded(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ── Base block ───────────────────────────────────────────────────────────────
// Every other primitive composes this. `shimmer=false` renders a static block
// (used for e.g. a table's already-final header row that shouldn't animate).
export function Skeleton({ className = '', style, rounded = 'rounded-md', shimmer = true }) {
  return (
    <div
      className={`skeleton-block ${shimmer ? '' : 'skeleton-no-shimmer'} ${rounded} ${className}`}
      style={style}
    />
  );
}

// ── Single text line, variable width ────────────────────────────────────────
// `width` accepts any CSS width ('60%', '8rem', 120). `seed` drives a small
// randomized width when `width` isn't given, so a paragraph of these doesn't
// look like a robotic stack of identical bars.
export function SkeletonText({ width, seed = 0, className = 'h-3' }) {
  const w = width ?? `${Math.round(55 + seeded(seed) * 40)}%`;
  return <Skeleton className={className} style={{ width: w }} />;
}

// ── Line-chart shaped placeholder ───────────────────────────────────────────
// Keeps a faint baseline + a couple of soft wavy "curve" paths so it reads as
// a chart, not a grey rectangle. The sweep overlay animates over the whole
// plot area; the curves themselves are static (their shape doesn't matter,
// it's decorative), matching the "keep the plot shape recognizable" spec.
export function SkeletonChartLine({ height = 220, lines = 2, className = '' }) {
  const paths = useMemo(() => {
    const w = 400;
    return Array.from({ length: lines }).map((_, li) => {
      const points = Array.from({ length: 7 }).map((_, i) => {
        const x = (w / 6) * i;
        const base = height * (0.35 + li * 0.18);
        const y = base + (seeded(li * 97 + i * 13) - 0.5) * height * 0.3;
        return [x, Math.max(6, Math.min(height - 6, y))];
      });
      const d = points.reduce((acc, [x, y], i) => (i === 0 ? `M${x},${y}` : `${acc} L${x},${y}`), '');
      return { d, opacity: 0.5 - li * 0.15 };
    });
  }, [height, lines]);

  return (
    <div className={`skeleton-block relative rounded-lg ${className}`} style={{ height }}>
      {/* baseline + faint gridlines — theme-border is an explicit, always-visible
          divider color in both themes, unlike a computed text-opacity tint. */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-theme-border" />
      {[0.25, 0.5, 0.75].map((p) => (
        <div key={p} className="absolute inset-x-0 h-px bg-theme-border opacity-60" style={{ bottom: `${p * 100}%` }} />
      ))}
      <svg viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke="currentColor" strokeWidth={2} className="text-theme-text-muted" style={{ opacity: p.opacity + 0.3 }} />
        ))}
      </svg>
    </div>
  );
}

// ── Bar-chart placeholder (horizontal or vertical bars) ─────────────────────
// Widths/heights vary per-bar (seeded) so it doesn't look like a uniform grid.
export function SkeletonBarChart({ bars = 6, orientation = 'horizontal', height = 160, className = '' }) {
  if (orientation === 'vertical') {
    return (
      <div className={`flex items-end gap-2 ${className}`} style={{ height }}>
        {Array.from({ length: bars }).map((_, i) => (
          <Skeleton key={i} className="flex-1" rounded="rounded-t-md" style={{ height: `${30 + seeded(i * 7) * 65}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-2.5 justify-center ${className}`} style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" rounded="rounded-full" style={{ width: `${25 + seeded(i * 11) * 70}%` }} />
      ))}
    </div>
  );
}

// ── Ranked-table row placeholder ─────────────────────────────────────────────
// Column widths match TrendTable's real row layout exactly (w-4 rank · flex-1
// label · w-[96px] bar · w-16 change · w-5 menu) so swapping to real data
// causes zero layout shift.
export function SkeletonTableRow({ index = 0 }) {
  const labelPct = 35 + seeded(index * 3.1) * 40;
  const barPct = 20 + seeded(index * 5.7 + 2) * 80;
  return (
    <div className="flex items-center gap-2 py-[7px] border-b border-theme-border/60 last:border-0">
      <Skeleton className="w-4 h-2.5" />
      <Skeleton className="h-2.5 flex-1 max-w-[220px]" style={{ maxWidth: `${labelPct}%` }} />
      <div className="w-[96px] hidden sm:block">
        <Skeleton className="h-1.5" rounded="rounded-full" style={{ width: `${barPct}%` }} />
      </div>
      <Skeleton className="w-10 h-2.5 ml-auto" />
      <div className="w-5" />
    </div>
  );
}

export function SkeletonTableRows({ rows = 6 }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => <SkeletonTableRow key={i} index={i} />)}
    </div>
  );
}

// ── Stat-card placeholder (label + big number, optional sub-line) ───────────
export function SkeletonStatCard({ className = '' }) {
  return (
    <div className={`rounded-2xl border border-theme-border bg-theme-card px-4 py-3.5 shadow-sm ${className}`}>
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-6 w-14 mt-2.5" />
    </div>
  );
}

// ── Card wrapper — title/subtitle bars + a slot for any widget above ────────
// Mirrors the real Panel's outer classes (p-3.5 rounded-xl border bg-theme-bg)
// so a skeleton card sits flush with its loaded counterpart — no visible
// resize when data arrives.
export function SkeletonCard({ title = true, subtitle = false, className = '', children }) {
  return (
    <div className={`p-3.5 rounded-xl border border-theme-border bg-theme-bg flex flex-col gap-2.5 min-w-0 ${className}`}>
      {title && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex flex-col gap-1.5">
            <Skeleton className="h-3 w-28" />
            {subtitle && <Skeleton className="h-2 w-40" />}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Cross-fade wrapper for the real-content branch ───────────────────────────
// Applies the app's existing tw-animate-css entrance utility (already used
// across App.jsx / modals) so the swap from skeleton → real content is a soft
// 200ms fade instead of a hard pop. Purely presentational — wrap whatever
// renders once `loading` is false.
export function FadeIn({ className = '', children }) {
  return <div className={`animate-in fade-in duration-200 ${className}`}>{children}</div>;
}

// ── Inline error + retry affordance ─────────────────────────────────────────
// Spec: "never an infinite shimmer" — every panel that can fail should show
// this instead of silently swallowing the error into an empty state.
export function ErrorRetry({ message = 'Something went wrong.', onRetry, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className}`}>
      <p className="text-[12px] text-theme-text-muted max-w-xs">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-theme-border text-theme-text hover:bg-theme-text/[0.06] transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
