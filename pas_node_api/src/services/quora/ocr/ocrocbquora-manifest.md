# OCR / OCB Quora — Migration Manifest

Migration of two PHP endpoints from `api_quora` (Laravel `UserController`) into
`pas_node_api` (Express). Together they power the **quora image OCR/OCB pipeline**:
an external scraper leases image ads, runs **OCB** (Object / Celebrity / Brand-logo)
and **OCR** (text-in-image) detection, and writes the results back to MySQL and
Elasticsearch.

- **Source (PHP):** `api_quora/app/Modules/User`
- **Target (Node):** `pas_node_api/src/services/quora`
- **Status:** complete & verified (module loads clean, route creator returns a router).
- **Reference:** ported from the native equivalent (`src/services/native/ocr/`,
  `ocrocbnative-manifest.md`) — same layering, same behaviour, quora tables/index.

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/quora` (every `*.js` in the
service's `routes/` folder is discovered and mounted automatically). The route
file exports a creator function, which the registry invokes with the `service`
object (`{ db, log, ... }`).

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/quora/ocr/getQuoraImageUrl`   | `UserController@getImageUrls` (`Route::get('getQuoraImageUrl', ...)`) | Lease a batch of image ads queued for processing |
| `POST` | `/api/v1/quora/ocr/update-image-info`  | `UserController@updateImageOcrDetails` (`Route::post('update-image-info', ...)`) | Persist OCR/OCB results back to MySQL + ES |

Neither endpoint requires auth (faithful to the PHP, which had these outside the
`jwt.auth` group). **Every response is HTTP `200`; the real outcome is in the body
`code` field** — this preserves the PHP contract so existing scraper clients keep
working unchanged.

### 1.1 `GET getQuoraImageUrl` — lease work

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
  "data": [
    { "ad_id": 112526, "image_url": "https://media.globussoft.com/pasimages/quora/ads/....jpg" }
  ],
  "exe_time": 0.01
}
```
- `code 400` `"No More Image are present"` — queue empty.
- `code 400` validation message — `status` missing.
- `code 401` `"No More Image are present"` — unexpected error (PHP parity).

### 1.2 `POST update-image-info` — report results

Persists scraper output into MySQL (`quora_ad_variants`) and mirrors it into
Elasticsearch (`quora_search_mix`).

**Body:**

| Field        | Required | Notes |
| ------------ | -------- | ----- |
| `ad_id`      | **yes**  | internal `quora_ad.id` |
| `status`     | no       | `1` = OCB done · `4` = OCR done · `2` = re-queue/partial |
| `object`     | no       | `"a||b||c"` (`||`-delimited), nullable |
| `celebrity`  | no       | `||`-delimited, nullable |
| `brand_logo` | no       | `||`-delimited, nullable |
| `ocr`        | no       | `||`-delimited; **if omitted, the existing `image_ocr` is kept** |

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `"Image Data Updated Successfully"`
- `code 400` `"Please enter valid ad_id"` — no variant row for that `ad_id`.
- `code 400` `"ad not found"` — variant updated, but no ES document matched, **or** the
  ES update was a no-op. (Quora PHP parity: this branch returns `"ad not found"`,
  unlike native which returns `"Image Object not updated"`.)
- `code 401` `"Image Object not updated"` — unexpected error.

---

## 2. Status lifecycle (`image_url_status`)

```
 0  pending OCB (object/celebrity/brand)  ← queued
 4  pending OCR (text)                     ←
 2  leased / in progress (handed to scraper)
 3  partial — incomplete, needs another pass
 1  complete / done
```

Asymmetry to remember: OCB is **leased** with `status 0` but **reported done** with
`status 1`; OCR uses `4` on both sides.

---

## 3. Behaviour detail (faithful to PHP)

### On lease (`getImageUrls`)
- Query joins `quora_ad` and filters `quora_ad.type = 'IMAGE'`, `image_url_status = <0|4>`, newest first, `LIMIT 20`.
- For `status 4` the `image_ocr` column is also selected.
- Each returned ad's `image_url` is resolved to absolute (see §5).
- A single bulk `UPDATE` flips all returned `ad_id`s to `image_url_status = 2`.

### On report (`updateImageOcrDetails`)
MySQL columns written on `quora_ad_variants` (keyed by `quora_ad_id`):

| Column | When written | Driven by |
| ------ | ------------ | --------- |
| `image_object`            | always (overwrite) | body `object` (or NULL) |
| `image_celebrity`         | always (overwrite) | body `celebrity` (or NULL) |
| `image_brand_logo`        | always (overwrite) | body `brand_logo` (or NULL) |
| `image_ocr`               | overwrite if sent; kept if omitted | body `ocr` |
| `image_text_final_status` | only if it was `0` → set to `status` | `status` |
| `image_url_status`        | always | `status` (`1`/`4` → `status`; `2` → `3` if any column null else `1`) |
| `object_update_date`      | only when `status = 1` | timestamp |
| `ocr_updated_date`        | only when `status = 4` | timestamp |

> ⚠️ **Overwrite, not append.** `object`/`celebrity`/`brand_logo` are replaced on every
> call — omitting one sets it to `NULL`. `ocr` is the exception (kept if omitted). The
> OCR pass (`status 4`) should therefore **re-send** the existing object/celebrity/brand
> values, or they will be wiped. This matches the PHP `isset(...) ? value : null` logic.

> ⚠️ The `status 2` null-check (`3 if any column null else 1`) inspects **every** column of
> the row as it was *before* this update — not just OCR/OCB fields. Inherited from PHP's
> `in_array(null, $row)`.

Elasticsearch (`quora_search_mix`):
- Locate the doc by `match quora_ad.id = ad_id` (else `code 400 "ad not found"`).
- Each field split on `||` into an array; write the full multilingual field family
  (`_ru` / `_fr` / `_sp` / `_exactly`) for object/celebrity/brand. The `image_ocr*`
  family is added **only when `status = 4`**.
- Update with `detect_noop: false`.
- SQL write and ES write are **independent** — a successful SQL update followed by a
  missing ES doc still returns `code 400 "ad not found"` (intentional PHP parity).

---

## 4. File layout

```
src/services/quora/
├── routes/
│   └── quoraOcrRoutes.js             # GET getQuoraImageUrl, POST update-image-info
├── controllers/
│   └── quoraOcrController.js         # thin HTTP layer (validation, status codes)
└── ocr/
    ├── repository.js                 # raw parameterized SQL (function-per-op, takes exec=db.sql)
    ├── services/
    │   ├── getImageUrlService.js     # lease logic + URL resolution
    │   └── updateImageOcrService.js  # MySQL + Elasticsearch write logic
    └── ocrocbquora-manifest.md       # this file
```

Layering mirrors the existing **native ocr** module:
**routes → controller → service → repository.** Data access is a single
`repository.js` of plain functions, each taking `exec` (the `db.sql` pool wrapper)
as its first arg — no per-table model class, and the repository never imports
`DatabaseManager` itself (the service passes `db.sql` / `db.elastic` in). No existing
route, controller, repository, or shared file behaviour was altered (changes are
**additive only** — only new files were created).

---

## 5. Image URL resolution (via nasClient — no AWS_URL/API_URL)

Relative `image_url` values are resolved to absolute URLs through the shared NAS helper
**`src/insertion/helpers/nasClient.js`** `resolveMediaUrl`, using the **same base the
files were uploaded to**: `config.insertion.nas.mediaUrl` (config.json → env
`NAS_MEDIA_URL`, e.g. `https://media.globussoft.com`).

`resolveMediaUrl` already exists (it was added during the native migration); this
migration **reuses** it and changes nothing in `nasClient.js`.

Resolution rule applied per stored value:
1. take the segment before the first `||` (multi-image variants);
2. if it is already absolute (`http`/`https`) → leave untouched;
3. else join onto the NAS media base.

> Note: this collapses the PHP's two bases (`AWS_URL` for normal paths,
> `API_URL`/`API_URL_QUORA` for `/image/` paths) into the single NAS media base —
> same simplification as the native migration.

---

## 6. Data touched

- **MySQL** (`quora` pool, db `pasdev_quora`):
  - `quora_ad_variants` — read + update (keyed by `quora_ad_id`).
  - `quora_ad` — join only (`type = 'IMAGE'` filter).
- **Elasticsearch** (`quora` connection → index `quora_search_mix`): `search` + `update`.

---

## 7. Differences from the native module

Behaviour is otherwise identical; only these are quora-specific:

| Aspect | native | quora |
| ------ | ------ | ----- |
| Tables | `native_ad_variants`, `native_ad` | `quora_ad_variants`, `quora_ad` |
| ES index | `native_search_mix` | `quora_search_mix` |
| ES match field | `native_ad.id` | `quora_ad.id` |
| ES doc field prefix | `native_ad_variants.` | `quora_ad_variants.` |
| Lease route | `getNativeImageUrl` | `getQuoraImageUrl` |
| ES no-op branch | `code 400 "Image Object not updated"` | `code 400 "ad not found"` |

---

## 8. Files changed in this migration

**Added (all under `src/services/quora/`)**
- `routes/quoraOcrRoutes.js`
- `controllers/quoraOcrController.js`
- `ocr/repository.js` (function-per-op SQL)
- `ocr/services/getImageUrlService.js`
- `ocr/services/updateImageOcrService.js`
- `ocr/ocrocbquora-manifest.md` (this file)

**Modified:** none — `resolveMediaUrl` in `nasClient.js` already existed from the
native migration; this work is purely additive.

---

## 9. Manual test

```bash
# 1. lease (OCR queue)
curl "http://localhost:3000/api/v1/quora/ocr/getQuoraImageUrl?status=4"

# 2. report (re-send object/celebrity/brand so they aren't wiped)
curl --location "http://localhost:3000/api/v1/quora/ocr/update-image-info" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 112526, "status": 4, "object": "", "celebrity": "", "brand_logo": "", "ocr": "Buy now||Limited offer" }'
```
```sql
-- 3. verify
SELECT quora_ad_id, image_ocr, image_url_status, ocr_updated_date
FROM pasdev_quora.quora_ad_variants WHERE quora_ad_id = 112526;
```
