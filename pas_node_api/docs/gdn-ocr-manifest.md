# OCR / OCB GDN — Migration Manifest

Migration of two PHP endpoints from `api_gdn` (Laravel `ApiController`) into
`pas_node_api` (Express). Together they power the **GDN image OCR/OCB pipeline**:
an external scraper leases image ads, runs **OCB** (Object / Celebrity / Brand-logo)
and **OCR** (text-in-image) detection, and writes the results back to MySQL and
Elasticsearch.

- **Source (PHP):** `api_gdn/app/Modules/User` (`ApiController`)
- **Target (Node):** `pas_node_api/src/services/gdn`
- **Status:** complete & verified (module loads clean, routes mount, schema + lease
  query + ES fields verified against live `pasdev_gdn` + `gdn_search_mix`).

This mirrors the **Facebook OCR** migration (`docs/facebook-ocr-manifest.md`); only the
GDN-specific differences are called out below (§3 / §9).

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/gdn`.

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/gdn/ocr/getGDNImageUrl` | `ApiController@getImageUrl` (`Route::get('getGDNImageUrl', ...)`) | Lease a batch of image ads queued for processing |
| `POST` | `/api/v1/gdn/ocr/insert-GDN-imageUrl-data` | `ApiController@insertGDNImageData` (`Route::post('insert-GDN-imageUrl-data', ...)`) | Persist OCR/OCB results back to ES + MySQL |

Neither endpoint requires auth (faithful to the PHP). **Every response is HTTP `200`;
the real outcome is in the body `code` field.**

### 1.1 `GET getGDNImageUrl` — lease work

Hands out up to **20** `IMAGE`-type ads queued for processing, resolves each
`image_url` to an absolute URL, and marks them in-progress (`image_url_status = 2`).
Legacy `field` query param accepted but ignored.

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
    { "ad_id": 379113, "image_url": "https://media.globussoft.com/pas-dev/stream/gdn/adImage/202606/379113.jpg" }
  ],
  "exe_time": 0.01
}
```
- `code 400` `"No More Image are present"` — queue empty / `status` missing.
- `code 401` `"No More Image are present"` — unexpected error.

### 1.2 `POST insert-GDN-imageUrl-data` — report results

Patches Elasticsearch (`gdn_search_mix`) **first**, then — only if the ES update
succeeded — writes MySQL (`gdn_ad_variants`).

**Body:**

| Field        | Required | Notes |
| ------------ | -------- | ----- |
| `ad_id`      | **yes**  | internal `gdn_ad.id` |
| `status`     | no       | `1` = OCB done · `4` = OCR done |
| `object`     | no       | delimited (`||,` / `||` / `|`), normalized to `||` in ES |
| `celebrity`  | no       | delimited, normalized to `||` in ES |
| `brand_logo` | no       | delimited, normalized to `||` in ES |
| `ocr`        | no       | delimited; **if omitted, the existing `image_ocr` is kept** (MySQL) |

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `"Image Data Updated Successfully"`
- `code 400` `"gdn_ad_id not present in gdn_ad_variants table"` — no variant row.
- `code 400` `"Ad not found"` — no ES document matched.
- `code 400` `"ad not found"` — ES update was a no-op.
- `code 400` `"Some Error occurred"` — unexpected error.

---

## 2. Status lifecycle (`image_url_status`)

```
 0  pending OCB   ← queued        4  pending OCR   ←
 2  leased / in progress          1  complete / done
```

OCB is **leased** with `status 0` but **reported done** with `status 1`; OCR uses `4`
on both sides.

---

## 3. Behaviour detail (faithful to PHP) — **GDN differences vs Facebook**

### On lease (`getImageUrl` → `GdnAdVariants::getImagesUrl`)
- Joins `gdn_ad`, filters `gdn_ad.type = 'IMAGE'` + `image_url_status = <0|4>`,
  newest first, `LIMIT 20`.
- **No `last_seen` window** (Facebook filters the last 10 days; GDN does not).
- `status 4` also selects `image_ocr`.
- Bulk `UPDATE` flips the leased `ad_id`s to `image_url_status = 2`.

### On report (`insertGDNImageData`) — **ES first, then MySQL**
1. The variant row must exist (`gdn_ad_variants` keyed by `gdn_ad_id`), else
   `code 400 "gdn_ad_id not present in gdn_ad_variants table"`.
2. The ad must exist in **`gdn_search_mix`** (`match gdn_ad.id`), else `code 400 "Ad not found"`.
3. **ES update first.** Each field is normalized (see below) into a **`||`-joined STRING**
   (not an array, unlike Facebook) and written with the full multilingual family
   (`_ru` / `_fr` / `_sp` / `_exactly`) for object/celebrity/brand. The `image_ocr*`
   family is added **only when `status = 4`**. `detect_noop: false`.
   - If the ES update is not `"updated"` → `code 400 "ad not found"`, **MySQL is NOT written**.
4. **MySQL write** (`gdn_ad_variants`, only after a successful ES update):

| Column | When written | Driven by |
| ------ | ------------ | --------- |
| `image_object` / `image_celebrity` / `image_brand_logo` | always | **RAW body value** (kept if omitted) |
| `image_ocr`               | overwrite if sent; kept if omitted | RAW body `ocr` |
| `image_text_final_status` | only if it was `0` → set to `status` | `status` |
| `image_url_status`        | `1` if pre-update row already had object+celebrity+brand+ocr **all non-null**; else `status` (when 1 or 4) | pre-update row + `status` |
| `object_update_date`      | only when `status = 1` | timestamp |
| `ocr_updated_date`        | only when `status = 4` | timestamp |

> ⚠️ **MySQL stores RAW body values; ES stores NORMALIZED strings.** The PHP writes the
> un-normalized request value to MySQL but the `||`-normalized string to ES — replicated
> verbatim.

**Multi-delimiter normalization** (for the ES value): the input may delimit values with
`||,`, `||`, or `|`. The first matching delimiter wins; the value is split and re-joined
with `||`:
```
"a||,b"  → "a||b"
"a|b"    → "a||b"
"a||b"   → "a||b"   (unchanged)
"a"      → "a"      (single value)
```

> ⚠️ Unlike Facebook, there is **no `status 2 → 3` branch**; GDN only sets
> `image_url_status` to `1` (all four cols already present) or to `status` (1/4).

---

## 4. File layout

```
src/services/gdn/
├── routes/
│   └── gdnOcrRoutes.js                # GET getGDNImageUrl, POST insert-GDN-imageUrl-data
├── controllers/
│   └── gdnOcrController.js            # thin HTTP layer (validation, status codes)
└── ocr/
    ├── repository.js                  # raw parameterized SQL (function-per-op, takes exec=db.sql)
    └── services/
        ├── getImageUrlService.js      # lease logic + URL resolution
        └── updateImageOcrService.js   # ES-first then MySQL write logic
```

Layering mirrors the existing **gdn landers** module:
**routes → controller → service → repository.** No existing route, controller,
repository, or shared file behaviour was altered (changes are additive only).

---

## 5. Image URL resolution (via nasClient)

Identical to Facebook — relative `image_url` values are resolved through the shared
`resolveMediaUrl` helper on `src/insertion/helpers/nasClient.js` using
`config.insertion.nas.mediaUrl`. (The helper was added during the Facebook OCR
migration and is reused here unchanged.) Rule per stored value: take the segment before
the first `||`; if already absolute leave it; else join onto the NAS media base.

```
/pas-dev/stream/gdn/adImage/202606/379113.jpg
   → https://media.globussoft.com/pas-dev/stream/gdn/adImage/202606/379113.jpg
```

---

## 6. Data touched

- **MySQL** (`gdn` pool, db `pasdev_gdn`):
  - `gdn_ad_variants` → read + update (keyed by `gdn_ad_id`).
  - `gdn_ad` → join only (`type = 'IMAGE'`).
- **Elasticsearch** (`gdn` connection → index `gdn_search_mix`, dotted `gdn_ad.id`): `search` + `update`.

---

## 7. Testing

End-to-end check (server on :3000):
```bash
# 1. lease (OCB queue)
curl "http://localhost:3000/api/v1/gdn/ocr/getGDNImageUrl?status=0"

# 2. report OCB (status 1)
curl --location "http://localhost:3000/api/v1/gdn/ocr/insert-GDN-imageUrl-data" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 379113, "status": 1, "object": "shoe||bottle", "celebrity": "", "brand_logo": "Nike", "ocr": "" }'

# 3. report OCR (status 4 — re-send object/celebrity/brand so they aren't wiped)
curl --location "http://localhost:3000/api/v1/gdn/ocr/insert-GDN-imageUrl-data" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 379113, "status": 4, "object": "shoe", "celebrity": "", "brand_logo": "Nike", "ocr": "Buy now||Limited offer" }'
```

Verify in Elasticsearch (`gdn_search_mix`, matched by `gdn_ad.id`):
```
GET gdn_search_mix/_search
{ "size": 1, "_source": "gdn_ad_variants.image_ocr*",
  "query": { "match": { "gdn_ad.id": 379113 } } }
```
Expect `image_ocr` (+ `_ru/_fr/_sp/_exactly`) as a normalized `||`-joined **STRING**,
e.g. `"Buy now||Limited offer"`. On `status=1` (OCB) the `image_ocr*` family is untouched.

```sql
-- MySQL (stores the RAW body values)
SELECT gdn_ad_id, image_ocr, image_url_status, object_update_date, ocr_updated_date
FROM pasdev_gdn.gdn_ad_variants WHERE gdn_ad_id = 379113;
```

---

## 8. Files changed in this migration

**Added**
- `src/services/gdn/routes/gdnOcrRoutes.js`
- `src/services/gdn/controllers/gdnOcrController.js`
- `src/services/gdn/ocr/repository.js`
- `src/services/gdn/ocr/services/getImageUrlService.js`
- `src/services/gdn/ocr/services/updateImageOcrService.js`
- `docs/gdn-ocr-manifest.md` (this file)
- Swagger: `GDN OCR` tag + the two paths in `swagger.yml`.

**Reused (no change)**
- `src/insertion/helpers/nasClient.js` → `resolveMediaUrl` (added during Facebook OCR).

---

## 9. Quick diff: GDN vs Facebook OCR

| Aspect | Facebook | GDN |
| ------ | -------- | --- |
| Write order | MySQL first, then ES | **ES first, then MySQL** |
| ES value shape | `||`-split **array** | normalized `||`-joined **string** |
| Input delimiters | `||` only | `||,` / `||` / `|` (collapsed to `||`) |
| MySQL value | `||`-delimited body value | **RAW body value** (un-normalized) |
| Lease window | `last_seen` last 10 days | none |
| `image_url_status` | `1`/`4` → status; `2` → 3-if-null-else-1 | `1` if all 4 cols set, else `status` |
| ES index / match | `search_mix` / `facebook_ad.id` | `gdn_search_mix` / `gdn_ad.id` |
