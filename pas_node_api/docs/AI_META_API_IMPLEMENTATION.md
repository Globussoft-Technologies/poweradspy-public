# AI-Meta & Category Read-Back API Implementation

**Status:** Implemented **Date:** 2026-07-01, updated for spec v1.5 (2026-07-10) and v1.6 (2026-07-13) **Owner:** Anij Burnwal
**Spec:** `AI_META_API_PAYLOAD_SPEC.md` **v1.6** **Backend issues:** `BACKEND_FIX_PROMPT.md` (Issues 1 & 3)

This document describes two related pieces of work on the shared classifier controller
[`src/services/common/controllers/addCategoryController.js`](../src/services/common/controllers/addCategoryController.js):

1. **Extension of the existing category API** (`newCatInsertion` + `getDescriptionDetails`) read-back, ad-level status, a new single-ad read-back endpoint, and optional `ai_meta` acceptance (Option A).
2. **A new dedicated AI-Meta endpoint** (`POST /ai-meta`, Option B) plus a reusable validator.

All endpoints are **internal (no auth)**, mounted under `/api/v1/common` in
[`commonRoutes.js`](../src/services/common/routes/commonRoutes.js), and documented in `swagger.yml`.

---

## 0. Background why this was needed

The ad-classification pipeline fetches ads from `getDescriptionDetails`, classifies them, and
POSTs labels back to `newCatInsertion`. Two things blocked it:

- **No read-back.** `newCatInsertion` *did* write the category onto the ad, but nothing ever
 returned it. The classifier re-fetched the feed, saw no category, and concluded the write had
 failed so it re-processed every ad forever. The response message (`"Category and Subcategory
 already exist"`) described the **master taxonomy index**, not the ad, which made two different
 categories POSTed to the same ad both look like no-ops.
- **AI-Meta had nowhere to land.** The AI-Meta spec's write-back rides on the same endpoint, so it
 would have failed the same way until the read-back existed.

The canonical per-platform category field is the **literal dotted key** `${platform}.category` /
`${platform}.subCategory` (e.g. `facebook.category`, `youtube.category`, `native.category`) this
is what the ad detail/list readers already consume, so both the write and the read-back use it.

---

## 1. Extension of the existing category API

### 1.1 `GET /getDescriptionDetails` feed now returns stored labels

Each row in the response gained the following fields (additive no existing field changed):

| Field | Type | Notes |
|---|---|---|
| `category` | string \| null | Stored `${platform}.category` |
| `sub_category` | string \| null | Stored `${platform}.subCategory` |
| `category_id` | string \| null | Flat `category_id` |
| `subcategory_id` | string \| null | Flat `subCategory_id` |
| `confidence_score` | number \| null | `0` once a human/AI category is assigned |
| `ai_meta` | object \| null | Read-back of any stored AI-Meta enrichment (see 2), regardless of whether ES stored it under `ai` or `ai_meta` |
| `native_creative_type` | string \| null | **Native only** source creative label when available (`IMAGE` / `TEXT`) |
| `image_url_original` | string \| null | **Native only** original scraped URL, fallback creative source |

**Image URLs are now resolvable.** `ad_image` and `thumbnail` are passed through a `served()`
helper that strips the stored NAS mount prefix (`/PowerAdspy/n2/`, `pas-dev/stream`, `pas-prod/stream`)
and prepends the configured CDN base (`config.cdn.baseUrl` / `CDN_BASE_URL`). Already-absolute
`http(s)` URLs pass through untouched. This removes the client-side rewrite the classifier used to do.

**Native creative fallback (Issue 3).** For native `IMAGE` and `TEXT` ads, `ad_image` now falls
back to `image_url_original` when the NAS copy is missing (`served(nasValue) ?? served(origValue) ??
null`), and `image_url_original` is also surfaced on its own field. This fallback is driven by real
image availability, not by the native creative-type label, so a TEXT ad with a valid original image
URL is still classified against the same creative visible in PowerAdSpy. If neither source has a
usable image, `ad_image` stays null/omitted per the existing response convention. The native
ingestion pipeline itself faithfully stores whatever the scraper sends; the drop-to-zero at high
exvals is an **upstream payload/scraper problem**, not a storage regression in this service.
The placeholder filenames `/bydefault_ads.jpg` and `/bydefault_ads.png` are treated as missing
creative values, so they do not block fallback to a real `image_url_original`.

### 1.2 `POST /newCatInsertion` ad-level status + optional `ai_meta`

**Request:** unchanged required fields (`platform`, `category`, `category_id`, `ad_id`,
optional `sub_category`/`subcategory_id`) **plus** an optional `ai_meta` object (2).

**New response fields** (existing `code`/`message`/`ad_id`/`updated`/`warning` unchanged):

| Field | Values | Meaning |
|---|---|---|
| `ad_status` | `inserted` \| `updated` \| `unchanged` \| `not_found` \| `error` | What happened to the **ad record** distinct from `message` (which is about the master taxonomy). Computed by comparing the ad's prior category before writing. |
| `ad_category` | string | The category just written |
| `ad_sub_category` | string \| null | The sub-category just written |
| `previous_category` | string \| null | The category the ad held before (present only if it had one) |
| `ai_meta_status` | see 2.4 | Present only when `ai_meta` was supplied |
| `ai_meta_stored_fields` | string[] | ai_meta keys written |
| `ai_meta_errors` | `{field,message}[]` | Present when `ai_meta_status = validation_error` |

The category write is a **doc-merge** (`{ doc: { } }`) with `refresh: wait_for`, so a subsequent
POST of a *different* category overwrites the previous one and is immediately searchable.

### 1.3 `GET /getAdCategory?platform=&ad_id=` single-ad read-back (new)

Verifies one ad without paging the whole feed. Matched on the same per-platform key
`newCatInsertion` writes to (`ad_id` for google/youtube, `<net>_ad.id` elsewhere).

```http
GET /api/v1/common/getAdCategory?platform=facebook&ad_id=13011
```

Google has distinct internal `id` and public `ad_id` values. Analytics callers that hold
the internal result-row identifier must make that intent explicit:

```http
GET /api/v1/common/getAdCategory?platform=google&internal_id=212008
```

`internal_id` is Google-only and queries the ES `id` field directly. Supplying both
`ad_id` and `internal_id` returns `400`; this prevents collisions where one ad's internal
`id` equals another ad's public `ad_id`. Existing `ad_id` callers remain unchanged.

```json
{
 "code": 200, "platform": "facebook", "ad_id": "13011",
 "category": "Retail", "sub_category": "eCommerce",
 "category_id": "1234", "subcategory_id": "12340001",
 "confidence_score": 0,
 "ai_meta": { "ad_type": "promotional", "offering_type": "product", "...": "..." }
}
```
Responses: `200` (found), `400` (bad/missing platform or identifier), `404` (ad not found), `503` (ES down).

---

## 2. AI-Meta enrichment

Implements `AI_META_API_PAYLOAD_SPEC.md` **v1.6** (2026-07-13). Data is stored on the ad's ES doc
under a single AI-Meta object (spec 7 mapping): normally the ES field is `ai`, but the
production Facebook index uses `ai_meta` to bypass the poisoned legacy mapping. Field set = 8 core (`ad_type`, `intent`, `hook`,
`offering_type`, `offer_type`, `offering`, `caption`, `roa`) + `colors` + the category classification group
(`category`/`category_id`/`sub_category`/`subcategory_id`).

> **Lineage vs the original v1.1 build:** `product_type`**`offering_type`** (enum shrank to
> `product`/`service`/`both`); `reason`**`roa`**; **added `caption`**; **removed** `object`,
> `language`, `ocr`, `brand_logos`, **`status`**, and in **v1.5** **`brand`** and **`celebrity`**.
> **v1.6:** the category name **and its ids** (`category_id` 4-char, `subcategory_id` 8-char) now travel
> inside `ai_meta` the top-level classification fields are retired so `/ai-meta` can drive the flat ES
> ad-doc codes and maintain the master `category` taxonomy index on its own. With `status` gone there is no
> partial/failed state every payload is a completed enrichment, so the whole `ai_meta` object is always
> replaced. `colors` is a fixed **16-value HEX palette** (not the never-shipped named-word vocab).

### 2.1 Validator `src/services/common/helpers/aiMetaValidator.js`

`validateAiMeta(aiMeta)` `{ errors: [{field,message}], normalized, storedFields }`.
Pure/synchronous, fully unit-tested. Enforces the entire 3 contract:

- **Required core (always):** `ad_type`, `intent`, `hook`, `offering_type`. (No `status` field no
 partial/failed relaxation; every payload must carry these.)
- **Enums:** `ad_type` (16), `intent` (11), `hook` (16), `offering_type` (`product`/`service`/`both`),
 `offer_type` (13), and the **16-value HEX `colors` palette** named-word colors and off-palette hex
 are both rejected (compared case-insensitively, normalised to the palette's uppercase form).
- **Cardinality:** `intent`/`hook` 15, `colors` 03; no duplicates.
- **Offers compatibility:** legacy `offers` arrays are accepted only when `offer_type` is absent.
- **Offer type:** `offer_type` is a scalar string-or-null field; it is validated against the 13-value enum
 and stored as `null` when no offer is identified.
- **Production ES compatibility:** production received `offer_type` before the explicit mapping ran, so
 Elasticsearch dynamically created it as `text` with an `offer_type.keyword` multi-field. Production
 exact-match filters use that keyword sub-field; staging/development use the intended keyword base field.
 Writes keep the same `offer_type` JSON shape in every environment.
- **Text:** `offering`/`caption` 200 (no newlines/control chars, empty omitted); `roa` sub-fields
 (`intent`/`hook`/`offering_type`/`offering`) each 200, empties dropped, whole object omitted if all empty.
- **Category group (v1.6):** `category` (5) `category_id` (exactly 4) travel together; `sub_category`
 (2) `subcategory_id` (exactly 8, prefixed by `category_id`) travel together; a sub requires a parent
 category; a failed name/id pair drops **both** halves (no half-pairs); the whole group is optional.
- **Unknown fields ignored:** legacy/removed keys (`product_type`, `brand`, `celebrity`, ) are not
 errored, just dropped a payload sending the old `product_type` instead of `offering_type` still fails
 because the now-required `offering_type` is missing, which is the intended rejection.

### 2.2 Option A `ai_meta` on `newCatInsertion`

`newCatInsertion` accepts an optional `ai_meta` object alongside the (legacy top-level) category fields. It
is **additive and non-blocking**: an invalid `ai_meta` never fails the category write it is reported via
`ai_meta_status: "validation_error"` + `ai_meta_errors`, while the category result stands. On success the
AI-Meta object is written and dual-persisted to SQL (`ai_meta_sql`). Category on this path is still driven by
the top-level classification (Step 1 taxonomy + Step 2 flat-code ad update), so the ai_meta category is not
re-applied here. **Once the DS pipeline ships v1.6, `/ai-meta` (Option B) is the intended single endpoint;**
Option A stays for backward compatibility.

### 2.3 Option B `POST /ai-meta` (dedicated) now the full category writer

Standalone, spec-conformant write path. **As of v1.6 it is no longer decoupled from category** because
the category name + ids arrive inside `ai_meta`, this endpoint now, when a category is present:
1. writes the AI-Meta object to the environment/platform-appropriate ES field,
2. maintains the master `category` taxonomy index (shared `syncMasterCategory`, using `category_id`/
 `subcategory_id`),
3. mirrors the dotted names + flat 4/8-char codes onto the ad doc (`mirrorCategoryToEs`), and
4. dual-writes to SQL (`persistAiMeta`), syncing the category name to `<net>_ad.category_id` where a store
 exists.
Steps 23 are non-fatal and surfaced under `category_sync`; step 4 under `sql`.

**Request** (spec 2):
```json
{
 "ad_id": "531218",
 "network": "facebook",
 "ai_meta": {
 "ad_type": "promotional", "intent": ["conversion"], "hook": ["urgency"], "offering_type": "product",
 "category": "Retail", "category_id": "1234",
 "sub_category": "Specialty Stores", "subcategory_id": "12340001"
 }
}
```
`network` is required (alias `platform` also accepted). The category group is optional; when present it
must carry its ids (2.1).

**Responses** (spec 6, verbatim shapes):

| Status | Body |
|---|---|
| `200` | `{ success:true, ad_id, message, stored_fields:[], category_sync?:{taxonomy,mirrored}, sql:{sql_status,} }` |
| `400` | `{ success:false, ad_id, error:{ code:"VALIDATION_ERROR", message, details:[{field,message}] } }` |
| `404` | `{ success:false, ad_id, error:{ code:"AD_NOT_FOUND", message } }` |
| `503` | `{ success:false, ad_id, error:{ code:"ES_UNAVAILABLE", message } }` |

**Retryable category-sync failures.** When the taxonomy or ES mirror step times out, the endpoint
returns a structured failure instead of claiming full success. The response includes
`error.code = CATEGORY_SYNC_RETRYABLE` when the failure is retryable, `category_sync.retryable = true`,
the retry delay in seconds, and a `Retry-After` header on the HTTP response.

**Timing headers.** Successful and retryable responses include coarse timings for the major stages:
`X-ES-Search-Ms`, `X-ES-Write-Ms`, `X-Category-Sync-Ms`, `X-SQL-Ms`, `X-Total-Ms`, plus
`Server-Timing`.

**ES timeout and proxy requirement.** AI-Meta ES operations use one client-side attempt with a
15-second default timeout (`AI_META_OPERATION_TIMEOUT_MS` can override it) and no hidden client
retries. A temporary primary ES read/write failure returns `503 ES_UNAVAILABLE` with `Retry-After`;
category mirror/taxonomy failures return `503 CATEGORY_SYNC_RETRYABLE`. The production reverse
proxy and Cloudflare origin timeout must exceed 15 seconds; **30 seconds or greater is required**
to leave response-headroom for the API to return its structured retryable response and timing headers.

### 2.3.1 `POST /ai-meta/bulk`

Bulk wrapper for backlog draining. The endpoint accepts either a raw array of requests or an object
with one of `items`, `requests`, `records`, or `data`.

Processing is intentionally **sequential** so one batch does not fan out concurrent SQL/ES writes.
Each element runs through the exact same validator, ES writer, SQL writer, and category-sync path as
the single-item endpoint.

**Batch limit.** `config.json` controls the limits under `aiMeta`: `bulkRecommendedSize` defaults
to **5** and `bulkMaxSize` defaults to **10**. Submit the next batch only after the prior response
returns; this keeps the bulk drain to one SQL/ES write chain at a time and avoids concentrating load
on a network's database. The configured values can be refreshed through `config.reload()`; invalid
or missing values fall back to these safe defaults.

Response behavior:

- `200` when every item succeeds.
- `207` when the batch has a mix of successes and failures.
- `summary.total`, `summary.success`, `summary.failed`.
- `results[]` with the per-item `request_id`, `ad_id`, `network`, `status_code`, `success`,
  `retryable`, `retry_after`, `message`, `error`, `stored_fields`, `sql`, and `category_sync`.

Retryable result example:

```json
{
  "status_code": 503,
  "success": false,
  "retryable": true,
  "retry_after": 30,
  "error": {
    "code": "ES_UNAVAILABLE",
    "message": "Elasticsearch is temporarily unavailable; retry this idempotent request"
  }
}
```

The bulk route is intended for modest backlog draining, not unbounded fan-out. Requests above the
configured `aiMeta.bulkMaxSize` return `400 VALIDATION_ERROR` before any item is written. Submit
separate batches per network when draining a backlog: sequential processing intentionally prevents
a slow Facebook or Google ES write from creating concurrent database pressure, but it also means a
slow item delays subsequent mixed-network items.


### 2.4 Write policy idempotency (both options)

A single painless script assigns the whole AI-Meta object atomically:

```painless
ctx._source.<resolved_ai_field> = params.aiMeta;
```

The object is **replaced** on every write (not doc-merged), so re-sending overwrites prior labels and
stale sub-fields from an older payload shape (e.g. a leftover `object`/`status`/`brand` from a v1.1v1.4
write) are dropped. `status` was removed (v1.3), so there is no partial/failed path every payload is a
completed enrichment. The default write policy is `refresh: wait_for` so it is immediately
searchable. Networks listed in `config.aiMeta.forceRefreshNetworks` use `refresh: true` for
AI-Meta ad-document writes instead: this forces refresh of only the affected shard and prevents
the endpoint from waiting behind that index's long `refresh_interval`. The default configuration
enables this narrowly for Facebook and Google; all other AI-Meta writes retain `wait_for`.

`ai_meta_status` (Option A) / outcome mapping:

| Value | When |
|---|---|
| `stored` | full AI-Meta object written |
| `validation_error` | payload failed validation (Option A only; Option B returns `400`) |
| `ad_not_found` | ad id not in the platform index (Option A only; Option B returns `404`) |
| `error` | ES update threw |

### 2.5 Read-back

The stored AI-Meta object is returned as `ai_meta` by both `GET /getDescriptionDetails` (feed) and
`GET /getAdCategory` (single ad), so the classifier can verify an enrichment write and skip
already-enriched ads.

### 2.6 SQL dual-write `src/services/common/helpers/aiMetaSqlWriter.js`

ES is the search store; SQL is the durable system-of-record copy. `persistAiMeta({ sql, network, adId,
normalized, logger })` runs alongside every ES `writeAiMeta` (both options), in **one transaction**, and is
**non-fatal** any failure returns a status object and never throws, so an ES success is never lost. Full
schema/design in `docs/AI_META_SQL_STORAGE.md`. In short:

- **Upsert** the validated `ai_meta` object into `<net>_ad_ai_meta` (1:1 with `<net>_ad`, keyed on the
 public `ad_id` internal PK). JSON fields (`intent`/`hook`/`colors`/`roa`) are `JSON.stringify`'d
 into `JSON` columns; `offer_type` is stored as a scalar column, and legacy `offers` only remains for
 migration compatibility; absent fields bind SQL `NULL` (whole-object replace via `ON DUPLICATE KEY`).
- **Offer contract:** `offer_type` is the scalar field for the new contract. Legacy `offers` remains
 compatibility-only during migration and is not emitted when `offer_type` is present.
- **Category dual-write:** category/sub_category (+ the v1.6 `category_id`/`subcategory_id`) come from the
 **`ai_meta` object** (the top-level `newCatInsertion` category is retired). When a category is present and
 the network has a SQL category store, the name is resolved to its `<net>_category.id` (SELECT-then-INSERT)
 and written to `<net>_ad.category_id`; the controller also maintains the master `category` taxonomy index
 (`syncMasterCategory`, using the ids) and mirrors the names + flat codes to the ad doc
 (`mirrorCategoryToEs`). **Only 7 networks have a SQL category store** (facebook, instagram, youtube,
 native, linkedin, reddit, quora); **gdn, google, pinterest, tiktok have none** category stays ES-only
 there. `sub_category` has no SQL category-table home, so it lives only in `<net>_ad_ai_meta.sub_category`.
- **Status:** returned as `{ sql_status: 'stored'|'skipped'|'ad_not_found'|'error', sql_ad_row_id?,
 category_synced?, sql_error? }`, surfaced on the response as `ai_meta_sql` (Option A) / `sql` (Option B).

---

## 3. Decisions (spec 8 open questions)

| # | Question | Decision |
|---|---|---|
| 1 | Endpoint choice | **Both** A (extend `newCatInsertion`) and B (dedicated `/ai-meta`), sharing one validator + writer. |
| 2 | Idempotency | **Overwrite** the whole AI-Meta object is replaced on every write. (`status` was dropped, so the earlier partial/failed policy no longer applies.) |
| 3 | Indexing trigger | Direct ES write immediately searchable, no separate cron. The default is `refresh: wait_for`; configured long-refresh networks use shard-scoped `refresh: true`. |
| 4 | Durable store | **Dual-write to SQL** (`<net>_ad_ai_meta`) alongside ES, non-fatal. category/sub_category sourced from the `ai_meta` object; category also synced to the pre-existing `<net>_ad.category_id` store where one exists (7/11 networks). |
| 5 | Category location (v1.6) | Category **name + 4/8-char ids live inside `ai_meta`** (top-level classification fields retired). This lets **Option B (`/ai-meta`) be the single endpoint** it maintains the taxonomy index and the flat ES codes from the ids. `newCatInsertion` (Option A) is kept as-is for backward compatibility; its taxonomy logic is now shared via `syncMasterCategory`. |

---

## 4. Tests

- `tests/services/common/helpers/aiMetaValidator.test.mjs` validator (offering_type rename, hex
 colors, offer_type scalar + legacy offers compatibility, `caption`/`roa`, cardinality, no-status, removed brand/celebrity ignored, and the
 v1.6 category group: nameid pairing, 4/8-char formats, subcategory_id prefix, half-pair drop).
- `tests/services/common/controllers/addCategoryController.test.mjs` feed read-back, native
  fallback, `ad_status` transitions, `getAdCategory`, `insertAiMeta` (200/400/404/503), bulk
  batching (207 mixed-result handling), primary ES-write and category-mirror retryable timeout
  paths, Option-A `ai_meta` integration, and the SQL dual-write wiring (both options, ES category
  mirror, non-fatal).
- `tests/database/DatabaseManager.test.mjs` verifies ES request transport options are forwarded
  through the database adapter rather than silently discarded.
- `tests/services/common/helpers/aiMetaSqlWriter.test.mjs` `persistAiMeta` (upsert params, JSON NULL
  binding, category nameid resolve/insert, networks without a category store, rollback on error).
- `tests/services/common/routes/commonRoutes.test.mjs` route registration, including `/ai-meta/bulk`.

Run:
```bash
npx vitest run tests/services/common
```
All `tests/services/common` suites green (615 tests).

---

## 5. Deployment notes

1. **ES mapping (spec 7):** apply the explicit AI-Meta mapping to each network's index **before** first
 write. The code writes the data regardless, but without the mapping ES 6.8 dynamic-maps sub-fields
 (e.g. `ai_meta.colors` and `ai_meta.offer_type` as text+keyword) and a later type change would
 require a reindex. **Step-by-step runbook (per-network index list, ES 6.8 vs TikTok 8.x PUT forms,
 curl/Kibana/Node-script methods, verification, reindex fallback): [`AI_META_ES_MAPPING_RUNBOOK.md`](./AI_META_ES_MAPPING_RUNBOOK.md).**
2. **CDN base:** `getDescriptionDetails` image resolution needs `config.cdn.baseUrl` (or
 `CDN_BASE_URL`) set; if empty, NAS-relative paths are returned unchanged (no regression).
3. **Native backlog:** the `image_url_original` fallback only helps ads that actually kept an
 original URL. Ads whose creative was never captured upstream cannot be recovered from this service
 that requires the scraper/source team.
4. **SQL tables (dual-write):** apply the per-network `<net>_ad_ai_meta` DDL from
 [`AI_META_SQL_STORAGE.md`](./AI_META_SQL_STORAGE.md) **before** go-live. Until the table exists,
 `persistAiMeta` returns `{ sql_status: 'error' }` non-fatal (ES still succeeds), but no durable copy
 is written. Take the schema name from `networks.<net>.sql.database` per environment.
