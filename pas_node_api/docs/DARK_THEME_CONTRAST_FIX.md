# Dark Theme Contrast Fix — Manifest

> **Status: IMPLEMENTED.** Fixes the "dark mode looks muddy, features don't
> stand out like they do in light mode" report. Scope is `new-ui-react` only
> (the React frontend) — filed under `pas_node_api/docs` at the requester's
> direction, not because the backend was touched.

---

## 1. The bug

Dark mode's page background, card background, and border colors sat within
roughly **1% luminance of each other**:

| Token | Old value | vs. page bg (`#0a0a0a`) |
|---|---|---|
| `bg` | `#0a0a0a` | — |
| `cardBg` | `#111` | contrast ratio ≈ 1.03:1 |
| `surface` | `#161616` | contrast ratio ≈ 1.1:1 |
| `border` | `#1c1c1c` | contrast ratio ≈ 1.2:1 |
| `textMuted` | `#666666` | ≈ 3.4:1 (fails WCAG AA, needs 4.5:1) |

Light mode has no equivalent problem: the page bg (`#f1f5f9`) flips cards to
solid `#ffffff`, an obvious jump. Dark mode never got the same treatment —
cards, dropdowns, and borders visually merged into the page instead of
"popping."

Two compounding issues on top of the flat palette:

1. **Elevation relied on `box-shadow`, which doesn't work on dark
   backgrounds.** Tailwind's default `shadow-lg`/`shadow-2xl` are low-opacity
   *black* shadows — invisible against an already-near-black card on an
   already-near-black page. This is the single biggest reason cards didn't
   read as "raised."
2. **The main ad-grid card (`MasonryCard`/`Masonry`/`SavedAdsPage`) hardcodes
   `bg-[#0f111a]`** instead of the `theme-card` token, so it didn't benefit
   from any token-level fix. Its border was a flat `border-white/10`
   (10% white on near-black — effectively invisible until hover).

## 2. Root cause

`new-ui-react/src/hooks/useTheme.jsx` defines the `THEMES.dark` palette that
gets pushed onto `<html>` as CSS custom properties (`--color-bg`,
`--color-card`, `--color-surface`, `--color-border`, `--color-text-muted`,
etc.) via `applyThemeToDOM`. ~148 usages across 35 files (`bg-theme-card`,
`bg-theme-surface`, `bg-theme-bg`) consume these tokens directly, so the flat
palette was the single point of failure for most of the app's chrome
(sidebar, header, filters, modals, keyword explorer).

The ad-grid card is the one major exception: it hardcodes hex values in
`new-ui-react/src/index.css` and 12 component files instead of using the
tokens (`bg-[#0f111a]`, `border-white/10`, `shadow-lg`). `index.css` already
has a `[data-theme="light"]` override layer that remaps these same hardcoded
classes to light equivalents — dark mode had no equivalent hardening layer.

## 3. Fix

### 3a. Theme tokens — `new-ui-react/src/hooks/useTheme.jsx`

Replaced the flat dark palette with a real elevation ladder (page → card →
surface), plus a brighter muted-text color:

```js
dark: {
  bg: '#0a0a0a',        // unchanged
  cardBg: '#1c1c1f',    // was #111
  surface: '#24252a',   // was #161616
  border: '#34353b',    // was #1c1c1c
  textMuted: '#8a8a90', // was #666666 (now clears 4.5:1 on #0a0a0a)
  // text, textSecondary, accent unchanged
},
```

This alone fixes every component that already uses `theme-card` /
`theme-surface` / `theme-border` / `theme-text-muted` — no component changes
needed.

### 3b. Dark-mode card hardening layer — `new-ui-react/src/index.css`

Added a `[data-theme="dark"]` block (mirroring the existing
`[data-theme="light"]` override-layer pattern) targeting the ad-grid card's
hardcoded classes specifically:

- `bg-[#0f111a]` (+ `/80`, `/90` opacity variants) lightened to `#1c1c1f` so
  the card separates from the page.
- `border-white/10` brightened to 14% opacity; `hover:border-white/25`
  brightened to 32%.
- `shadow-lg` / `hover:shadow-2xl` replaced with shadows that pair a deeper
  black falloff with a faint white rim (`0 0 0 1px rgb(255 255 255 / 0.04–0.08)`),
  so elevation is visible against a black background instead of relying on
  an invisible black-on-black shadow.

Scoped to `[data-theme="dark"]` only — `midnight` (a third theme option)
already has its own distinct, separated palette and wasn't part of the
report.

## 4. Files changed

- `new-ui-react/src/hooks/useTheme.jsx` — dark theme token values
- `new-ui-react/src/index.css` — new `DARK MODE CARD HARDENING LAYER` section
  (appended after the existing `LIGHT MODE OVERRIDE LAYER`)

## 5. What was deliberately left alone

The ~50-file audit (see the exploration behind this fix) found a broader
proliferation of near-duplicate hardcoded dark hex values across the
codebase (`#0a0a0a`, `#0f111a`, `#111827`, `#121212`, `#161616`, `#1a1a1a`,
`#1a1a2e`, `#1c1c1c`, `#1e2235`, `#222`) and two parallel, disconnected
theming systems (the custom `--color-*` tokens above, vs. an unused shadcn
oklch `.dark` block in `index.css` that no component actually references).
Migrating every hardcoded hex to the token system is a multi-day refactor
and wasn't required to resolve the reported contrast issue — this fix
targets the two highest-leverage root causes (token separation + the main
ad card's shadow/border) rather than rewriting all ~50 files.

If a future report surfaces a *specific* component still reading as flat in
dark mode, check first whether it's one of the hardcoded-hex holdouts listed
above rather than assuming the token fix didn't take.
