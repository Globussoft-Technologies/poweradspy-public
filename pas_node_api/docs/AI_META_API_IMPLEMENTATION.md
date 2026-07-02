# AI-Meta & Category Read-Back — API Implementation

**Status:** Implemented · **Date:** 2026-07-01 · **Owner:** Anij Burnwal
**Spec:** `AI_META_API_PAYLOAD_SPEC.md` v1.1 · **Backend issues:** `BACKEND_FIX_PROMPT.md` (Issues 1 & 3)

This document describes two related pieces of work on the shared classifier controller
[`src/services/common/controllers/addCategoryController.js`](../src/services/common/controllers/addCategoryController.js):

1. **Extension of the existing category API** (`newCatInsertion` + `getDescriptionDetails`) — read-back, ad-level status, a new single-ad read-back endpoint, and optional `ai_meta` acceptance (Option A).
2. **A new dedicated AI-Meta endpoint** (`POST /ai-meta`, Option B) plus a reusable validator.

All endpoints are **internal (no auth)**, mounted under `/api/v1/common` in
[`commonRoutes.js`](../src/services/common/routes/commonRoutes.js), and documented in `swagger.yml`.

---

## 0. Background — why this was needed

The ad-classification pipeline fetches ads from `getDescriptionDetails`, classifies them, and
POSTs labels back to `newCatInsertion`. Two things blocked it:

- **No read-back.** `newCatInsertion` *did* write the category onto the ad, but nothing ever
  returned it. The classifier re-fetched the feed, saw no category, and concluded the write had
  failed — so it re-processed every ad forever. The response message (`"Category and Subcategory
  already exist"`) described the **master taxonomy index**, not the ad, which made two different
  categories POSTed to the same ad both look like no-ops.
- **AI-Meta had nowhere to land.** The AI-Meta spec's write-back rides on the same endpoint, so it
  would have failed the same way until the read-back existed.

The canonical per-platform category field is the **literal dotted key** `${platform}.category` /
`${platform}.subCategory` (e.g. `facebook.category`, `youtube.category`, `native.category`) — this
is what the ad detail/list readers already consume, so both the write and the read-back use it.

---

## 1. Extension of the existing category API

### 1.1 `GET /getDescriptionDetails` — feed now returns stored labels

Each row in the response gained the following fields (additive — no existing field changed):

| Field | Type | Notes |
|---|---|---|
| `category` | string \| null | Stored `${platform}.category` |
| `sub_category` | string \| null | Stored `${platform}.subCategory` |
| `category_id` | string \| null | Flat `category_id` |
| `subcategory_id` | string \| null | Flat `subCategory_id` |
| `confidence_score` | number \| null | `0` once a human/AI category is assigned |
| `ai` | object \| null | Read-back of any stored AI-Meta enrichment (see §2) |
| `image_url_original` | string \| null | **Native only** — original scraped URL, fallback creative source |

**Image URLs are now resolvable.** `ad_image` and `thumbnail` are passed through a `served()`
helper that strips the stored NAS mount prefix (`/PowerAdspy/n2/…`, `pas-dev/stream`, `pas-prod/stream`)
and prepends the configured CDN base (`config.cdn.baseUrl` / `CDN_BASE_URL`). Already-absolute
`http(s)` URLs pass through untouched. This removes the client-side rewrite the classifier used to do.

**Native creative fallback (Issue 3).** For native `IMAGE` ads, `ad_image` now falls back to
`image_url_original` when the NAS copy is missing (`served(nasValue) ?? served(origValue) ?? null`),
and `image_url_original` is also surfaced on its own field. This lets the classifier recover backlog
ads whose NAS creative was never stored — *provided the scraper kept an original URL*. The native
ingestion pipeline itself faithfully stores whatever the scraper sends; the drop-to-zero at high
exvals is an **upstream payload/scraper problem**, not a storage regression in this service.

### 1.2 `POST /newCatInsertion` — ad-level status + optional `ai_meta`

**Request:** unchanged required fields (`platform`, `category`, `category_id`, `ad_id`,
optional `sub_category`/`subcategory_id`) **plus** an optional `ai_meta` object (§2).

**New response fields** (existing `code`/`message`/`ad_id`/`updated`/`warning` unchanged):

| Field | Values | Meaning |
|---|---|---|
| `ad_status` | `inserted` \| `updated` \| `unchanged` \| `not_found` \| `error` | What happened to the **ad record** — distinct from `message` (which is about the master taxonomy). Computed by comparing the ad's prior category before writing. |
| `ad_category` | string | The category just written |
| `ad_sub_category` | string \| null | The sub-category just written |
| `previous_category` | string \| null | The category the ad held before (present only if it had one) |
| `ai_meta_status` | see §2.4 | Present only when `ai_meta` was supplied |
| `ai_meta_stored_fields` | string[] | ai_meta keys written |
| `ai_meta_errors` | `{field,message}[]` | Present when `ai_meta_status = validation_error` |

The category write is a **doc-merge** (`{ doc: { … } }`) with `refresh: wait_for`, so a subsequent
POST of a *different* category overwrites the previous one and is immediately searchable.

### 1.3 `GET /getAdCategory?platform=&ad_id=` — single-ad read-back (new)

Verifies one ad without paging the whole feed. Matched on the same per-platform key
`newCatInsertion` writes to (`ad_id` for google/youtube, `<net>_ad.id` elsewhere).

```http
GET /api/v1/common/getAdCategory?platform=facebook&ad_id=13011
```
```json
{
  "code": 200, "platform": "facebook", "ad_id": "13011",
  "category": "Retail", "sub_category": "eCommerce",
  "category_id": "1234", "subcategory_id": "12340001",
  "confidence_score": 0,
  "ai": { "ad_type": "testimonial", "status": "success", "...": "..." }
}
```
Responses: `200` (found), `400` (bad/missing platform or ad_id), `404` (ad not found), `503` (ES down).

---

## 2. AI-Meta enrichment

Implements `AI_META_API_PAYLOAD_SPEC.md` v1.1. Data is stored on the ad's ES doc under a single
`ai` object (spec §7 mapping).

### 2.1 Validator — `src/services/common/helpers/aiMetaValidator.js`

`validateAiMeta(aiMeta)` → `{ errors: [{field,message}], normalized, storedFields, status }`.
Pure/synchronous, fully unit-tested. Enforces the entire §3 contract:

- **Enums:** `ad_type`, `intent`, `hook`, `product_type`, `offer.type`, `language`, `status`, and the
  **14-value *named* `colors` vocabulary** (hex codes are rejected — spec v1.1 removed hex/`color_palette`).
- **Cardinality:** `intent`/`hook`/`colors` 1–5, `offers` ≤3, `object` ≤10, `celebrity` ≤5; no duplicates.
- **Offers:** `value` required and `0–100` for `percentage_discount`, required and `≥0` for
  `flat_discount`, `null` for non-numeric types; duplicate `type` allowed only when `value` differs.
- **Text:** `ocr` ≤2000 (newlines allowed, other control chars rejected), `offering` ≤200 (no newlines),
  `brand` ≤100 (non-empty if present).

**Required-field relaxation (product decision).** `status` is *always* required. The core labels
(`ad_type`, `intent`, `hook`, `product_type`, `language`) are required **only** when `status` is
`success` or `partial`. For `failed`/`queued`, only `status` is needed; any present fields are still
format-checked. This resolves the spec's internal contradiction (§3 marks them Required while §3.15
says a `failed` payload may be "mostly empty").

### 2.2 Option A — `ai_meta` on `newCatInsertion`

`newCatInsertion` accepts an optional `ai_meta` object alongside the category fields. It is
**additive and non-blocking**: an invalid `ai_meta` never fails the category write — it is reported
via `ai_meta_status: "validation_error"` + `ai_meta_errors`, while the category result stands.

### 2.3 Option B — `POST /ai-meta` (dedicated, strict)

Standalone, spec-conformant write path — decoupled from category classification (it writes only the
`ai` object, never `${platform}.category`).

**Request** (spec §2):
```json
{
  "ad_id": "48979890",
  "network": "instagram",
  "major_category": "Consumer Packaged Goods",   // optional; not written by this endpoint
  "sub_category": "Vitamins and Supplements",     // optional
  "ai_meta": { "ad_type": "testimonial", "intent": ["conversion"], "...": "...", "status": "success" }
}
```
`network` is required (alias `platform` also accepted). `major_category`/`sub_category` are accepted
but ignored for writing — category classification stays on `newCatInsertion`.

**Responses** (spec §6, verbatim shapes):

| Status | Body |
|---|---|
| `200` | `{ success:true, ad_id, message, stored_fields:[…] }` |
| `400` | `{ success:false, ad_id, error:{ code:"VALIDATION_ERROR", message, details:[{field,message}] } }` |
| `404` | `{ success:false, ad_id, error:{ code:"AD_NOT_FOUND", message } }` |
| `503` | `{ success:false, ad_id, error:{ code:"ES_UNAVAILABLE", message } }` |

### 2.4 Write policy — idempotency & partial/failed (both options)

A single painless script performs the write atomically:

```painless
if (params.replace) { ctx._source.ai = params.ai; }
else { if (ctx._source.ai == null) { ctx._source.ai = params.ai; }
       else { ctx._source.ai.status = params.status; } }
```

- `status` = `success` / `partial` → **replace** the whole `ai` object (`replace = true`). Overwrite
  idempotency: re-sending replaces prior labels.
- `status` = `failed` / `queued` → **only set `ai.status`**, preserving any prior good labels (or
  write the minimal object if the ad had no `ai` yet).

`ai_meta_status` (Option A) / outcome mapping:

| Value | When |
|---|---|
| `stored` | success/partial — full `ai` object written |
| `status_only` | failed/queued — only `ai.status` recorded |
| `validation_error` | payload failed validation (Option A only; Option B returns `400`) |
| `ad_not_found` | ad id not in the platform index (Option A only; Option B returns `404`) |
| `error` | ES update threw |

### 2.5 Read-back

The stored `ai` object is returned by both `GET /getDescriptionDetails` (feed) and
`GET /getAdCategory` (single ad), so the classifier can verify an enrichment write and skip
already-enriched ads.

---

## 3. Decisions (spec §8 open questions)

| # | Question | Decision |
|---|---|---|
| 1 | Endpoint choice | **Both** A (extend `newCatInsertion`) and B (dedicated `/ai-meta`), sharing one validator + writer. |
| 2 | Partial writes | `partial` writes its valid fields (treated like `success`); `failed`/`queued` record status only. |
| 3 | Idempotency | **Overwrite** on `success`/`partial`; never clobber on `failed`/`queued`. |
| 4 | Indexing trigger | Direct ES write with `refresh: wait_for` — immediately searchable, no separate cron. |

---

## 4. Tests

- `tests/services/common/helpers/aiMetaValidator.test.mjs` — validator (enums, cardinality, offers,
  text rules, required-field relaxation).
- `tests/services/common/controllers/addCategoryController.test.mjs` — feed read-back, native
  fallback, `ad_status` transitions, `getAdCategory`, `insertAiMeta` (200/400/404/503), and Option-A
  `ai_meta` integration.
- `tests/services/common/routes/commonRoutes.test.mjs` — route registration.

Run:
```bash
npx vitest run tests/services/common
```
All `tests/services/common` suites green (566 tests).

---

## 5. Deployment notes

1. **ES mapping (spec §7):** apply the explicit `ai` mapping to each `<network>_search_mix` index
   **before** first write. The code writes the data regardless, but without the mapping ES 6.8
   dynamic-maps sub-fields (e.g. `ai.colors` as text+keyword, `ai.offers` as object) — and a later
   mapping change to `keyword`/`nested` would require a reindex.
2. **CDN base:** `getDescriptionDetails` image resolution needs `config.cdn.baseUrl` (or
   `CDN_BASE_URL`) set; if empty, NAS-relative paths are returned unchanged (no regression).
3. **Native backlog:** the `image_url_original` fallback only helps ads that actually kept an
   original URL. Ads whose creative was never captured upstream cannot be recovered from this service
   — that requires the scraper/source team.
