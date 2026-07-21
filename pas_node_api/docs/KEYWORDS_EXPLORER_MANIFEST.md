# Keywords Explorer (Google) — Manifest

> **Status: IMPLEMENTED, smoke-tested against dev DB/ES over real HTTP, and
> scale-validated against production ES/MySQL read-only credentials (§7) —
> the rollup job's cost was re-tuned after production-scale testing surfaced
> two crash/perf issues invisible at dev scale (§6, items 3-4).**
> Ships with the `keywordStatsRefresh` cron **disabled by default** in
> `config.json` — flip it on only after you've dry-run the job yourself (§5).
>
> **Related docs:**
> [`GOOGLE_COMPETITIVE_INTEL_FEATURE.md`](../../GOOGLE_COMPETITIVE_INTEL_FEATURE.md) /
> [`GOOGLE_COMPETITIVE_INTEL_PRD.md`](../../GOOGLE_COMPETITIVE_INTEL_PRD.md) — the
> Tier-1 single-keyword / single-advertiser feature this builds on top of.
>
> This is an **Ahrefs/SEMrush-style "browse the whole keyword database" page**
> (paste/upload keywords, filter/sort a table, save into named lists) layered
> on top of Tier 1's single-item drill-down modals.

---

## 0. The one thing every developer must understand before touching this

**There is no third-party SEO/keyword-data provider anywhere in this repo**
(no Ahrefs/SEMrush/DataForSEO license — verified absent from every
`package.json`/`composer.json`). Every metric on this page is a **proxy
derived from PowerAdSpy's own crawled Google Ads corpus**, not real Google
search volume or backlink-based Keyword Difficulty:

| Column shown to the user | What it actually is | Source |
|---|---|---|
| **Ad Volume** | Distinct ads bidding this keyword | ES `cardinality(id)` |
| **Competition** (0–100 badge) | Percentile rank of distinct-advertiser count across the whole `keyword_stats` table | `cardinality(post_owner_lower)` + a JS percentile pass, not SQL window functions |
| **Growth %** | Ad-count change, trailing 30d vs. prior 30d | ES `filter` aggs on `last_seen` |
| **Parent Topic** | The already-crawled `category` field (majority vote) | ES `category`/`subCategory` |
| CPC | **Not shown.** No bid/cost data is crawled — showing a number would be fabricated | — |

If you add a new column, ask "is this derivable from `google_ads_data_v2`
or the existing SQL tables?" before writing code — if not, it's a Tier-3
build-vs-buy decision, not something to fake with a placeholder number.

---

## 1. Architecture at a glance

```
                    ┌─────────────────────────────┐
 nightly cron ────▶ │ refreshKeywordStats.js       │  (ES composite sweep,
 (disabled by       │ jobs/refreshKeywordStats.js  │   same pattern as
  default)          └───────────────┬─────────────┘   backfillKeywordAggregates.js)
                                     │ writes
                                     ▼
                          ┌─────────────────────┐
                          │   keyword_stats      │  ◀── SQL, per-keyword rollup
                          │   (SQL table)         │
                          └──────────┬───────────┘
                                     │ read by
                     ┌───────────────┼────────────────────┐
                     ▼               ▼                    ▼
         /keywords/explorer  /keywords/ideas   /keywords/lists/*, /keywords/import
         (paginated table)   (related terms)   (user-curated saved lists)
                     │
                     ▼ row click
         existing /keywords/insight (live ES) → KeywordExplorerModal
         (Tier-1, unchanged — this is the drill-down)
```

**Why a rollup table instead of live ES aggregation?** The `google_ads_data_v2`
index has 200M+ docs. A live per-request ES aggregation is fine for "tell me
about THIS ONE keyword" (Tier 1), but not for "browse/sort/filter thousands
of keywords" — that needs a pre-computed, indexed SQL table. This mirrors
exactly why `keyword_advertiser`/`keyword_domain` (Tier 2) exist as
batch-populated tables rather than live queries.

---

## 2. Files

### Backend (`pas_node_api/src/`)

| File | What it does |
|---|---|
| `services/google/jobs/refreshKeywordStats.js` | The rollup job. Paginated ES **composite aggregation** on `target_keyword` (single field, not a pair like Tier 2), sub-aggs for ads/advertisers/domains cardinality, 30d/prior-30d windows, majority-vote category/type/position. Second pass computes `competition_score` (0-100 percentile rank) in JS, grouped into ≤101 `UPDATE` statements. Same dry-run/`--commit`/`--truncate`/`--batch`/`--limit` CLI contract as `backfillKeywordAggregates.js`. Exports `runKeywordStatsRefresh(opts)` for the cron; the CLI-only bits (`connectAll`/`disconnectAll`/`process.exit`) are gated behind `require.main === module`. |
| `services/google/helpers/aggregations.js` | Extended with `last2WindowAggs()`, `majorityTermsAgg()`, `majorityBucketKey()` — reused by the job, alongside the existing `buildBaseQuery`/`termsByUniqueAds`/`AGG_FIELD`. |
| `services/google/controllers/keywordsExplorerController.js` | `POST /keywords/explorer` — paginated/filterable/sortable SQL query over `keyword_stats`. |
| `services/google/controllers/keywordIdeasController.js` | `POST /keywords/ideas` — substring + shared-category related terms. |
| `services/google/controllers/keywordListsController.js` | Full CRUD for user-curated named keyword lists. |
| `services/google/controllers/keywordImportController.js` | `POST /keywords/import` — CSV/TXT upload or pasted text, reuses `services/common/helpers/keywordInput.js`'s `parseCsvFile`/`parseJsonKeywords` (already built for the unrelated keyword-search synthetic-upload feature — don't reinvent CSV parsing here). |
| `services/google/routes/googleRoutes.js` | Wires all of the above + the 3 pre-existing Tier-1 routes behind a shared `intelGate` middleware array. |
| `middleware/planAccess.js` | **New:** `requireIntelAccess` — server-side mirror of the frontend's `canAccessIntel()`. See §4, this closes a real gap. |
| `jobs/cronManager.js` | Registers `keywordStatsRefresh` in the generic `REGISTRY`. |
| `scripts/keyword_stats_schema.sql` | Plain SQL DDL for `keyword_stats`/`keyword_lists`/`keyword_list_items`. **Not a Laravel migration** — this Node service has no migration framework, so schema ships as a checked-in `.sql` artifact (same convention as `scripts/google_ads_data_v2.mapping.json`). |
| `scripts/apply-keyword-stats-schema.js` | Applies the `.sql` file using the SAME `google` network DB connection the server already uses — run this instead of hunting for a `mysql` CLI install. |

### Frontend (`new-ui-react/src/`)

| File | What it does |
|---|---|
| `components/keywords-explorer/KeywordsExplorerPage.jsx` | The page itself. Paste/CSV search, filter bar, table, tab switch to Keyword Lists. |
| `components/keywords-explorer/KeywordFilterBar.jsx` | Ad Volume / Competition / Growth % range inputs + Category/Include/Exclude text inputs. |
| `components/keywords-explorer/KeywordExplorerTable.jsx` | Sortable, paginated table. Clicking a keyword calls `onOpenKeyword` (passed through to the **existing** `KeywordExplorerModal` — no new drill-down modal was built). |
| `components/keywords-explorer/KeywordListsPanel.jsx` | Keyword Lists tab — CRUD UI. |
| `components/keywords-explorer/AddToListMenu.jsx` | Bulk-select rows → add to an existing or new list. |
| `services/api.js` | `getGoogleKeywordsExplorer`, `getGoogleKeywordIdeas`, `*KeywordList*`, `importGoogleKeywordsFile`/`importGoogleKeywordsText` — all follow the existing `postGoogleIntel(path, body)` helper's conventions (shared auth header, 400-as-empty-result). |
| `App.jsx` | New pseudo-route (`ui.activePage === 'keywords-explorer'`, no react-router `<Route>` — this app does NOT use react-router's declarative routing despite importing it; routing is manual `activePage` state + `location.pathname` sync). `openKeywordsExplorerPage` gates on `canAccessIntel()`. |
| `components/layout/Sidebar.jsx` | New nav item, directly below "Ads Library", using the previously-unused `Hash` icon import. |
| `components/modals/AnalyticsModal.jsx` | New "Keywords Explorer" button next to "View advertiser profile" in the Google ad branch. |

---

## 3. Data model

```sql
-- Per-keyword rollup, refreshed by refreshKeywordStats.js. One row per
-- google_text_keywords.id (which is per-country — the same bidding keyword
-- in two countries gets two rows, mirroring how Tier-2 keyword_advertiser
-- handles the same string→multiple-ids mapping).
keyword_stats (
  keyword_id            PK, FK -> google_text_keywords.id
  ads_total, advertisers_total, domains_total   BIGINT
  ads_30d, ads_prior_30d                        BIGINT
  growth_pct                                    DECIMAL(10,2) NULL
  competition_score                             TINYINT NULL   -- 0-100
  category, sub_category                        VARCHAR NULL
  top_country                                   VARCHAR NULL
  type_mix                                      JSON NULL      -- {"text":bool,"image":bool,"video":bool}
  position_top_pct                              DECIMAL(5,2) NULL
  first_seen, last_seen                         DATE NULL
  updated_at                                    TIMESTAMP
)

-- User-curated named lists — independent of the rollup, just points at keyword_ids.
keyword_lists (id PK, user_id, name, country, created_at, updated_at)
keyword_list_items (id PK, list_id FK, keyword_id FK, added_at, UNIQUE(list_id, keyword_id))
```

Apply with: `node scripts/apply-keyword-stats-schema.js` (idempotent —
`CREATE TABLE IF NOT EXISTS`).

---

## 4. Auth / entitlement gating

**Pre-existing gap closed by this feature:** the three Tier-1 endpoints
(`/ads/trends`, `/keywords/insight`, `/advertiser/profile`) were previously
gated **only by `authMiddleware`** — the "Intel" plan entitlement check
(`canAccessIntel()`) existed **only in the frontend** (`App.jsx`). Any
authenticated user could hit them directly. Also worth knowing:
`googleRoutes.js` is the only network route file in this repo that doesn't
apply `planAccessMiddleware`/`requirePlatform('google')` at all (every other
network — facebook/instagram/gdn/youtube — does). That broader gap was
**not** touched here (out of scope, and a bigger behavioral change); only the
Intel-specific gate was added.

`middleware/planAccess.js` now exports `requireIntelAccess`, checking the
exact same condition as the frontend:
```js
planAccess.filters?.ad_analytics?.enabled === true ||
  (planAccess.competitorLimits?.brandLimit ?? 0) > 0
```
Applied via `intelGate = [authMiddleware, planAccessMiddleware, requireIntelAccess]`
to **all** Tier-1 routes and every new Keywords Explorer route.

---

## 5. Running the rollup job

```bash
# Dry-run first — computes and logs, writes nothing.
node src/services/google/jobs/refreshKeywordStats.js --limit=500

# Check the log: keyword count, unmapped rate, and the `sample:` rows.
# Cross-check one sampled keyword against POST /keywords/insight — ads_total/
# advertisers_total should roughly match summary.ads/summary.advertisers.

# Commit for real once it looks right.
node src/services/google/jobs/refreshKeywordStats.js --commit

# Options:
#   --full              sweep the ENTIRE corpus history, not just trailing 18mo
#                        (default scope skips cold/dead keywords to bound cost
#                        against the 200M+ doc index)
#   --truncate           wipe the table first (default is upsert-in-place —
#                        safe to re-run repeatedly without --truncate)
#   --batch=N            composite page size (default 1000)
#   --precision=N        cardinality-agg precision_threshold (default 1000 —
#                        see §7, do not raise without re-measuring against prod)
```

Cron: `config.json` → `crons.jobs.keywordStatsRefresh` (ships `enabled: false`
on purpose — flip to `true` only after a manual dry-run + commit have been
validated once. Same `enabled`/`schedule`/`commit`/`truncate`/`full`/`batch`/
`precision` keys map straight through to the job's CLI args via
`cronManager.js`'s `REGISTRY`).

---

## 6. Gotchas discovered during testing (read this before debugging a similar 500)

Four real bugs were found and fixed while testing this feature end-to-end —
all are the kind of mistake easy to reintroduce elsewhere in this codebase,
so they're documented here rather than only in a commit message:

1. **`LIMIT ?` / `OFFSET ?` as bound parameters throws
   `Incorrect arguments to mysqld_stmt_execute`.** `db.sql.query()` runs
   MySQL prepared statements (`mysql2` `execute()`), and this MySQL setup
   errors binding LIMIT/OFFSET as placeholders. The fix is to inline
   validated integers directly into the SQL string instead — this was
   already the established (if undocumented) workaround in
   `getAdsByAdvertiserController.js`; `keywordsExplorerController.js` and
   `keywordIdeasController.js` now follow it too. **If you write a new
   paginated SQL query in this codebase, never bind LIMIT/OFFSET as `?` —
   validate the integer (e.g. via a `clampInt` helper) and inline it.**

2. **An omitted filter is `undefined`, not `''`.** `normalizeParams()`
   (`helpers/paramParser.js`) only transforms keys that exist on the
   request — a filter the client didn't send stays `undefined`. A
   `someParam !== ''` check is `true` for `undefined` (different value,
   passes the check), which silently applied a default (`Number(undefined)
   || 0`) as a real filter on every request — e.g. an unset `volume_max`
   became `ads_total <= 0`, zeroing out every real result regardless of
   what the client actually asked for. Use a `hasValue(v) = v !== undefined
   && v !== null && v !== ''` check for optional numeric filters, not a bare
   `!== ''`.

3. **A full-table `SELECT` against a table you haven't checked the
   production row count of can OOM-crash the whole process.**
   `refreshKeywordStats.js` originally loaded ALL of `google_text_keywords`
   into one in-memory `Map` upfront — fine against dev's ~5k rows, but
   production has **~42M rows**, and that query crashed the process with
   `JavaScript heap out of memory` even at a 4GB heap limit. Because this
   job runs in-process via the cron (`cronManager.js`), not as a separate
   child process, that crash would have taken down the entire
   `pas_node_api` worker, not just the job. Fixed by resolving keyword ids
   **per composite-agg page** (`resolveKeywordIds()`) instead of once
   upfront — bounds memory to one page's worth of keywords (≤ `--batch`).
   **Before writing a bulk job against any of the legacy MySQL tables in
   this repo, check the production row count first — dev's row counts are
   not remotely representative.**

4. **Wrapping an indexed column in a SQL function silently defeats the
   index.** The per-page fix in (3) above still used
   `WHERE LOWER(TRIM(keyword)) IN (...)` — which measured at **80.7 seconds**
   for a single 1000-keyword page against production (`EXPLAIN` confirmed a
   full 42M-row scan; `LOWER()`/`TRIM()` on the column prevents MySQL from
   using the `keyword`/`keyword_2` indexes at all). Since
   `google_text_keywords.keyword`'s collation is already case-insensitive
   (`utf8mb3_unicode_ci`), dropping the function wrap entirely —
   `WHERE keyword IN (...)` with the already-lowercased ES values passed
   straight in — matches identically AND lets MySQL use the index
   (`EXPLAIN`: range scan, ~3 rows per key). Same page, same data:
   **46ms instead of 80.7s (1730x)**. **Never wrap an indexed WHERE-clause
   column in a function without checking `EXPLAIN` first** — it's invisible
   in small/dev-scale testing and only shows up as a production incident.

---

## 7. Production-scale validation (measured against real prod ES/MySQL, 2026-07-03)

Before enabling the cron, these numbers were measured directly against
production (`google_ads_data` ES index, `pas-gtext` MySQL — read-only
credentials, no writes) to answer "will a daily full sweep be slow at
production's actual scale":

| Metric | Value |
|---|---|
| Total docs in `google_ads_data` | ~197M |
| Distinct `target_keyword`, all-time | ~21.5M |
| Distinct `target_keyword`, trailing 18mo (this job's default scope) | ~464k |
| `google_text_keywords` row count | ~42M |
| Full ES composite sweep, gotcha (1)+(2) unfixed (precision 40000, batch 200) | **~12 hours** (extrapolated — do not run) |
| Full ES composite sweep, fixed (precision 1000, batch 1000) | **~3 minutes** |
| Full MySQL keyword-resolution, gotcha (3)+(4) unfixed (upfront full-table load) | **crashes** (OOM, 4GB heap) |
| Full MySQL keyword-resolution, fixed (per-page, unwrapped WHERE) | **~20-25 seconds total** (465 pages × ~46ms) |
| **Combined estimated full-sweep runtime (fixed)** | **under 4 minutes** |

This is well within a nightly (or even hourly) cron budget. If you change
the sub-agg set, the lookback window, or the MySQL query shape, re-measure
against a production-scale dataset before assuming dev-scale timing holds —
every gotcha in §6 was invisible at dev scale and only appeared at
production scale.

---

## 8. What's deliberately NOT built (yet)

- **Real CPC/search-volume/backlink-based KD.** Would require a paid
  third-party data license — explicit Tier-3 decision, not assumed here.
- **Intent classification** (transactional/commercial/informational badges)
  — sketched as a keyword-pattern-dictionary fast-follow, not implemented.
- **Broader `googleRoutes.js` plan gating** (`planAccessMiddleware` /
  `requirePlatform('google')` on the non-Intel routes like `/ads/search`) —
  a real, separately-scoped gap; not touched by this feature.
- **Usage analytics** on the new entry points — still an open item carried
  over from the Tier-1 PRD (`GOOGLE_COMPETITIVE_INTEL_PRD.md` §7/§8).
