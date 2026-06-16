# OCR / OCB Facebook — Migration Manifest

Migration of two PHP endpoints from `api` (Laravel `Userv2Controller`) into
`pas_node_api` (Express). Together they power the **Facebook image OCR/OCB pipeline**:
an external scraper leases image ads, runs **OCB** (Object / Celebrity / Brand-logo)
and **OCR** (text-in-image) detection, and writes the results back to MySQL and
Elasticsearch.

- **Source (PHP):** `api/app/Modules/User` (`Userv2Controller`)
- **Target (Node):** `pas_node_api/src/services/facebook`
- **Status:** complete & verified (module loads clean, routes mount, schema + lease
  query + ES fields verified against live `pasdev_facebook` + `search_mix`).

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/facebook` (every `*.js` in the
service's `routes/` folder is discovered and mounted automatically).

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/facebook/ocr/getFBImageUrl` | `Userv2Controller@getImageUrl` (`Route::get('getFBImageUrl', ...)`) | Lease a batch of image ads queued for processing |
| `POST` | `/api/v1/facebook/ocr/update-image-info` | `Userv2Controller@updateImageOcrDetails` (`Route::post('update-image-info', ...)`) | Persist OCR/OCB results back to MySQL + ES |

Neither endpoint requires auth (faithful to the PHP, which had these outside the
`jwt.auth` group). **Every response is HTTP `200`; the real outcome is in the body
`code` field** — this preserves the PHP contract so existing scraper clients keep
working unchanged.

### 1.1 `GET getFBImageUrl` — lease work

Hands out up to **20** `IMAGE`-type ads queued for processing, resolves each
`image_url` to an absolute URL, and marks them in-progress (`image_url_status = 2`)
so the next call does not hand out the same ads. The legacy `field` query param is
accepted but ignored (the queue is driven purely by `status`).

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
    { "ad_id": 130931, "image_url": "https://media.globussoft.com/pas-dev/stream/fb/adImage/202606/101886.jpg" }
  ],
  "exe_time": 0.01
}
```
- `code 400` `"No More Image are present"` — queue empty.
- `code 400` validation message — `status` missing.
- `code 401` `"No More Image are present"` — unexpected error (PHP parity).

### 1.2 `POST update-image-info` — report results

Persists scraper output into MySQL (`facebook_ad_variants`) and mirrors it into
Elasticsearch (`search_mix`).

**Body:**

| Field        | Required | Notes |
| ------------ | -------- | ----- |
| `ad_id`      | **yes**  | internal `facebook_ad.id` |
| `status`     | no       | `1` = OCB done · `4` = OCR done · `2` = re-queue/partial |
| `object`     | no       | `"a||b||c"` (`||`-delimited), nullable |
| `celebrity`  | no       | `||`-delimited, nullable |
| `brand_logo` | no       | `||`-delimited, nullable |
| `ocr`        | no       | `||`-delimited; **if omitted, the existing `image_ocr` is kept** |

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `"Image Data Updated Successfully"`
- `code 400` `"Please enter valid ad_id"` — no variant row for that `ad_id`.
- `code 400` `"ad not found"` — variant updated, but no ES document matched / ES no-op.
- `code 400` `"Ad not found"` — MySQL update affected no row.
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

### On lease (`getImageUrl` → `Facebook_ad_variants::getImageUrlFBs`)
- Query joins `facebook_ad` and filters `facebook_ad.type = 'IMAGE'`,
  `image_url_status = <0|4>`, **`facebook_ad.last_seen` within the last 10 days**,
  newest first, `LIMIT 20`.
- For `status 4` the `image_ocr` column is also selected.
- Each returned ad's `image_url` is resolved to absolute (see §5).
- A single bulk `UPDATE` flips all returned `ad_id`s to `image_url_status = 2`.

### On report (`updateImageOcrDetails`)
Writes happen **MySQL first, then Elasticsearch** (independent).

MySQL columns written on `facebook_ad_variants` (keyed by `facebook_ad_id`):

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
> values, or they will be wiped. Matches PHP `isset(...) ? value : null`.

> ⚠️ The `status 2` null-check (`3 if any column null else 1`) inspects **every** column of
> the row as it was *before* this update. Inherited from PHP's `in_array(null, $row)`.

Elasticsearch (`search_mix`):
- Locate the doc by `match facebook_ad.id = ad_id` (else `code 400 "ad not found"`).
- Each field split on `||` into an **array**; write the full multilingual field family
  (`_ru` / `_fr` / `_sp` / `_exactly`) for object/celebrity/brand. The `image_ocr*`
  family is added **only when `status = 4`**.
- Update with `detect_noop: false`.
- SQL write and ES write are **independent** — a successful SQL update followed by a
  missing ES doc still returns `code 400 "ad not found"` (intentional PHP parity).

---

## 4. File layout

```
src/services/facebook/
├── routes/
│   └── facebookOcrRoutes.js          # GET getFBImageUrl, POST update-image-info
├── controllers/
│   └── facebookOcrController.js      # thin HTTP layer (validation, status codes)
└── ocr/
    ├── repository.js                 # raw parameterized SQL (function-per-op, takes exec=db.sql)
    └── services/
        ├── getImageUrlService.js     # lease logic + URL resolution
        └── updateImageOcrService.js  # MySQL + Elasticsearch write logic
```

Layering mirrors the existing **facebook/gdn landers** modules:
**routes → controller → service → repository.** Data access is a single
`repository.js` of plain functions, each taking `exec` (the `db.sql` pool wrapper)
as its first arg — no per-table model class; the service passes `db.sql` / `db.elastic`
in. No existing route, controller, repository, or shared file behaviour was altered
(changes are additive only — see §5/§8).

---

## 5. Image URL resolution (via nasClient — no AWS_URL/API_URL)

Relative `image_url` values are resolved to absolute URLs through the shared NAS helper
**`src/insertion/helpers/nasClient.js`**, using the **same base the files were uploaded
to**: `config.insertion.nas.mediaUrl` (config.json → env `NAS_MEDIA_URL`,
e.g. `https://media.globussoft.com`).

The additive export on nasClient (also reused by GDN OCR):

```js
// src/insertion/helpers/nasClient.js
function resolveMediaUrl(storedPath) {
  if (!storedPath) return storedPath;
  if (/^https?:\/\//i.test(storedPath)) return storedPath;  // already absolute → untouched
  const base = config.insertion.nas.mediaUrl;
  if (!base) return storedPath;
  return joinUrl(base, storedPath);                          // reuses existing helper
}
module.exports = { storeInNas, resolveMediaUrl, DEFAULT_IMAGE, TYPE_SUBFOLDER };
```
- Purely additive: `storeInNas` / `DEFAULT_IMAGE` / `TYPE_SUBFOLDER` are unchanged; all
  existing consumers (FB/IG/native insertion, landers, etc.) are unaffected.

Resolution rule applied per stored value (in `getImageUrlService.js`):
1. take the segment before the first `||` (multi-image variants);
2. if it is already absolute (`http`/`https`) → leave untouched;
3. else join onto the NAS media base.

```
/pas-dev/stream/fb/adImage/202606/101886.jpg
   → https://media.globussoft.com/pas-dev/stream/fb/adImage/202606/101886.jpg
https://cdn.x.com/a.jpg
   → https://cdn.x.com/a.jpg          (unchanged)
```

> Note: this collapses the PHP's two bases (`AWS_URL` for normal paths, `API_URL` for
> `/image/` paths) into the single NAS media base.

---

## 6. Data touched

- **MySQL** (`facebook` pool, db `pasdev_facebook`):
  - `facebook_ad_variants` → read + update (keyed by `facebook_ad_id`).
  - `facebook_ad` → join only (`type = 'IMAGE'`, `last_seen` window).
- **Elasticsearch** (`facebook` connection → index `search_mix`): `search` + `update`.

---

## 7. Testing

End-to-end check (server on :3000):
```bash
# 1. lease (OCB queue)
curl "http://localhost:3000/api/v1/facebook/ocr/getFBImageUrl?status=0"

# 2. report OCB (status 1)
curl --location "http://localhost:3000/api/v1/facebook/ocr/update-image-info" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 130931, "status": 1, "object": "shoe||bottle", "celebrity": "", "brand_logo": "Nike" }'

# 3. report OCR (status 4 — re-send object/celebrity/brand so they aren't wiped)
curl --location "http://localhost:3000/api/v1/facebook/ocr/update-image-info" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 130955, "status": 4, "object": "shoe", "celebrity": "", "brand_logo": "Nike", "ocr": "Buy now||Limited offer" }'
```

Verify in Elasticsearch (`search_mix`, matched by `facebook_ad.id`):
```
GET search_mix/_search
{ "size": 1, "_source": "facebook_ad_variants.image_ocr*",
  "query": { "match": { "facebook_ad.id": 130955 } } }
```
Expect `image_ocr` (+ `_ru/_fr/_sp/_exactly`) as a `||`-split **array**, e.g.
`["Buy now","Limited offer"]`. On `status=1` (OCB) the `image_ocr*` family is untouched.

```sql
-- MySQL
SELECT facebook_ad_id, image_ocr, image_url_status, object_update_date, ocr_updated_date
FROM pasdev_facebook.facebook_ad_variants WHERE facebook_ad_id = 130955;
```

---

## 8. Files changed in this migration

**Added**
- `src/services/facebook/routes/facebookOcrRoutes.js`
- `src/services/facebook/controllers/facebookOcrController.js`
- `src/services/facebook/ocr/repository.js`
- `src/services/facebook/ocr/services/getImageUrlService.js`
- `src/services/facebook/ocr/services/updateImageOcrService.js`
- `docs/facebook-ocr-manifest.md` (this file)
- Swagger: `Facebook OCR` tag + the two paths in `swagger.yml`.

**Modified (additive / non-breaking)**
- `src/insertion/helpers/nasClient.js` → added `resolveMediaUrl` export.
- `swagger.yml` → also fixed two pre-existing flow-style Reddit-lander descriptions
  that broke YAML parsing (quoted the `{...}` values).
