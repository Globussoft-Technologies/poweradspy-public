# PWA (Installable Mobile App) — Implementation Manifest

Makes the platform FE (`new-ui-react` = platform.poweradspy.com) installable as a
phone app (Progressive Web App). When the app is **launched from its home-screen
icon on a phone**, it renders a phone-optimised UI (bottom navigation, sheets,
compact dropdowns). The **website — desktop and phone browser — is unchanged**.

- **Target:** `new-ui-react` (React 18 + Vite 4 + Tailwind 3)
- **Browsers:** Chrome, Edge, Samsung Internet, Opera (Android) and Safari (iPhone/iPad).
  Firefox is out of scope.
- **Status:** implemented & verified locally (build passes; real Android phone via
  Cloudflare tunnel; simulated Android/iOS installed + phone browser + desktop).
  **Pending:** real iPhone, Samsung Internet, and login from inside the installed app.

---

## 1. How users install

| Platform | Steps |
| -------- | ----- |
| Android — Chrome / Edge / Samsung Internet / Opera | Browser menu ⋮ → **Install app** / **Add to Home screen** |
| iPhone / iPad — Safari | Share ⬆️ → **Add to Home Screen** |
| Desktop — Chrome / Edge | Install icon in the address bar (opens the normal desktop UI) |

Optional in-app banner (`InstallAppPrompt`, **off by default**, see §5) offers a
one-tap **Install** on Chromium browsers and the Share → Add to Home Screen steps on iOS.

No app store, no separate codebase: the installed app is the same site, served from
the same origin, using the same API, auth and data.

---

## 2. Scoping — what decides "installed phone app"

All installed-app UI is gated on one condition:

```
standalone launch  AND  phone-sized screen (≤ 767px)
```

| Signal | Detects | Browsers |
| ------ | ------- | -------- |
| `matchMedia('(display-mode: standalone)')` | launched from home-screen icon | Chrome, Edge, Samsung Internet, Opera, newer iOS |
| `navigator.standalone === true` | launched from home-screen icon | iOS Safari (incl. older versions without display-mode) |
| `matchMedia('(max-width: 767px)')` | phone-sized | all |

The check runs in **three places that must stay in sync**:

| Where | What it does |
| ----- | ------------ |
| Inline script in `index.html` | Before first paint, adds `pwa-mobile` class to `<html>` (no flash of the website layout). For any standalone launch also appends `viewport-fit=cover` and a `theme-color` meta. |
| `src/hooks/useInstalledMobile.js` | `isInstalledMobileNow()` (sync) + `useInstalledMobile()` hook; re-evaluates on resize / display-mode change and keeps the `pwa-mobile` class in step. |
| `tailwind.config.js` | Custom variant **`pwa:`** → `.pwa-mobile &`. Every installed-app style uses it. |

`index.css` phone rules (compact type scale, scrollbars, blur removal, Freshchat
placement) are also keyed off `.pwa-mobile`.

> ✅ **Website guarantee.** Outside the installed phone app, `pwa-mobile` is never set,
> so no `pwa:` class or `.pwa-mobile` rule applies. Verified by building `main` and this
> branch and diffing the CSS: **0 existing rules removed or changed**; the 12 added rules
> are utilities used only by new installed-app components.

---

## 3. Installability

| Item | Detail |
| ---- | ------ |
| `public/manifest.webmanifest` | `name`/`short_name` "PowerAdSpy", `start_url` `/`, `scope` `/`, `display` `standalone`, `orientation` `portrait`, white theme/background |
| `public/icons/` | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (generated from the favicon design — replace with official brand assets when available) |
| `index.html` | `<link rel="manifest">`, `apple-touch-icon`, `mobile-web-app-capable`, `apple-mobile-web-app-*` tags |
| `theme-color` | Added only for standalone launches; `useTheme.applyThemeToDOM` keeps it matched to the active theme (white in light, theme bg otherwise) |
| Service worker | **None added.** The existing Firebase messaging SW (`firebase-messaging-sw.js`, scope `/`) is untouched. No offline caching. |

---

## 4. Installed-app UI (phone, standalone only)

### 4.1 App shell
| Area | Behaviour |
| ---- | --------- |
| **BottomNav** (new) | Ads Library · All Projects · Saved · Filters (Ads Library only, active-filter count badge) · More (Market Trends, Keywords Explorer, Chat with us). Same access/plan/guest checks as the Sidebar. |
| **Sidebar** | Collapsed icon strip hidden. Opens as a **filters-only bottom sheet** (72% height, "Filters" title + ✕, visible scrollbar); nav links hidden (they live in BottomNav). |
| **Header** | Second row with a **small centred search pill** (purple ring in AI mode). Tapping expands the search bar **in place** to full width (page dimmed behind, ← / ✕ to close) and auto-focuses the input so the keyboard opens. Bell, language and theme toggle visible; profile menu opens on tap (focus-within). The search overlay no longer auto-opens on load. On the website the phone header is unchanged (single row, 🔍 icon → full-screen search). |
| **Scroll** | Header scroll-collapse disabled in `AdGrid` — platforms/filters stay visible, and the `onScrollChange` → `App` state update (full re-render on every scroll) no longer fires, which removed the scroll lag. |
| **Layout** | `100dvh` height, safe-area padding (notch / home bar), content padded clear of BottomNav. Toasts, notification prompt/popup sit above the nav. |
| **Freshchat** | Floating launcher hidden; opened from More → Chat with us (`body.pwa-chat-open` toggles it). |

### 4.2 Screens
| Screen | Behaviour |
| ------ | --------- |
| Date filter | Compact ~300px card under the calendar button; smaller calendar cells, tighter tabs/footer |
| Ad Type | Compact 2-column dropdown under the filter row |
| Sort | Compact dropdown under the filter row |
| Tooltips | "Filter by Date", "Filter by ad type" and "Sort by" hover tooltips hidden (they stuck on tap) |
| Dropdown anchoring | The Date / Ad Type / Sort wrappers go `static` and the filter-bar row is the anchor, so all three open under the row aligned to the screen gutters |
| Ad detail | Bottom sheet with a gap above; media capped ~40% height; sticky Analytics / View Original / Copy bar; close / prev / next in the gap above |
| Analytics | Bottom sheet with top gap; prev/next arrows in the gap above; creative shown inline (~36vh, the desktop floating preview is `lg`-only); Ad Details single-column; Basic Info URL gets its own full-width line; Target Audience rows stack; Country Reach / Lander / Social Engagements / Demographics headers wrap; title truncates |
| Pricing, AI Signals, Advertiser Profile, Keyword Explorer | Full-screen |
| Ad cards | Save / Download / Hide and carousel arrows always visible (no hover on touch); the purple "AI analysed" corner mark is hidden there so it doesn't sit under the action strip |
| Saved, Projects | Platform tabs full-width row; Projects input full width with Continue below |

### 4.3 Global phone rules (`index.css`, under `.pwa-mobile`)
- Root font 15px + one-step-down fixed-px headings (compact scale).
- Thin, light scrollbar on `.pwa-scrollbar` rows/sheets (incl. platform tabs).
- `backdrop-filter` disabled (per-frame repaint caused scroll lag on phones).
- No overscroll bounce / tap highlight.

---

## 5. Install banner (`InstallAppPrompt`)

Shown only in a **phone browser** (not installed, not desktop, not Firefox), 2.5s after load.

| Browser | Banner |
| ------- | ------ |
| Chrome / Edge / Samsung / Opera (Android) | **Install** button → native install dialog (`beforeinstallprompt`) |
| iPhone / iPad | Steps: Share → Add to Home Screen |

- "Not now" snoozes for **7 days** (`localStorage` key `pas.installPrompt.dismissedAt`).
- Hides the Freshchat launcher while visible (`body.pwa-install-open`).
- **Off by default** because it appears on the website. Enable per deploy:

```env
VITE_ENABLE_PWA_INSTALL_PROMPT=true
```

---

## 6. File layout

```
new-ui-react/
├── index.html                         # manifest/apple tags + pwa-mobile detection script
├── tailwind.config.js                 # `pwa:` variant → `.pwa-mobile &`
├── public/
│   ├── manifest.webmanifest           # web app manifest
│   └── icons/                         # 192, 512, maskable-512, apple-touch
└── src/
    ├── hooks/
    │   └── useInstalledMobile.js      # isInstalledMobileNow() + useInstalledMobile()
    ├── components/layout/
    │   ├── BottomNav.jsx              # installed-app bottom navigation
    │   └── InstallAppPrompt.jsx       # opt-in install banner (phone browsers)
    └── index.css                      # .pwa-mobile phone rules + pwaSearchExpand keyframes
```

Pattern for any new installed-app tweak: add **`pwa:`-prefixed classes** (or a
`.pwa-mobile` rule / `useInstalledMobile()` check) — never change base classes, so the
website stays identical.

---

## 7. Testing

**Desktop (no deploy needed)**
```bash
cd new-ui-react
npm run build && npm run preview
```
Chrome → install icon in the address bar → open the installed window → narrow it
below 768px → bottom nav appears. A normal tab at the same width must show the
unchanged website.

**Real phone (local)** — expose the preview over HTTPS (e.g. `cloudflared tunnel --url
http://localhost:4173`), build with the tunnel origin as `VITE_PAS_API_BASE_URL`, and
add the tunnel host to Vite `server.allowedHosts` temporarily. **Revert these before
committing** — they are local-only.

**After deploy (dev)**
1. `https://<site>/manifest.webmanifest` → JSON; `/icons/icon-512.png` → PNG (not `index.html`).
2. Android Chrome → Install app → open from icon → bottom nav + ads load.
3. iPhone Safari → Add to Home Screen → open → **log in** → returns to the app with ads.
4. Website (desktop + phone browser) unchanged.

**Unit tests:** `npx vitest run` — pre-existing failures unrelated to this change
(SliderFilter, FilterRadioList, AudienceSection, api-*, etc.). `Sidebar.test.jsx` needs
`X` added to its `lucide-react` mock (new close icon in the filters sheet).

---

## 8. Deploy notes

- **Build on the server** with its own `.env` (see `obsidian-vault/poweradspy-fe-deploy-mechanism.md`).
  Never upload a local `dist` — a locally built bundle may embed a local/tunnel API URL.
- If deploying file-by-file, include the **new files** (`BottomNav.jsx`,
  `InstallAppPrompt.jsx`, `useInstalledMobile.js`, `manifest.webmanifest`, `icons/`) —
  `App.jsx` imports them, so the build fails without them.
- `vite.config.js` and `package-lock.json` are **not** part of this change.
- The site must be served over **HTTPS** (required for install).
- `serve ./dist` (SPA mode) serves `/manifest.webmanifest` and `/icons/*` as static files;
  confirm they don't fall through to `index.html`.
- Users see the update after the old bundle cache clears (hard refresh / reopen the installed app).

---

## 9. Known limitations / follow-ups

- **iOS login:** installed-app storage is separate from Safari, and the aMember login
  redirect may open in Safari — verify on a real iPhone.
- **No offline/app-shell caching** — would need merging into the Firebase SW
  (one SW per scope).
- **Bundle size** ~3.4 MB (~1 MB gzip) — code-splitting would speed up first launch.
- Guest pages (`GuestPage`, `GuestLandingPage`) not adapted.
- Icons are generated; replace with official brand assets.
- Firefox not supported (by decision).
- `Sidebar.test.jsx` fails until `X` is added to its `lucide-react` mock (test-only).
- Safari/iOS scrollbars may still only show while scrolling (browser behaviour).

---

## 10. Files changed

**Added**
- `public/manifest.webmanifest`
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`
- `src/hooks/useInstalledMobile.js`
- `src/components/layout/BottomNav.jsx`
- `src/components/layout/InstallAppPrompt.jsx`
- `docs/pwa-manifest.md` (this file)

**Modified (installed-app scoped via `pwa:` / `.pwa-mobile` / `useInstalledMobile`)**
- `index.html`, `tailwind.config.js`, `src/index.css`
- `src/App.jsx` — BottomNav + InstallAppPrompt render; nav handlers extracted (shared by Sidebar and BottomNav, same behaviour)
- `src/hooks/useTheme.jsx` — syncs `theme-color` meta when present
- Layout: `Header.jsx`, `Sidebar.jsx`, `NotificationPopup.jsx`, `NotificationPermissionPrompt.jsx`
- Ads: `AdGrid.jsx`, `AdFilterBar.jsx`, `AdDateDropdown.jsx`, `AdDetailModal.jsx`, `MasonryCard.jsx`, `SavedAdsPage.jsx`
- Modals: `AnalyticsModal.jsx`, `PricingModal.jsx`, `KeywordExplorerModal.jsx`, `google/GoogleIntelShared.jsx`, `sdui/AiSignalsModal.jsx`
- Analytics: `AnalyticsHeader.jsx`, `AudienceSection.jsx`, `BasicInfo.jsx`, `CountryAnalytics.jsx`, `Demographics.jsx`, `LanderDetails.jsx`, `SocialEngagements.jsx`
- Other: `all-projects/AllProjects.jsx`, `shared/ChatbotWidget.jsx`
