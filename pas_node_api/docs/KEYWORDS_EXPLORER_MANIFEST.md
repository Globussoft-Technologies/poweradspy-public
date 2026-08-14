# Keywords Explorer (Google) — Manifest

> **Status: IMPLEMENTED and running in production.** As of 2026-08-14, the
> rollup was redesigned from a per-country-variant table (`keyword_stats`) to
> a deduplicated one-row-per-keyword table (`keyword_stats_unique`) after a
> production incident where the old design's required `GROUP BY` on every
> single Explorer request took **~20-38s per query** (~88s total per page
> load) against a 1M+ row table. **See §9 for the full incident, root cause,
> and migration** — read it before touching any google keyword-stats code.
>
> The rollup is kept fresh in production by **`scripts/refresh-keyword-stats-safe.js`**
> (adaptive batch size, SQL/ES load-aware throttling, resumable via a state
> table) — this is the job that actually runs in production, not the
> `keywordStatsRefresh` cron entry described in §5 (that cron path still
> exists and is wired to the same `keyword_stats_unique` table, but is
> **disabled by default** in `config.json`).
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
| **Competition** (0–100 badge) | Percentile rank of distinct-advertiser count across the whole `keyword_stats_unique` table | `cardinality(post_owner_lower)` + a JS percentile pass, not SQL window functions |
| **Growth %** | Ad-count change, trailing 30d vs. prior 30d | ES `filter` aggs on `last_seen` |
| **Parent Topic** | The already-crawled `category` field (majority vote) | ES `category`/`subCategory` |
| CPC | **Not shown.** No bid/cost data is crawled — showing a number would be fabricated | — |

If you add a new column, ask "is this derivable from `google_ads_data_v2`
or the existing SQL tables?" before writing code — if not, it's a Tier-3
build-vs-buy decision, not something to fake with a placeholder number.

---

## 1. Architecture at a glance

```
                    ┌───────────────────────────────────┐
 production ─────▶  │ scripts/refresh-keyword-stats-safe.js │  (MySQL-driven, adaptive
 (live job,         │  builds keyword_ad from google_text_ad│   batch/throttle vs SQL
  --loop or          │  + google_text_ad_variants, then       thread load & ES cpu/queue,
  scheduled)         │  aggregates keyword_ad → stats)         resumable via state table)
                    └───────────────┬────────────────────┘
                                    │ writes
 cron (disabled  ──▶ refreshKeywordStats.js  ─────────────┤  (ES composite sweep,
  by default)        jobs/refreshKeywordStats.js          │   alternate/CLI path,
                     writes the SAME table                │   same target table)
                                    ▼
                     ┌───────────────────────────┐
                     │   keyword_stats_unique      │  ◀── SQL, ONE row per keyword
                     │   (SQL table, PK=keyword)    │      TEXT (deduplicated at
                     └──────────────┬───────────────┘      write time — see §9)
                                    │ read by (joined via keyword TEXT, not keyword_id)
        ┌───────────────┬──────────┼──────────────┬───────────────────┐
        ▼               ▼          ▼              ▼                   ▼
/keywords/explorer /keywords/ideas  /keywords/lists/*  /keywords/import
(paginated table)  (related terms)  (saved lists)      (CSV/paste upload)
        │
        ▼ row click
/keywords/insight (live ES) → KeywordExplorerModal
(Tier-1, unchanged — this is the drill-down)
```

**Why a rollup table instead of live ES aggregation?** The `google_ads_data_v2`
index has 200M+ docs. A live per-request ES aggregation is fine for "tell me
about THIS ONE keyword" (Tier 1), but not for "browse/sort/filter thousands
of keywords" — that needs a pre-computed, indexed SQL table. This mirrors
exactly why `keyword_advertiser`/`keyword_domain` (Tier 2) exist as
batch-populated tables rather than live queries.

**Why `keyword_stats_unique` and not `keyword_stats`?** See §9 — the original
`keyword_stats` stored one row *per country-variant* of a keyword, which
required every read query to `GROUP BY` the joined result to dedupe. That
forced a full-table materialize+filesort on every single request regardless
of filters, measured at ~20-38s/query in production. `keyword_stats_unique`
is deduplicated at write time instead (one row per keyword TEXT), so reads
need no JOIN and no GROUP BY at all. `keyword_stats` has been dropped.

---

## 2. Files

### Backend (`pas_node_api/src/`)

| File | What it does |
|---|---|
| `services/google/jobs/refreshKeywordStats.js` | Alternate/CLI rollup path. Paginated ES **composite aggregation** on `target_keyword` (single field, not a pair like Tier 2), sub-aggs for ads/advertisers/domains cardinality, 30d/prior-30d windows, majority-vote category/type/position. Writes `keyword_stats_unique` (one row per keyword TEXT, deduplicated at write time — see §9). Second pass computes `competition_score` (0-100 percentile rank) via a single SQL window-function `UPDATE`, falling back to chunked JS batches. Same dry-run/`--commit`/`--truncate`/`--batch`/`--limit` CLI contract as `backfillKeywordAggregates.js`. Exports `runKeywordStatsRefresh(opts)` for the cron; the CLI-only bits (`connectAll`/`disconnectAll`/`process.exit`) are gated behind `require.main === module`. |
| `scripts/refresh-keyword-stats-safe.js` | **The job that actually runs in production.** MySQL-driven (not ES): builds a `keyword_ad` mapping table from `google_text_ad`/`google_text_ad_variants`, then aggregates that into `keyword_stats_unique`. Adaptive — checks SQL `Threads_running`/pool queueing and ES cpu/thread-pool/queue every ~10s and scales its batch size/sleep down automatically under load. Resumable across restarts via a `keyword_stats_refresh_state` table + a MySQL `GET_LOCK` so two instances can't run concurrently. No dry-run mode — every run writes. `--loop` to cycle continuously, `--max-batches=N` to bound a single run (useful for a quick manual top-up). |
| `services/google/helpers/aggregations.js` | Extended with `last2WindowAggs()`, `majorityTermsAgg()`, `majorityBucketKey()` — reused by `refreshKeywordStats.js`, alongside the existing `buildBaseQuery`/`termsByUniqueAds`/`AGG_FIELD`. |
| `services/google/controllers/keywordsExplorerController.js` | `POST /keywords/explorer` — paginated/filterable/sortable SQL query over `keyword_stats_unique`, no JOIN, no GROUP BY (see §9). Also caches the count/stats aggregate for a filter-set in an in-process `Map` for 2 minutes. |
| `services/google/controllers/keywordIdeasController.js` | `POST /keywords/ideas` — substring + shared-category related terms. Reads `keyword_stats_unique`, LEFT JOINed to `google_text_keywords` by normalized keyword text (not `keyword_id`). |
| `services/google/controllers/keywordListsController.js` | Full CRUD for user-curated named keyword lists. Item stats also read `keyword_stats_unique` by keyword text. |
| `services/google/controllers/keywordImportController.js` | `POST /keywords/import` — CSV/TXT upload or pasted text, reuses `services/common/helpers/keywordInput.js`'s `parseCsvFile`/`parseJsonKeywords` (already built for the unrelated keyword-search synthetic-upload feature — don't reinvent CSV parsing here). Matches against `keyword_stats_unique` by keyword text. |
| `services/google/routes/googleRoutes.js` | Wires all of the above + the 3 pre-existing Tier-1 routes behind a shared `intelGate` middleware array. |
| `middleware/planAccess.js` | **New:** `requireIntelAccess` — server-side mirror of the frontend's `canAccessIntel()`. See §4, this closes a real gap. |
| `jobs/cronManager.js` | Registers `keywordStatsRefresh` in the generic `REGISTRY` (disabled by default — production relies on `refresh-keyword-stats-safe.js` instead, run out-of-band). |
| `scripts/keyword_stats_schema.sql` | Plain SQL DDL for `keyword_lists`/`keyword_list_items` (still live) and the now-dropped legacy `keyword_stats` table, kept for historical/rollback reference. **Not a Laravel migration** — this Node service has no migration framework, so schema ships as a checked-in `.sql` artifact (same convention as `scripts/google_ads_data_v2.mapping.json`). |
| `scripts/keyword_stats_unique_schema.sql` | DDL for `keyword_stats_unique` — the live rollup table. See §9 for why it's shaped this way (PK on `keyword` text, `countries` JSON array, `sample_keyword_id` for display joins). |
| `scripts/apply-keyword-stats-schema.js` | Applies **both** `.sql` files above using the SAME `google` network DB connection the server already uses, then backfills `keyword_stats_unique` in one shot from any existing `keyword_stats` data (skips the backfill if `keyword_stats_unique` already has rows). Run this instead of hunting for a `mysql` CLI install. |
| `scripts/drop-legacy-keyword-stats.js` | One-time cleanup — drops the legacy `keyword_stats` table once `keyword_stats_unique` is verified. Dry-run by default; refuses to drop if `keyword_stats_unique` looks empty. |
| `scripts/diagnose-keywords-explorer.js` | EXPLAINs + times the Explorer's actual queries against `keyword_stats_unique` — run this first if the Explorer feels slow again. |
| `scripts/diagnose-google-load.js` | Broader google MySQL+ES health snapshot (slow queries, ES thread pool/tasks/hot-threads, verdict) — for "google is slow" reports not specific to the Explorer. |
| `scripts/cancel-google-es-tasks.js` | Lists (dry-run) or cancels (`--confirm`) long-running ES search tasks on the google cluster. |

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
-- Per-keyword rollup, refreshed by refresh-keyword-stats-safe.js (production)
-- or refreshKeywordStats.js (ES-driven alternate/CLI path). ONE row per
-- keyword TEXT (deduplicated at write time — see §9), not per
-- google_text_keywords.id. sample_keyword_id is a representative id (any
-- country-variant — they all carry identical stats) for display joins.
keyword_stats_unique (
  keyword                PK, VARCHAR(500)
  sample_keyword_id      FK -> google_text_keywords.id
  countries              JSON NULL      -- ["US","IN","GB"] — which countries this keyword is tracked in
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

-- User-curated named lists — independent of the rollup, points at
-- google_text_keywords.id directly; stats are looked up by joining that
-- row's keyword TEXT into keyword_stats_unique.
keyword_lists (id PK, user_id, name, country, created_at, updated_at)
keyword_list_items (id PK, list_id FK, keyword_id FK, added_at, UNIQUE(list_id, keyword_id))
```

Apply with: `node scripts/apply-keyword-stats-schema.js` (idempotent —
`CREATE TABLE IF NOT EXISTS` for both schema files, plus a one-time backfill
of `keyword_stats_unique` from any existing legacy data).

The legacy `keyword_stats` table (one row per country-variant `keyword_id`)
is dropped once `keyword_stats_unique` is verified — see §9.

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

**Production uses `scripts/refresh-keyword-stats-safe.js`, not the cron below.**
It has no dry-run mode (every run writes) but is safe to run repeatedly —
resumable, self-throttling under SQL/ES load, and lock-guarded against
concurrent runs:

```bash
# Run a bounded number of batches (useful for a manual top-up / testing):
node scripts/refresh-keyword-stats-safe.js --max-batches=20

# Run continuously, cycling through the whole google_text_ad table on repeat:
node scripts/refresh-keyword-stats-safe.js --loop

# Flags: --batch=N (start size, adaptive), --sleep-ms=N, --no-adaptive,
# --sql-threads-max=N, --es-cpu-max=N (% before throttling down), --reset-state
```

The ES-driven `refreshKeywordStats.js` job below is an alternate/CLI path to
the same `keyword_stats_unique` table — useful for a from-scratch rebuild via
`--full --truncate`, or when ES aggregation is preferred over the MySQL-driven
approach, but it is **not** what runs in production day-to-day.

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

---

## 9. The `keyword_stats` → `keyword_stats_unique` redesign (2026-08-14 incident)

### What happened

`/api/v1/google/keywords/explorer` was taking **20+ seconds, sometimes up to
a minute**, in production. Diagnosed with `scripts/diagnose-keywords-explorer.js`
(EXPLAIN + real timing against production):

| Query | Time | EXPLAIN |
|---|---|---|
| `COUNT(DISTINCT keyword)` | 19.8s | full index scan, 1,066,833 rows |
| Stats aggregate (avg/sum) | 30.2s | `type=ALL key=NONE` — **no index used at all** |
| Paginated/sorted rows | 38.1s | `Using temporary; Using filesort` — index on the sort column present but defeated |

**~88 seconds total** for a single page load, three queries run sequentially
(first fix: run them in parallel — cut wall time to the slowest single query,
not the sum, but the underlying per-query cost was still the real problem).

### Root cause

`keyword_stats` had **one row per `google_text_keywords.id`** — a keyword
tracked in 3 countries had 3 identical-valued rows. Every single Explorer
request (count, stats, and the page of rows) had to `GROUP BY gtk.keyword`
to dedupe before it could return anything, which forced MySQL to
materialize + filesort the **entire joined table** on every request,
regardless of any filters applied. No index can satisfy a `GROUP BY` on a
string column joined in from another table — this is a structural cost, not
a missing-index problem.

### Fix: deduplicate at write time, not read time

`keyword_stats_unique` (schema: §3, `scripts/keyword_stats_unique_schema.sql`)
stores **one row per keyword TEXT** instead. Both refresh jobs
(`refresh-keyword-stats-safe.js` and `refreshKeywordStats.js`) write one
upsert per keyword text — the country-variant fan-out that used to produce
duplicate `keyword_stats` rows is now merged before the write, not deduped on
every read. `keywordsExplorerController.js`, `keywordImportController.js`,
`keywordListsController.js`, and `keywordIdeasController.js` were all
repointed to read `keyword_stats_unique`, joined to `google_text_keywords` by
normalized keyword TEXT (not `keyword_id`) where a display join is still
needed. **No query in any of these paths does a GROUP BY over the whole
table anymore.**

Result: MySQL can walk an index in `ORDER BY` order and stop after
`page_size` rows instead of scanning + sorting everything — 20-40s queries
dropped to low milliseconds (confirmed via `diagnose-keywords-explorer.js`).

### Migration mechanics (if you need to redo this on another environment)

```bash
# 1. Create keyword_stats_unique AND one-time backfill it from the existing
#    keyword_stats data (skips the backfill if already populated):
node scripts/apply-keyword-stats-schema.js

# 2. Deploy the updated controllers/jobs.

# 3. Top up with live data (safe to re-run):
node scripts/refresh-keyword-stats-safe.js --max-batches=20

# 4. Verify:
node scripts/diagnose-keywords-explorer.js
curl -X POST http://<host>/api/v1/google/keywords/explorer -d '{}'
#   also smoke-test /keywords/import, /keywords/lists/*, /keywords/ideas

# 5. Once verified, drop the legacy table (dry-run by default):
node scripts/drop-legacy-keyword-stats.js
node scripts/drop-legacy-keyword-stats.js --confirm
```

### Gotchas specific to this migration

- **`JSON_ARRAYAGG(DISTINCT ...)` is not valid MySQL syntax** — MySQL's
  `JSON_ARRAYAGG` does not support `DISTINCT`. Not needed anyway: each
  `google_text_keywords` row is a unique `(keyword, country)` pair (confirmed
  via `SHOW INDEX`), so countries aggregated within one keyword's `GROUP BY`
  group are already naturally distinct.
- **`keyword` needed `VARCHAR(500)`, not `VARCHAR(191)`.** The initial
  schema used 191 (a common safe default for utf8mb4 PKs under the old
  767-byte InnoDB index-prefix limit) but the backfill hit
  `ER_DATA_TOO_LONG` on real data — some crawled "keywords" are longer than
  191 chars. MySQL 8's default `DYNAMIC` row format + `innodb_large_prefix`
  supports a full-length utf8mb4 index up to 768 chars (3072 bytes ÷ 4), so
  500 is safely within range. The backfill's `SELECT` also wraps the source
  in `LEFT(gtk.keyword, 500)` as a safety net.
- **A second, independent write path was easy to miss.**
  `scripts/refresh-keyword-stats-safe.js` is a completely separate
  implementation from `refreshKeywordStats.js` (MySQL-driven vs ES-driven,
  no shared code) that turned out to be the one actually running in
  production. It also had **two separate** `competition_score`
  recomputation functions (an optimized SQL-window-function path and a
  chunked-JS fallback) that both needed retargeting to
  `keyword_stats_unique` — grep for `FROM keyword_stats\b` (excluding
  `keyword_stats_unique`/`keyword_stats_schema`/`keyword_stats_refresh_state`)
  across `src/` and `scripts/` to confirm nothing was missed before dropping
  the legacy table.
- **A separate, unrelated wildcard-query bug was found and fixed in the same
  incident window** — an admin "Search Intelligence" domain-search feature
  and a scheduled keyword-alert notification job were both building
  unbounded `{"wildcard": {"destination_url": "*x*"}}` ES queries (full
  term-dictionary scan on a high-cardinality field, ~25s/query, pinned the
  ES search thread pool). Fixed in
  `src/services/admin_user_activity/queries/searchIntelligenceQueries.js` and
  `src/services/common/helpers/platformSearchFields.js` /
  `src/services/common/controllers/keywordAdNotificationController.js` by
  preferring the existing low-cardinality `domain` keyword field
  (`term`/`prefix`) over a wildcard scan on the raw URL — same pattern
  `GoogleSearchQueryBuilder.js` already used. Unrelated to the MySQL
  redesign above, but discovered while diagnosing the same "google is slow"
  report — worth knowing both existed simultaneously.
- **A single-node Elasticsearch cluster has no capacity headroom.** Even
  with the wildcard bug fixed, ~10 concurrent *normal* searches were enough
  to push the cluster to 99% CPU / a 167-deep search queue. Also fixed as
  part of this incident: the keyword-search box's `multi_match` used
  `type: "cross_fields"` (the most CPU-expensive multi-field match type,
  builds a blended per-field term-frequency model) — switched to
  `type: "best_fields"` in `GoogleSearchQueryBuilder.js`, which scores each
  field independently and is materially cheaper for the same "all words
  present" (`operator: and`) guarantee. This reduces per-query cost but
  **does not remove the underlying capacity ceiling** — the cluster still
  has zero replica/failover headroom and a hard scaling limit. Adding a
  second ES data node is the actual fix for that; not done as part of this
  incident (infra decision, outside this repo's scope).
