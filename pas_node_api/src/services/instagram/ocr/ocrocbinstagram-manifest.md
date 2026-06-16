# OCR / OCB Instagram — Migration Manifest

Migration of two PHP endpoints from `api_instagram` (Laravel `AdDetails`
controller) into `pas_node_api` (Express). Together they power the **Instagram
image OCR/OCB pipeline**: an external scraper leases image ads, runs **OCB**
(Object / Celebrity / Brand-logo) and **OCR** (text-in-image) detection, and
writes the results back to MySQL and Elasticsearch.

- **Source (PHP):** `api_instagram/app/Modules/InstagramUser` (`AdDetails`, model `Instagram_ad_variants`)
- **Target (Node):** `pas_node_api/src/services/instagram/ocr`
- **Status:** complete & verified (modules load clean, routes build).

Modeled on the existing **native** OCR/OCB migration
(`src/services/native/ocr/`) — same routes → controller → service → repository
layering. Only the differences faithful to the *Instagram* PHP are called out below.

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/instagram` (every `*.js` in the
service's `routes/` folder is discovered and mounted automatically — the route
file exports a plain `createInstagramOcrRoutes(service)` function).

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/instagram/ocr/getImageUrl` | `AdDetails@getImageUrls` (`Route::get('getImageUrl', ...)`) | Lease a batch of image ads queued for processing |
| `POST` | `/api/v1/instagram/ocr/updateImageDetails` | `AdDetails@updateImageDetails` (`Route::post('updateImageDetails', ...)`) | Persist OCR/OCB results back to MySQL + ES |

Neither endpoint requires auth (faithful to the PHP — both sit outside the
`jwt.auth` group). **Every response is HTTP `200`; the real outcome is in the body
`code` field** — this preserves the PHP contract so existing scraper clients keep
working unchanged.

### 1.1 `GET getImageUrl` — lease work

Hands out up to **20** `IMAGE`/`STORIES`-type ads queued for processing (last seen
within the trailing 10 days), resolves each `image_url` to an absolute URL, and
marks them in-progress (`image_url_status = 2`) so the next call does not hand out
the same ads.

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
    { "ad_id": 112526, "image_url": "https://media.globussoft.com/insta/adImage/202606/....jpg" }
  ]
}
```
- `code 400` `"No More Image are present"` — queue empty.
- `code 400` `["The status field is required."]` — `status` missing.
- `code 401` `"No More Image are present"` — unexpected error (PHP parity).

### 1.2 `POST updateImageDetails` — report results

Persists scraper output into MySQL (`instagram_ad_variants`) and mirrors it into
Elasticsearch (`instagram_search_mix`).

**Body:**

| Field        | Required | Notes |
| ------------ | -------- | ----- |
| `ad_id`      | **yes**  | internal `instagram_ad.id` |
| `status`     | no       | `1` = OCB done · `4` = OCR done · other → `image_url_status` reset to `0` |
| `object`     | no       | `||`-delimited, nullable |
| `celebrity`  | no       | `||`-delimited, nullable |
| `brand_logo` | no       | `||`-delimited, nullable |
| `ocr`        | no       | `||`-delimited; **if omitted, the existing `image_ocr` is kept** |

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `" Image Data Updated Successfully"` (leading space is faithful to PHP).
- `code 400` `"Some Error occurred"` — no variant row for that `ad_id` (or `ad_id` missing).
- `code 400` `"ad not found"` — variant updated, but no ES document matched / ES update no-op.
- `code 401` `"Image Object not updated"` — unexpected error.

---

## 2. Status lifecycle (`image_url_status`)

```
 0  pending OCB (object/celebrity/brand)  ← queued / also the "other status" reset value
 4  pending OCR (text)                     ←
 2  leased / in progress (handed to scraper)
 1  complete / done (OCB report)
```

Asymmetry to remember: OCB is **leased** with `status 0` but **reported done** with
`status 1`; OCR uses `4` on both sides. Unlike the native flow, the Instagram PHP
has **no `status 2 → 3` partial branch** — any report `status` other than `1`/`4`
simply resets `image_url_status` to `0`.

---

## 3. Behaviour detail (faithful to PHP)

### On lease (`getImageUrls`)
- Query joins `instagram_ad` and filters `instagram_ad.type IN ('IMAGE','STORIES')`,
  `image_url_status = <0|4>`, `instagram_ad.last_seen` within the trailing 10 days,
  newest first, `LIMIT 20`.
- For `status 4` the `image_ocr` column is also selected.
- Each returned ad's `image_url` is resolved to absolute (see §5).
- A single bulk `UPDATE` flips all returned `ad_id`s to `image_url_status = 2`.

> ⚠️ The original PHP model query used a malformed `orWhere([['type','=','STORIES'],
> ['type','=','IMAGE']])` (two equality predicates on the same column, OR'd against
> the status filter). The Node port implements the **intent** — status filter **AND**
> `type IN ('IMAGE','STORIES')` **AND** the 10-day `last_seen` window — as a
> well-formed query.

### On report (`updateImageDetails`)

Field encoding (applied to `object` / `celebrity` / `brand_logo` / `ocr`):
1. delimiter-normalize: `||,` and `||` → `|` (order-preserving);
2. if the result contains `|` → store `JSON.stringify(value.split('|'))` (a JSON
   **array string**, e.g. `'["a","b"]'`);
3. else → the scalar value, or `null` when empty.

> ⚠️ Unlike the native migration (which wrote real arrays to ES), the **live**
> Instagram PHP writes this *same encoded value* (JSON string / scalar / null) to
> **both** MySQL and **every** ES field — the array-valued ES branch is commented
> out in the source. The Node port preserves that exact behaviour so the existing
> `instagram_search_mix` data contract is unchanged.

MySQL columns written on `instagram_ad_variants` (keyed by `instagram_ad_id`):

| Column | When written | Driven by |
| ------ | ------------ | --------- |
| `image_object`            | always (overwrite) | encoded `object` (or NULL) |
| `image_celebrity`         | always (overwrite) | encoded `celebrity` (or NULL) |
| `image_brand_logo`        | always (overwrite) | encoded `brand_logo` (or NULL) |
| `image_ocr`               | overwrite if a new value is sent; kept if omitted | encoded `ocr` |
| `image_text_final_status` | only if it was `0`/null → set to raw `status` | `status` |
| `image_url_status`        | always | `1`/`4` → `status`; anything else → `0` |
| `object_update_date`      | only when `status = 1` | timestamp |
| `ocr_updated_date`        | only when `status = 4` | timestamp |

> ⚠️ **Overwrite, not append.** `object`/`celebrity`/`brand_logo` are replaced on
> every call — omitting one sets it to `NULL`. `ocr` is the exception (the existing
> `image_ocr` is kept if non-null). The OCR pass (`status 4`) should therefore
> **re-send** the existing object/celebrity/brand values, or they will be wiped.

Elasticsearch (`instagram_search_mix`):
- Locate the doc by `match instagram_ad.id = ad_id` (else `code 400 "ad not found"`).
- Write the full multilingual field family (`_ru` / `_fr` / `_sp` / `_exactly`) for
  object/celebrity/brand. The `image_ocr*` family is added **only when `status = 4`**.
- Update with `detect_noop: false`.
- SQL write and ES write are **independent** — a successful SQL update followed by a
  missing ES doc still returns `code 400 "ad not found"` (intentional PHP parity).

---

## 4. File layout

```
src/services/instagram/
├── routes/
│   └── instagramOcrRoutes.js            # GET getImageUrl, POST updateImageDetails
├── controllers/
│   └── instagramOcrController.js        # thin HTTP layer (validation, status codes)
└── ocr/
    ├── repository.js                    # raw parameterized SQL (function-per-op, takes exec=db.sql)
    ├── services/
    │   ├── getImageUrlService.js        # lease logic + URL resolution
    │   └── updateImageDetailsService.js # MySQL + Elasticsearch write logic
    └── ocrocbinstagram-manifest.md      # this file
```

Layering mirrors the **native** OCR module exactly: **routes → controller →
service → repository.** Data access is a single `repository.js` of plain functions,
each taking `exec` (the `db.sql` pool wrapper) as its first arg — no per-table model
class, and the repository never imports `DatabaseManager` itself (the service passes
`db.sql` / `db.elastic` in). No existing route, controller, repository, or shared
file was altered — all changes are **additive**.

---

## 5. Image URL resolution (via nasClient)

Relative `image_url` values are resolved to absolute URLs through the shared NAS
helper **`src/insertion/helpers/nasClient.js`** (`resolveMediaUrl`), using the same
base the files were uploaded to: `config.insertion.nas.mediaUrl`
(env `NAS_MEDIA_URL`, e.g. `https://media.globussoft.com`).

Resolution rule applied per stored value:
1. take the segment before the first `||` (multi-image variants);
2. if it is already absolute (`http`/`https`) → leave untouched;
3. else join onto the NAS media base.

> Note: this collapses the PHP's two bases (env `AWS_URL` for normal paths,
> env `API_URL` for `/image/` paths) into the single NAS media base — the same
> approach the native OCR migration took. No new config keys were introduced;
> `resolveMediaUrl` already existed (added by the native migration).

---

## 6. Data touched

- **MySQL** (`instagram` pool, db `pasdev_instagram` / `instagram_sql`):
  - `instagram_ad_variants` → read + update (keyed by `instagram_ad_id`).
  - `instagram_ad` → join only (`type IN ('IMAGE','STORIES')`, `last_seen` window).
- **Elasticsearch** (`instagram` connection → index `instagram_search_mix`): `search` + `update`.

---

## 7. Quick test

```bash
# 1. lease (OCR queue)
curl "http://localhost:3000/api/v1/instagram/ocr/getImageUrl?status=4"

# 2. report (re-send object/celebrity/brand so they aren't wiped)
curl --location "http://localhost:3000/api/v1/instagram/ocr/updateImageDetails" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 112526, "status": 4, "object": "", "celebrity": "", "brand_logo": "", "ocr": "Buy now||Limited offer" }'
```
```sql
-- 3. verify
SELECT instagram_ad_id, image_ocr, image_url_status, ocr_updated_date
FROM pasdev_instagram.instagram_ad_variants WHERE instagram_ad_id = 112526;
```

---

## 8. Files changed in this migration

**Added (all additive — nothing else touched)**
- `src/services/instagram/routes/instagramOcrRoutes.js`
- `src/services/instagram/controllers/instagramOcrController.js`
- `src/services/instagram/ocr/repository.js`
- `src/services/instagram/ocr/services/getImageUrlService.js`
- `src/services/instagram/ocr/services/updateImageDetailsService.js`
- `src/services/instagram/ocr/ocrocbinstagram-manifest.md` (this file)

**Modified:** none. Reuses the existing `nasClient.resolveMediaUrl` export added by
the native OCR migration.
