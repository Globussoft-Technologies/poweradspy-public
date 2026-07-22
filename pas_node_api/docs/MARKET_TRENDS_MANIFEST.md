# Market Trends — Manifest

A Google-Trends-style **Explore / Compare** dashboard for ad data. Additive and
fully gated (build-time env flag + backend enable flag + per-user allow-list).
When off, nothing loads and nothing existing is affected.

- **Backend:** single file `pas_node_api/src/services/marketTrends.js`
- **Frontend:** single file `new-ui-react/src/components/MarketTrends.jsx`
  (reuses `react-day-picker` — already a project dependency — for the date range)

> Internal naming note: internal identifiers still use `intelligence` (config key
> `intelligence`, env `INTELLIGENCE_*`, route `/api/v1/intelligence`,
> `activePage === 'intelligence'`). Only the **visible UI text** says "Market
> Trends".

---

## 1. Enable / disable / restrict

### Global on/off
| Layer | Where | Value |
|---|---|---|
| Backend | `pas_node_api/config.json` | `"intelligence": { "enabled": true }` |
| Backend (alt) | env | `INTELLIGENCE_ENABLED=true` |
| Frontend | `new-ui-react/.env` | `VITE_ENABLE_INTELLIGENCE_FEATURE=true` |

Both default to **off**. Backend `enabled:false` → router never mounted (the
`require` in `app.js` doesn't even run). Frontend flag off → tab never rendered.

### Per-user allow-list (only selected users see the tab)
```jsonc
// pas_node_api/config.json
"intelligence": { "enabled": true, "allowedUserIds": [281, 500, 1234] }
```
or env: `INTELLIGENCE_ALLOWED_USER_IDS=281,500,1234`

- **empty/unset** → the user-ID override contributes no access; the plan-tier
  `market_trends` entitlement decides access
- **non-empty** → only those user ids (others 403'd; UI hides the tab via `/access`)
- Change the list → edit config + restart backend. No frontend rebuild (UI
  re-probes `/access` each load).

### Final values for rollout
```jsonc
// config.json
"intelligence": { "enabled": true, "allowedUserIds": [<user ids>] }
```
```
# new-ui-react/.env
VITE_ENABLE_INTELLIGENCE_FEATURE=true
```
No new DB/ES credentials — reuses the existing per-network connections.

### Per-plan, per-network access (added 2026-07-15)

Two separate things are now plan-aware, independently of the allow-list above —
full history and the "empty list ≠ everyone" semantics fix are in
`docs/PLAN_ACCESS.md` § "Market Trends beta→GA":

1. **Which networks a plan can see in Market Trends specifically.** Resolved by
   `resolveMarketTrendsNetworks(planId, planConfig)` in `marketTrends.js`: checks
   `market_trends.network_overrides.<planId>` on the `market_trends` doc first
   (a dedicated per-feature override, editable in the admin "Market Trends
   Networks" section — independent of that plan's general Platform Access, so
   e.g. a Basic plan can be given `youtube` for Market Trends specifically
   without changing what Basic gets everywhere else); falls back to
   `planAccessService.getAllowedPlatforms()` (the plan's general Platform
   Access) if no override exists.
2. **Server-side enforcement.** `restrictNetworkToPlan` middleware clamps the
   `network` query param to the resolved list before every `/trends/*` handler
   runs (fails open — i.e. does not restrict — on any lookup error or missing
   `plan_id`, so a config/DB hiccup can never lock out a request that should
   have been allowed).
3. **`GET /access`** returns this same resolved list as `networks` (`null` while
   unresolved) — the frontend uses it to compute `AVAILABLE_NETWORKS` and does
   **not** hide restricted chips (see § 4).
4. **Beta plan coverage.** `planAccessMigrate.js --apply` performs a versioned,
   one-time additive repair ensuring
   every legacy paid Basic-to-Palladium ID and every configured current
   monthly/yearly ID is present in both `market_trends` and `keyword_explorer`.
   Existing IDs and all unrelated plan settings are never removed or replaced.
   After the marker is written, later admin UI disables survive script reruns.

---

## 2. Files (only TWO new code files — kept intentionally small)

### New — Backend
| File | Purpose |
|---|---|
| `pas_node_api/src/services/marketTrends.js` | **Everything**: Express router + per-user access guard + ES helpers + per-network field maps + aggregation bodies + all `/trends/*` handlers. Exports the router. Plain file under `services/` → ServiceRegistry does NOT auto-mount it; `app.js` mounts it flag-gated. |

### New — Frontend
| File | Purpose |
|---|---|
| `new-ui-react/src/components/MarketTrends.jsx` | **Everything**: inline API client + the whole Recharts page + an in-file `DateRangePicker` (react-day-picker). Exports `default MarketTrends` and `fetchMarketTrendsAccess()` (used by App.jsx for the per-user gate). |

### Modified existing (revert to remove)
| File | Change |
|---|---|
| `pas_node_api/src/config/index.js` | Added `intelligence: { enabled, allowedUserIds }`. |
| `pas_node_api/src/app.js` | Guarded mount: `if (config.intelligence?.enabled) app.use('/api/v1/intelligence', require('./services/marketTrends'))`. |
| `new-ui-react/.env` | Added `VITE_ENABLE_INTELLIGENCE_FEATURE=false`. |
| `new-ui-react/src/App.jsx` | Imports (`MarketTrends`, `fetchMarketTrendsAccess`); `INTEL_ENV_ON`; `intelAllowed` state + `/access` effect; `intelligenceEnabled` prop on `<Sidebar>`; the `activePage === 'intelligence'` render branch; the `/market-trends` entry in the URL-sync effect (reload persistence); `onDrill` → Ads Library search. |
| `new-ui-react/src/components/layout/Sidebar.jsx` | `intelligenceEnabled` prop + gated "Market Trends" NavItem (TrendingUp). |
| `new-ui-react/src/components/layout/Header.jsx` | Header still shows on the page, but its **search bar is hidden** here (`activePage !== 'intelligence'`). |

No Redux/store changes — reuses `activePage === 'intelligence'`. ServiceRegistry
is **not** modified (the backend is a plain file, not an auto-scanned folder).

---

## 3. API (all GET, read-only, `/api/v1/intelligence`)

| Endpoint | Notes |
|---|---|
| `GET /health` | Liveness (no auth). |
| `GET /access` | `{ enabled, stage, networks }` for the current user — `enabled` from the allow-list/plan-tier OR (§1), `networks` is this plan's Market Trends-specific network list (`null` while unresolved, treated as "everything available" by the frontend). |
| `GET /trends/overview` | Per-network daily ad-volume: `{ networks:[...present...], series:[{date, <net>:count…, total}] }`. |
| `GET /trends/search?q=` | One advertiser's per-network daily volume — powers the multi-term compare. |
| `GET /trends/categories` | Category ad-counts + period-over-period growth %; each item includes a `byNet` `{net:count}` breakdown (drives the stacked columns). |
| `GET /trends/top?type=advertiser\|cta` | Top advertisers / CTAs, each with `count`, `growthPct` (vs the previous window) + `byNet` (drives the ranked table's change column). |
| `GET /trends/regions` | Ads by country (all networks with data; names normalised/merged). Each item includes a `byNet` `{net:count}` breakdown (drives the stacked bars). |
| `GET /trends/keywords` | Top search keywords (Google `target_keyword`). |

All except `/health` and `/access` run behind `authMiddleware` + `accessGuard`.
Every number is a **count of ads** (time series grouped by the network's
`last_seen` day).

**Shared query params:** `network` (`all`, one slug, or CSV — the chip filter),
`country`, `from`+`to` (custom absolute range; otherwise `days`), `advertiser`
(CSV — the compared terms, which also filter categories/top/keywords/regions),
`days`, `size`.

---

## 4. UI features (in `MarketTrends.jsx`)

- **Compare advertisers** (up to 5) — type an advertiser (e.g. Nykaa, Myntra);
  each becomes a coloured line on the interest-over-time chart (via
  `/trends/search`, matching the network's advertiser-name field). The compared
  terms also filter the category / top / keywords / region panels.
- **Network chips** — "All" button + multi-select chips with brand icons from
  `src/assets/` (no per-chip ad counts). Selection is a **filter**: every panel
  reflects it. Selection state persists as you click. All selected → sends `all`.
  **All 11 chips always render**, even ones the plan doesn't include (a 🔒 +
  dimmed style marks these) — clicking a plan-restricted chip opens the upgrade
  modal (`onNetworkRestricted`) instead of hiding the chip or silently doing
  nothing. `AVAILABLE_NETWORKS` (from `/access`'s `networks`) only gates which
  chips are *selectable*, never which ones are *visible*.
- **Per-panel shimmer loading** — each of the 6 panels (overview chart, regions,
  categories, rising categories, top movers, keywords) has its own independent
  loading flag and skeleton (`ChartSkeleton`/`RowsSkeleton`), not a single
  page-wide dim. Shown via `useDelayedLoading` (delay 150ms, min-visible 300ms)
  so a fast local fetch never flashes a shimmer, but a genuinely slow one shows
  and holds it long enough to register.
- **No stale data on rapid re-filtering (2026-07-15)** — every fetch effect
  clears its own state the instant it starts (before the request even goes
  out), not just on success. Combined with the existing `alive`-flag guard
  (which discards a superseded, late-arriving response), what's on screen
  always corresponds to the *current* filter selection — switching networks
  (or country / date range / compared advertisers) quickly never leaves an
  older selection's data on screen while the new one loads in the background.
- **Country filter** — dropdown populated from the ads-by-country data; filters
  every panel except the country breakdown itself.
- **Date range** — in-file `DateRangePicker` (react-day-picker): presets (All
  time / Last 7 / 30 / 90) + a custom-range calendar. No ad-type tabs; the Clear
  button works and resets to the default window.
- **Interest over time** — a line per network (or per compared advertiser), with
  a **0–100 index** toggle (each line scaled to its OWN peak, so networks of
  wildly different volume all stay visible — Native alone is ~93% of dev volume)
  or raw ad counts. Labelled axes + grid.
- **Ads by country** — horizontal bars **stacked by network** (each country
  segmented by the networks running there). Click a segment → sets the country
  filter.
- **Ads per category** — a **vertical stacked column** per category, stacked by
  contributing network, so categories are directly comparable across networks.
  Click → drill modal.
- **Top movers** (advertisers / CTAs) and **Rising categories** — rendered as
  **Google-Trends-style ranked tables**: rank · label · inline micro-bar
  (search-interest, scaled to the column max) · change column (↑/↓ % vs the
  previous period) · per-row ⋮ menu ("Open in Ads Library" / "+ Compare"), with
  10-row pagination ("1–10 of N") and a header (i) tooltip + export icon.
- **Top keywords** (Google) — horizontal bars; click a row → drill modal.
- **Every panel** carries a one-line **subtitle** (what the chart shows) and a
  data-driven **one-line observation** (e.g. "United States leads with 41% of
  ads"). No full-page reload on any interaction.
- **Export CSV** — the current window's data, client-side.
- **Reload persistence** — own URL `/market-trends` (App.jsx URL-sync effect maps
  it to `activePage='intelligence'`), so refresh stays on the page. The global
  Ads Library loader explicitly skips this route, so refreshing Market Trends
  does not call `/api/v1/common/ads/search`.

**Theme:** the page uses the app's **dark-first** classes (`text-white`,
`text-white/60`, `text-white/70`, `bg-theme-bg`, `bg-theme-card`,
`border-theme-border`) so light mode auto-remaps via the app's
`[data-theme="light"]` CSS. Chart axis text uses `fill: currentColor` and grid
`opacity 0.15`, so everything is readable in light + dark + night. Fonts inherit
the app family. (Only standard opacity steps — /5,/10,…/90 — are remapped; avoid
non-standard ones like /55.)

---

## 5. Networks & data coverage (verified against the live indexes)

Each network stores fields differently. What's actually available per network:

| Network | Index | Volume | Country | Advertiser | Category | CTA | Keywords |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Facebook | `search_mix` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Instagram | `instagram_search_mix` | ✅ | ✅ | ✅ | ✅ | — | — |
| Native | `native_search_mix` | ✅ | ✅ | ✅ | ✅ | — | — |
| Pinterest | `pinterest_search_mix` | ✅ | ✅ | ✅ | ✅ | — | — |
| Reddit | `reddit_search_mix` | ✅ | ✅ | ✅ | — | — | — |
| Quora | `quora_search_mix` | ✅ | ✅ | ✅ | — | — | — |
| GDN | `gdn_search_mix` | ✅ | ✅ | ✅ | — | — | — |
| Google | `google_ads_data` | ✅ | ✅ | ✅¹ | ✅¹ | — | ✅ |
| YouTube | `youtube_ads_data` | ✅ | ✅ | —² | — | ✅ | — |
| LinkedIn | `linkedin_ads_data` | ✅ | ✅ | —² | — | ✅ | — |
| TikTok | `tiktok_ads` (ES **8**) | ⚠️³ | — | — | — | — | — |

¹ Google advertiser/category depend on the **google_ads_data_v2** mapping
(`category`, `post_owner_lower`, `target_keyword` keyword-typed). On an index not
yet migrated to v2 these read empty.
² YouTube/LinkedIn `post_owner` is a **text** field — not aggregatable for
top-movers, but IS matchable, so advertiser **search / compare** still works.
³ TikTok is a **separate ES 8** cluster and its dev data is old (max `last_seen`
≈ 2025-11), so it only appears for date ranges that overlap its data.
`dailySeries` picks `calendar_interval` for ES≥8 vs `interval` for ES≤7
automatically (`es.esMajor`).

### Why GDN & TikTok were "missing" before
- **GDN** was simply absent from the frontend `CHIP_NETWORKS` list even though
  the backend supported the index. Now added: fresh data (`gdn_ad.last_seen`,
  ~16k ads in the last 30d on dev), advertiser via
  `gdn_ad_post_owners.post_owner_lower.keyword`, country via
  `gdn_country_only.country.keyword`; category/CTA empty on this index.
- **TikTok** is present but its dev index is stale, so it only lights up for
  windows overlapping 2025-11, and it lives on the separate ES 8 cluster.

### Per-network field maps in `marketTrends.js`
- `NET_DATE_CANDIDATES` — last_seen date field. search_mix-style nets use nested
  `<net>_ad.last_seen`; flat nets use `last_seen`. `resolveNetDate` picks the
  first date-typed candidate and anchors the window to that field's `max`.
- `META` — per network: `category` / `cta` / `advertiser` agg fields + `advLabel`
  (top_hits label) + `mediaFilter` (whether to apply the placeholder-media
  `must_not`; false for google/youtube/linkedin).
- `NET_COUNTRY` — country field (search_mix: `<net>_country_only.country.keyword`;
  google `country`; youtube/linkedin `countries.keyword`).
- `NET_ADV_MATCH` — advertiser-name **text** field used by `/trends/search`.
- `NET_KEYWORD` — Google `target_keyword` (+ pinterest candidate).

### Data hygiene
- Placeholder media excluded from counts via `must_not`: `*pasvideo*`,
  `*pasimage*`, `*bydefault*`, `*DefaultImage*`.
- Country names normalised / aliased / merged; junk (`ALL`, blanks) dropped.
- Window anchored to each network's own `max(last_seen)`, not wall-clock now, so
  stale/dev data still renders.
- No "top domains" — `search_mix` has no aggregatable domain field.

### Production query performance
- Aggregation requests opt into Elasticsearch's request cache. Query bodies and
  returned counts are unchanged.
- Concurrent panels asking for the same `max(last_seen)` share one in-flight ES
  request. Completed values are not retained, so fresh data is not delayed by
  an application-level TTL.
- The overview resolves each network's date field/anchor once and reuses it for
  its daily histogram instead of issuing the same max aggregation twice.

---

## 6. Remove completely
1. Delete the two code files: `pas_node_api/src/services/marketTrends.js` and
   `new-ui-react/src/components/MarketTrends.jsx`.
2. Revert the modified files in §2 (delete the `intelligence` config block, the
   app.js mount, the `.env` line, and the App.jsx / Sidebar.jsx / Header.jsx
   additions).
3. Delete this file.

## 7. Verification checklist
- `enabled:false` → `/api/v1/intelligence/*` 404, app unchanged.
- `enabled:true` + user in `allowedUserIds` → `/access` `{enabled:true}`, tab
  shows, all endpoints 200 with ad counts, the Header search bar hidden here.
- User not in list → `/access` `{enabled:false}`, no tab, `/trends/*` 403.
- Every filter (network chips / country / date range / advertiser compare)
  updates all panels **without a full-page reload**; light + dark + night all
  readable.
- A plan-restricted network chip stays visible (🔒, dimmed) and clicking it
  opens the upgrade modal — it is never hidden and never a silent no-op.
- On page refresh, no locked/"not allowed" popup flashes before real data
  loads (the page waits for `/access` to resolve before rendering either the
  locked preview or the real component).
- Rapidly clicking through several network chips in a row never shows a
  previous network's data alongside the new selection — each panel is either
  showing the new selection's data or a neutral loading/empty state.
- `node --check src/services/marketTrends.js` and `npx vite build` both pass.
