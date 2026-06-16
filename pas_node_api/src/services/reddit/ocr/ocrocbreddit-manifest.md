# OCR / OCB Reddit — Migration Manifest

Migration of two PHP endpoints from `api_reddit` (Laravel `AdDetailsController`) into
`pas_node_api` (Express). Together they power the **reddit image OCR/OCB pipeline**:
an external scraper leases image ads, runs **OCB** (Object / Celebrity / Brand-logo)
and **OCR** (text-in-image) detection, and writes the results back to MySQL and
Elasticsearch.

- **Source (PHP):** `api_reddit/app/Modules/RedditUser` (`Controllers/AdDetailsController.php`, `Models/Reddit_ad_variants.php`)
- **Target (Node):** `pas_node_api/src/services/reddit/ocr` + controller + route
- **Reference:** modelled on the already-migrated **quora** and **native** ocr modules
  (`src/services/quora/ocr`, `src/services/native/ocr`). Reddit's `updateImageDetails`
  has its own quirks — see §3.

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/reddit` (every `*.js` in the
service's `routes/` folder is discovered and mounted automatically — the new
`routes/redditOcrRoutes.js` exports a `createRedditOcrRoutes(service)` function).

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/reddit/ocr/getImageUrl`        | `AdDetailsController@getImagesUrl`   (`Route::get('getImageUrl', ...)`) | Lease a batch of image ads queued for processing |
| `POST` | `/api/v1/reddit/ocr/updateImageDetails` | `AdDetailsController@updateImageDetails` (`Route::post('updateImageDetails', ...)`) | Persist OCR/OCB results back to MySQL + ES |

Neither endpoint requires auth (faithful to the PHP, which had these outside the
`jwt.auth` group). **Every response is HTTP `200`; the real outcome is in the body
`code` field** — preserving the PHP contract so existing scraper clients keep working.

### 1.1 `GET getImageUrl` — lease work

Hands out up to **20** `IMAGE`-type ads queued for processing, resolves each
`image_url` to an absolute URL, and marks them in-progress (`image_url_status = 2`)
so the next call does not hand out the same ads.

**Input** — `status` (query string; also accepted in body):

| `status` | Queue | `image_url_status` filter | Returns `image_ocr`? |
| -------- | ----- | ------------------------- | -------------------- |
| `0`      | **OCB** (object / celebrity / brand) | `0` | no  |
| `4`      | **OCR** (text)                       | `4` | yes |

**Responses** (HTTP 200, outcome in `code`):

```json
{
  "code": 200,
  "message": "Image Url fetched successfully",
  "data": [ { "ad_id": 112526, "image_url": "https://media.globussoft.com/.../264082.jpg" } ],
  "exe_time": 0.01
}
```
- `code 400` `"No More Image are present"` — queue empty.
- `code 400` `["The status field is required."]` (JSON string) — `status` missing.
- `code 401` `"No More Image are present"` — unexpected error (PHP parity).

### 1.2 `POST updateImageDetails` — report results

Persists scraper output into MySQL (`reddit_ad_variants`) and mirrors it into
Elasticsearch (`reddit_search_mix`).

**Body:** `ad_id` (**required**), `status` (`1` = OCB done · `4` = OCR done),
`object`, `celebrity`, `brand_logo`, `ocr` (all optional, `||`-delimited).

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `" Image Data Updated Successfully"` (note the leading space — PHP parity).
- `code 400` `"ad_id is not available"` — no variant row for that `ad_id` (or `ad_id` missing).
- `code 400` `"Ad not found<br>"` — variant updated, but no ES document matched.
- `code 400` `"ad not found"` — ES update was a no-op.
- `code 400` `"Some Error occured"` — unexpected error (PHP outer catch).

---

## 2. Status lifecycle (`image_url_status`)

```
 0  pending OCB (object/celebrity/brand)  ← queued
 4  pending OCR (text)                     ←
 2  leased / in progress (handed to scraper)
 1  complete / done (OCB)
```
OCB is **leased** with `status 0` but **reported done** with `status 1`; OCR uses
`4` on both sides.

---

## 3. Behaviour detail — Reddit-specific quirks (faithful to PHP)

`getImagesUrl` is identical in shape to the quora/native ports. **`updateImageDetails`
differs from quora/native in three ways, all reproduced in
`ocr/services/updateImageOcrService.js`:**

1. **Multi-value delimiter is `|`, not `||`.** Each field is first normalised with
   `str_replace(['||,','||'], '|', value)` and then split on `|`. Multi-value fields
   are stored in MySQL as a **JSON-encoded array string** (`["a","b"]`); single values
   are stored as the raw scalar (or `NULL`). The ES "search-mix" value is the array
   when multi-valued, else the raw scalar (with PHP's quirky
   `strpos(v, ',') == true ? json_decode(v) : v` fallback preserved in `scalarSearchMix`).

2. **`image_url_status` only accepts `1` or `4`.** Any other status (including `2`)
   leaves `image_url_status = 0`. The quora "status 2 → `3`/`1` null-check" branch
   does **not** exist in the reddit PHP (it is commented out there).

3. **`ocr` keeps the existing row value when present.** If the variant's existing
   `image_ocr` is not null, it is preserved (unless the posted `ocr` is itself
   multi-valued, i.e. contains `|`). Otherwise the posted `ocr` (or `NULL`) is used.

MySQL columns written on `reddit_ad_variants` (keyed by `reddit_ad_id`):

| Column | When written | Driven by |
| ------ | ------------ | --------- |
| `image_text_final_status` | only if it was `0` → set to `status` | `status` |
| `image_object` / `image_celebrity` / `image_brand_logo` | always (overwrite) | normalised field (`NULL` if empty) |
| `image_ocr`               | always; keeps existing when present | `ocr` (see §3.3) |
| `image_url_status`        | always | `status` if `1`/`4`, else `0` |
| `object_update_date`      | only when `status = 1` | timestamp |
| `ocr_updated_date`        | only when `status = 4` | timestamp |

Elasticsearch (`reddit_search_mix`):
- Locate the doc by `match reddit_ad.id = ad_id` (else `code 400 "Ad not found<br>"`).
- Write the full multilingual field family (`_ru` / `_fr` / `_sp` / `_exactly`) for
  object/celebrity/brand. The `image_ocr*` family is added **only when `status = 4`**.
- Update with `detect_noop: false`.
- SQL write and ES write are **independent** — a successful SQL update followed by a
  missing ES doc still returns `code 400` (intentional PHP parity).

---

## 4. File layout

```
src/services/reddit/
├── routes/
│   └── redditOcrRoutes.js              # GET getImageUrl, POST updateImageDetails  (NEW)
├── controllers/
│   └── redditOcrController.js          # thin HTTP layer (validation, status codes) (NEW)
└── ocr/
    ├── repository.js                   # raw parameterized SQL (function-per-op)     (NEW)
    ├── services/
    │   ├── getImageUrlService.js       # lease logic + URL resolution                (NEW)
    │   └── updateImageOcrService.js    # MySQL + Elasticsearch write logic           (NEW)
    └── ocrocbreddit-manifest.md        # this file                                   (NEW)
```

Layering mirrors the quora/native ocr modules: **routes → controller → service →
repository.** Data access is a single `repository.js` of plain functions, each taking
`exec` (the `db.sql` pool wrapper) as its first arg.

---

## 5. Image URL resolution

Relative `image_url` values are resolved to absolute URLs through the shared NAS helper
**`src/insertion/helpers/nasClient.js` → `resolveMediaUrl`** (the same export the quora
and native ocr modules use), against `config.insertion.nas.mediaUrl`
(env `NAS_MEDIA_URL`, e.g. `https://media.globussoft.com`). Already-absolute URLs are
left untouched. This collapses the PHP's two bases (`AWS_URL` / `API_URL`) into the
single NAS media base — same decision as the quora/native migrations.

---

## 6. Data touched

- **MySQL** (`reddit` pool, db `pasdev_reddit`):
  - `reddit_ad_variants` — read + update (keyed by `reddit_ad_id`).
  - `reddit_ad` — join only (`type = 'IMAGE'` filter).
- **Elasticsearch** (`reddit` connection → index `reddit_search_mix`): `search` + `update`.

---

## 7. Files changed in this migration

**Added (all additive — no existing reddit route/controller/repository was touched):**
- `src/services/reddit/routes/redditOcrRoutes.js`
- `src/services/reddit/controllers/redditOcrController.js`
- `src/services/reddit/ocr/repository.js`
- `src/services/reddit/ocr/services/getImageUrlService.js`
- `src/services/reddit/ocr/services/updateImageOcrService.js`
- `src/services/reddit/ocr/ocrocbreddit-manifest.md` (this file)

No shared files were modified — `resolveMediaUrl` already existed (added during the
native migration). The module loads clean and the router mounts 2 routes.

---

## 8. Quick end-to-end check

```bash
# 1. lease (OCR queue)
curl "http://localhost:3000/api/v1/reddit/ocr/getImageUrl?status=4"

# 2. report
curl --location "http://localhost:3000/api/v1/reddit/ocr/updateImageDetails" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 112526, "status": 4, "object": "shoe", "celebrity": "Messi||Ronaldo", "brand_logo": "", "ocr": "Buy now" }'
```
```sql
-- 3. verify
SELECT reddit_ad_id, image_object, image_celebrity, image_ocr, image_url_status, ocr_updated_date
FROM pasdev_reddit.reddit_ad_variants WHERE reddit_ad_id = 112526;
```
