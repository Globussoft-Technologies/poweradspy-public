# Built-With Scrape Queue — Complete API Documentation

> The **built-with** pipeline enriches ads with the **technology stack** (Shopify, WooCommerce, Google Analytics, Facebook Pixel, ClickBank, …) that the ad's destination page runs on. An external worker leases pending ads, hits their destination URL, runs a BuiltWith-style fingerprinter, and reports the results back so users can filter ads by tech stack.
>
> Every network exposes **two endpoints under `/built-with/…`**:
> - **LEASE (`GET`)** — hand up to 100 pending ads to a worker and flip them to _processing_.
> - **REPORT (`POST`)** — worker writes results back for one ad.
>
> All routes are public (no auth) — matches the legacy PHP scraper contract.

---

## Table of contents
1. [How it works (big picture)](#1-how-it-works-the-big-picture)
2. [The `built_with_status` state machine](#2-the-built_with_status-state-machine)
3. [`status` in the REPORT body](#3-status-in-the-report-body--what-each-value-does)
4. [Value normalisation rules](#4-value-normalisation-rules)
5. [Endpoint reference (all platforms)](#5-endpoint-reference-all-platforms)
6. [Per-network schema table](#6-per-network-schema--where-things-live)
7. [Elasticsearch overlay quirks](#7-elasticsearch-overlay-quirks-important)
8. [Request / response shapes](#8-request--response-shapes)
9. [Where the data lands (MySQL + ES)](#9-where-the-data-lands)
10. [Design decisions & PHP deviations](#10-design-decisions--php-deviations)

---

## 1. How it works (the big picture)

```
                        ┌──────────────────────────────────────────────┐
                        │            built-with scraping worker         │
                        │  (hits destination_url, resolves tech stack)  │
                        └───────────────┬───────────────▲──────────────┘
                                        │               │
                        1. LEASE (GET)  │               │ 2. REPORT (POST)
                        "give me ads"   │               │ "here's the stack"
                                        ▼               │
   ┌───────────────────────────────────────────────────┴───────────────┐
   │                         PowerAdSpy API                              │
   │  LEASE : SELECT up to 100 ads WHERE built_with_status = 0           │
   │          → flip them to built_with_status = 2 (processing)          │
   │  REPORT: write built_with / affiliate_data → MySQL meta_data table  │
   │          + patch the ad's ES doc for search filtering               │
   └─────────────────────────────────────────────────────────────────────┘
```

- **LEASE** takes ads sitting in status `0` (pending), returns `id` + `destination_url`, and flips them to status `2` (processing) so a second worker can't grab the same batch.
- **REPORT** writes the resolved tech-stack strings back to `<network>_ad_meta_data`, sets `built_with_status = 1` (data found) or `3` (no data), and patches the ad's Elasticsearch doc.
- **HTTP is always `200`** on success — the real outcome is in the body `code`.

---

## 2. The `built_with_status` state machine

The same column holds four values across every network:

| value | name        | meaning                                             |
|:---:  |---          |---                                                  |
| `0`   | pending     | queued for a worker; will be leased by the next LEASE |
| `2`   | processing  | leased to a worker; NOT re-issued until it resolves    |
| `1`   | completed   | worker returned real tech-stack data                 |
| `3`   | completed   | worker ran but found nothing (empty / no landing page)|

`affiliate_status` mirrors this exact set for the `affiliate_data` column.

**Transitions:**

```
   0 ── LEASE ──►  2 ── REPORT (status=1, has data) ──►  1
                    │
                    └── REPORT (status=1, empty data OR status≠1) ──►  3
```

Statuses `1` and `3` are terminal — an ad in either state is not re-leased.

> **YouTube exception:** the LEASE filter is `built_with_status NOT IN (1, 2, 4)` — so a fourth status `4` (skipped) is treated as terminal alongside `1` and `2`. Every other network uses the plain `built_with_status = 0` filter.

---

## 3. `status` in the REPORT body — what each value does

The number **`status`** appears in **two** places and means something different in each — this is the #1 source of confusion (same trap as OCR/OCB).

| Where                          | Meaning                                     | It is…               |
|---                             |---                                          |---                   |
| **LEASE filter** (implicit)    | `built_with_status = 0`                     | a **selector**       |
| **REPORT** (`POST body.status`)| Tells the API what the worker did           | a **command**        |

REPORT body `status` values:

| value | Worker result                                        | API writes                                                           |
|:---:  |---                                                   |---                                                                   |
| `1`   | worker successfully hit the URL and returned tech tokens (any of `built_with` / `built_with_analytics_tracking` / `built_with_cms` / `affiliate_data` populated) | `built_with_status = 1` if any built_with token present, else `3`. Same rule for `affiliate_status`. |
| any other value (typically `0`) | worker gave up (empty result, dead URL, 4xx) | `built_with_status = 3`, `affiliate_status = 3`. Row is done, will not be re-issued. |

---

## 4. Value normalisation rules

Consistent across every network:

- **`||` collapses to `|`** on every built_with field. Workers historically emit `Shopify||Google Analytics`; the API stores `Shopify|Google Analytics`.
- **Empty string → `NULL`** on every field. Trimmed first.
- **Auto-status derivation** — never trust the worker's status math:
  - `built_with_status = 1` iff any of `built_with` / `built_with_analytics_tracking` / `built_with_cms` is non-null after normalisation.
  - `affiliate_status = 1` iff `affiliate_data` is non-null.
- **Timestamps set automatically** — the API stamps `built_with_date` and `clickbank_processed_date` to `NOW()` on every REPORT. Workers do not send these.

---

## 5. Endpoint reference (all platforms)

All paths are prefixed with `/api/v1`. All endpoints are **public** (no auth) — mirrors the PHP.

| Network    | LEASE (`GET`)                                                      | REPORT (`POST`)                                           |
|---         |---                                                                 |---                                                        |
| Facebook   | `/facebook/built-with/getUrlsForOutgoingBuiltWith`                 | `/facebook/built-with/updateOutgoingBuiltWithStatus`      |
| Instagram  | `/instagram/built-with/getUrlForBuiltWith`                         | `/instagram/built-with/updateBuiltWith`                   |
| YouTube    | `/youtube/built-with/getUrlForBuiltWith`                           | `/youtube/built-with/updateBuiltWith`                     |
| LinkedIn   | `/linkedin/built-with/getUrlForBuiltWith`                          | `/linkedin/built-with/updateBuiltWith`                    |
| Google     | `/google/built-with/getUrlForBuiltWith`                            | `/google/built-with/updateBuiltWith`                      |
| GDN        | `/gdn/built-with/getUrlForBuiltWith`                               | `/gdn/built-with/updateBuiltWith`                         |
| Reddit     | `/reddit/built-with/getUrlForBuiltWith`                            | `/reddit/built-with/updateBuiltWith`                      |
| Quora      | `/quora/built-with/getUrlForBuiltWith`                             | `/quora/built-with/updateBuiltWith`                       |
| Pinterest  | `/pinterest/built-with/getUrlForBuiltWith`                         | `/pinterest/built-with/updateBuiltWith`                   |
| Native     | `/native/built-with/getUrlForBuiltWith`                            | `/native/built-with/updateBuiltWith`                      |

> **Only Facebook keeps the PHP verbs** (`getUrlsForOutgoingBuiltWith` / `updateOutgoingBuiltWithStatus`) — that's the naming used by the existing Facebook worker in production. Every other network normalises to the shorter `getUrlForBuiltWith` / `updateBuiltWith` pair.

---

## 6. Per-network schema — where things live

Every network stores its built_with columns on a `<network>_ad_meta_data` table keyed by `<network>_ad_id` — **except LinkedIn**, which uses a split table.

| Network    | Meta table                       | ID column               | LEASE filter                                                              | Extra behaviour                                     |
|---         |---                               |---                      |---                                                                        |---                                                  |
| Facebook   | `facebook_ad_meta_data`          | `facebook_ad_id`        | `built_with_status = 0`                                                   | —                                                   |
| Instagram  | `instagram_ad_meta_data`         | `instagram_ad_id`       | `built_with_status = 0 AND destination_url IS NOT NULL`                   | —                                                   |
| YouTube    | `youtube_ad_meta_data`           | `youtube_ad_id`         | `built_with_status NOT IN (1, 2, 4)`                                      | Status `4` = skipped (also terminal).               |
| LinkedIn   | `linkedin_ad_built_with` (writes) `linkedin_ad_meta_data` (LEASE filter) | `linkedin_ad_id` | `linkedin_ad_meta_data.built_with_status = 0`         | **Split-table.** REPORT writes `linkedin_ad_built_with` **and** mirrors `built_with_status` back to `linkedin_ad_meta_data` so the same row isn't re-issued. |
| Google     | `google_text_ad_meta_data`       | `google_text_ad_id`     | `built_with_status = 0 AND destination_url IS NOT NULL`                   | ES fields are FLAT (see §7).                        |
| GDN        | `gdn_ad_meta_data`               | `gdn_ad_id`             | `built_with_status = 0 AND destination_url IS NOT NULL`                   | —                                                   |
| Reddit     | `reddit_ad_meta_data`            | `reddit_ad_id`          | `built_with_status = 0 AND destination_url IS NOT NULL`                   | —                                                   |
| Quora      | `quora_ad_meta_data`             | `quora_ad_id`           | `built_with_status = 0`                                                   | —                                                   |
| Pinterest  | `pinterest_ad_meta_data`         | `pinterest_ad_id`       | `built_with_status = 0 AND destination_url IS NOT NULL`                   | —                                                   |
| Native     | `native_ad_meta_data`            | `native_ad_id`          | `built_with_status = 0 AND destination_url IS NOT NULL`                   | LEASE does **not** flip `affiliate_status` — matches PHP. |

Every meta_data table shares the same built_with column set:

```
built_with                    VARCHAR   -- primary tech stack, `|`-joined
built_with_analytics_tracking VARCHAR   -- analytics/pixels, `|`-joined
built_with_cms                VARCHAR   -- CMS-specific tokens, `|`-joined
built_with_status             TINYINT   -- 0 / 1 / 2 / 3 (+ 4 for youtube)
built_with_date               DATETIME  -- last REPORT time
affiliate_data                VARCHAR   -- affiliate network name
affiliate_status              TINYINT   -- 0 / 1 / 2 / 3
clickbank_processed_date      DATETIME  -- last REPORT time
```

---

## 7. Elasticsearch overlay quirks (important)

After the SQL update, REPORT patches the ad's ES doc so search filters see the new tech stack immediately. **Three different flavours** across the networks — get this wrong and the ES doc silently drifts from MySQL.

### Flavour A — Dotted meta_data fields, ID search by ad.id

Used by: **Facebook, Instagram, GDN, Reddit, Quora, Pinterest, Native**.

- **Index**: `<network>_search_mix` (facebook uses `search_mix` — no prefix).
- **Doc lookup**: search by `<network>_ad.id = <id>`, then update by `_id`.
- **Fields written**:
  ```
  <network>_ad_meta_data.built_with
  <network>_ad_meta_data.built_with_analytics_tracking
  <network>_ad_meta_data.affiliate_data
  ```

### Flavour B — Flat fields, direct `_id` lookup

Used by: **LinkedIn, YouTube**.

- **Index**: `linkedin_ads_data` / `youtube_ads_data`.
- **Doc lookup**: the ad's SQL id **is** the ES `_id` — no search needed, just direct update.
- **Fields written** (mapped to LinkedIn's/YouTube's flat schema):
  ```
  ecommerce_platform     <— built_with
  funnel                 <— built_with_analytics_tracking
  affiliate_networks     <— affiliate_data
  ```

### Flavour C — Flat fields, ID search by `id`, `_exact` mirror fields

Used by: **Google**.

- **Index**: `google_ads_data`.
- **Doc lookup**: search by `id = <id>` (not `google_text_ad.id`).
- **Fields written**:
  ```
  built_with
  built_with_analytics_tracking
  built_with_analytics_tracking_exact    <— duplicate for exact-match analyzer
  affiliate_data
  affiliate_data_exact                   <— duplicate for exact-match analyzer
  ```

### The ES index is config-driven

Every controller reads `db.elastic?.indexName` first (populated from `config.networks.<net>.elastic.index` via `DatabaseManager`), and only falls back to the literal string constant if the client somehow has no `indexName`. So changing the index in `config.json` propagates to built-with without a code change.

### ES failure never fails REPORT

The overlay is wrapped in its own `try/catch`. If ES times out or the doc is missing, the API logs a warning and **still returns `200`** — MySQL was already updated and is the source of truth. This mirrors the PHP behaviour (its ES block was in an inner `try/catch` that only logged).

---

## 8. Request / response shapes

### LEASE — `GET /api/v1/<network>/built-with/getUrlForBuiltWith`

No body, no query params.

**200 OK** — batch of pending ads (up to 100). The rows have already been flipped to `built_with_status = 2` in the same request.

```json
{
  "code": 200,
  "message": "Ads found for builtwith",
  "data": [
    { "id": 123456, "ad_id": "abc-123", "destination_url": "https://example.com/landing" },
    { "id": 123457, "ad_id": "def-456", "destination_url": "https://example.com/other" }
  ]
}
```

**400** — queue empty, worker should back off.

```json
{ "code": 400, "message": "No more ads available for builtwith", "data": null }
```

**503** — SQL connection not available.

### REPORT — `POST /api/v1/<network>/built-with/updateBuiltWith`

Body — the same shape everywhere (facebook uses `updateOutgoingBuiltWithStatus`, same body):

```json
{
  "id": 123456,
  "status": 1,
  "built_with": "Shopify",
  "built_with_analytics_tracking": "Google Analytics||Facebook Pixel",
  "built_with_cms": "Shopify",
  "affiliate_data": "ClickBank"
}
```

- `id` — the SQL ad ID (`facebook_ad_id`, `quora_ad_id`, etc. — network-specific).
- `status` — `1` if worker returned data, anything else if it gave up.
- `built_with`, `built_with_analytics_tracking`, `built_with_cms`, `affiliate_data` — worker output. `||` is auto-collapsed to `|`, empty strings become `NULL`.

**200 OK**

```json
{ "code": 200, "message": "built with updated" }
```

(Facebook's `updateOutgoingBuiltWithStatus` also includes a `"built with updated": true/false` field for legacy-worker compatibility.)

**400** — missing `id` / `status`, or `id` doesn't exist.

```json
{ "code": 400, "message": ["The id field is required.", "The status field is required."] }
```

---

## 9. Where the data lands

### MySQL (source of truth)

Every REPORT writes to `<network>_ad_meta_data` (or `linkedin_ad_built_with` for LinkedIn):

| Column                       | On `status=1` with data | On `status=1` empty / other statuses |
|---                           |---                      |---                                   |
| `built_with`                 | worker value            | previous value (untouched by status≠1) |
| `built_with_analytics_tracking` | worker value        | previous value                       |
| `built_with_cms`             | worker value            | previous value                       |
| `built_with_status`          | `1`                     | `3`                                  |
| `built_with_date`            | `NOW()`                 | `NOW()`                              |
| `affiliate_data`             | worker value            | previous value                       |
| `affiliate_status`           | `1` (if data) / `3` (empty) | `3`                              |
| `clickbank_processed_date`   | `NOW()`                 | `NOW()`                              |

### Elasticsearch (search index)

See §7 — the fields written depend on the network's ES flavour.

---

## 10. Design decisions & PHP deviations

Places where the Node port deliberately diverges from the PHP source:

1. **LinkedIn — mirror `built_with_status` back to `linkedin_ad_meta_data`.**
   PHP updates only `linkedin_ad_built_with` in REPORT, but the LEASE filter reads from `linkedin_ad_meta_data`. Without the mirror, a completed row would keep being re-issued to workers forever. The Node port writes both tables on REPORT so LEASE stops picking it up. If PHP has a background sync job doing this same mirror, this is a safe no-op; if not, this port fixes a latent bug.

2. **Facebook — real boolean in `"built with updated"`.**
   PHP had `if($update_response["built with updated"] = true)` at line 2940 of `SupportScrapper.php` — that's an **assignment**, not comparison, so the branch was always taken and the `code` was always `200` even when MySQL didn't match a row. The Node port keeps returning `200` (contract preserved for existing workers) but the boolean now reflects reality so a worker can detect a no-op.

3. **Native — LEASE does NOT flip `affiliate_status`.**
   Every other network flips both `built_with_status` and `affiliate_status` to `2` on LEASE. Native's PHP only flipped `built_with_status`. The Node port preserves this quirk (matches PHP) — flag it if it looks like a bug in production behaviour.

4. **Google `updateBuiltWithold` → renamed to `updateBuiltWith`.**
   The PHP method name has a leftover `old` suffix from a long-ago refactor. The Node port normalises the name to `updateBuiltWith` for parity with the other 8 networks. If a legacy worker is calling the old name, add an alias route.

5. **Google `insertSearchMixO()` side-effect skipped.**
   PHP calls a helper `insertSearchMixO($adId)` before the ES update. It looks like a legacy secondary-index write. The Node port does **not** replicate it. If that helper is still doing real work in production, port it separately.

6. **TikTok — not implemented.**
   TikTok has no `tiktok_ad_meta_data` table and no `built_with_status` column in the current codebase. The built-with pipeline needs a schema decision (queue table + destination_url source + ES field names) before it can be built.

---

## Quick reference

- **State machine:** [`0` pending] → LEASE → [`2` processing] → REPORT → [`1` done-with-data] or [`3` done-empty]
- **All routes:** `/api/v1/<network>/built-with/{getUrlForBuiltWith,updateBuiltWith}` (public, no auth)
- **Facebook is the odd verb:** `getUrlsForOutgoingBuiltWith` / `updateOutgoingBuiltWithStatus`
- **YouTube filter is odd:** `NOT IN (1, 2, 4)` — every other network uses `= 0`
- **LinkedIn is odd table:** REPORT writes `linkedin_ad_built_with`, LEASE reads `linkedin_ad_meta_data`
- **ES fields differ:** Flavour A (dotted, most nets) / B (flat, LI+YT with direct `_id`) / C (flat + `_exact` mirrors, Google only)
- **Config-driven index:** `db.elastic?.indexName` first; the hardcoded literal in each controller is only a fallback
