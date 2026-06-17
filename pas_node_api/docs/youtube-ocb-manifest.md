# OCB YouTube — Migration Manifest

Migration of two PHP endpoints from `api_youtube` (Laravel `VideoURLController`) into
`pas_node_api` (Express). Together they power the **YouTube image OCB pipeline**: an
external scraper leases image ads, runs **OCB** (Object / Celebrity / Brand-logo)
detection, and writes the results back to MySQL and Elasticsearch.

> YouTube is **OCB-only** — there is no OCR lease (YouTube does not appear in the OCR
> queue list). The report endpoint still carries the PHP's `status=4` (OCR) branch for
> fidelity, but the live pipeline only uses `status=1` (OCB).

- **Source (PHP):** `api_youtube/app/Modules/User` (`VideoURLController`, `YoutubeAdOcb`, `YoutubeAdVariants`)
- **Target (Node):** `pas_node_api/src/services/youtube`
- **Status:** complete & verified (module loads clean, routes mount, schema + lease query
  + ES index verified against live `pasdev_youtube` + `youtube_ads_data`).

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/youtube`.

| Method | URL | PHP origin | Purpose |
| ------ | --- | ---------- | ------- |
| `GET`  | `/api/v1/youtube/ocr/get-ocb-url` | `VideoURLController@getOcbUrl` | Lease a batch of ads queued for OCB |
| `POST` | `/api/v1/youtube/ocr/insert-update-ocb` | `VideoURLController@insertUpdateOcb` | Persist OCB results back to MySQL + ES |

Neither endpoint requires auth (faithful to the PHP). **Every response is HTTP `200`;
the real outcome is in the body `code` field.** Bodies follow the PHP
`helper::buildResponse` shape — note the key is **`messages`** (plural) on the lease /
validation / error paths, while the report returns `{ code, message }` (singular).

### 1.1 `GET get-ocb-url` — lease work

Hands out up to **20** OCB-pending ads (`ocb_url_status = 0`), resolves the URL, and
marks them `ocb_url_status = 1` so the next call does not hand out the same ads.

**Input** — `type` (query string; also accepted in body):

| `type` | Queue | Source column | URL resolved? |
| ------ | ----- | ------------- | ------------- |
| `1`    | **image** OCB (IMAGE / DISPLAY ads) | `video_url` → `image_url` | yes (NAS base) |

> Only `type=1` (image OCB) is supported. The PHP `getOcbUrl` also had a `type=2` (video)
> branch, but no scraper uses it, so it was dropped — any other `type` → `code 404`.

**Responses** (HTTP 200, outcome in `code`):

```json
{
  "code": 200,
  "messages": "Success",
  "data": [
    { "ad_id": 295834, "image_url": "https://media.globussoft.com/pas-dev/stream/yt/adImage/202606/abc.webp" }
  ]
}
```
- `code 400` `messages: "No data found"` — queue empty.
- `code 404` `messages: "Missing Parameter"` — invalid/absent `type`.
- `code 500` — unexpected error.

### 1.2 `POST insert-update-ocb` — report results

Upserts the OCB result into `youtube_ad_ocb`, flips
`youtube_ad_variants.ocb_url_status`, and patches the `youtube_ads_data` ES document.

**Body:**

| Field        | Required | Notes |
| ------------ | -------- | ----- |
| `ad_id`      | **yes**  | `youtube_ad_id` (also the ES `_id` in `youtube_ads_data`) |
| `status`     | **yes**  | `1` = OCB done (primary) · `4` = OCR done |
| `object`     | status 1 | `||`-delimited, nullable |
| `celebrity`  | status 1 | `||`-delimited, nullable |
| `brand_logo` | status 1 | `||`-delimited, nullable |
| `ocr`        | status 4 | `||`-delimited, nullable |

**Responses** (HTTP 200, outcome in `code`):
- `code 200` `message: "Image Data Updated Successfully"`
- `code 400` `message: "Image Data is already updated"` — the upsert changed nothing.
- `code 400` `message: "Image Object not updated"` — ES update was a no-op.
- `code 404` `messages: "Missing Parameter"` — `status`/`ad_id` missing (validation).
- `code 500` `messages: "DB Exception"` — unexpected error.

---

## 2. Status lifecycle (`ocb_url_status` on `youtube_ad_variants`)

```
 0  pending OCB            ← queued
 1  leased / OCB done      ← getOcbUrl marks leased rows = 1; report also sets 1 (OCB) / 4 (OCR)
 4  OCR done               (report status=4)
```

> ⚠️ YouTube marks a leased ad `ocb_url_status = 1` **on lease** (Facebook/GDN use `2`).
> Faithful to `getOcbUrl`, which sets `data["ocb_url_status"] = 1`.

---

## 3. Behaviour detail (faithful to PHP) — **YouTube differences**

### On lease (`getOcbUrl` → `YoutubeAdVariants::getImageUrl`)
- `type=1` joins `youtube_ad`, filters `type IN ('IMAGE','DISPLAY')`, `video_url IS NOT NULL`,
  `ocb_url_status = 0`, newest first, `LIMIT 20`; resolves `video_url`→`image_url` to absolute.
- A bulk `UPDATE` flips the leased `ad_id`s to `ocb_url_status = 1`.
- Any `type` other than `1` → `code 404` (the legacy `type=2` video lease was dropped).

### On report (`insertUpdateOcb` → `YoutubeAdOcb::insertUpdateOcb`)
Two tables, then ES:
1. **`youtube_ad_ocb` UPSERT** (keyed by `youtube_ad_id`) — insert if absent, else update:
   - `status=1`: `object`, `brand_logo`, `celebrity`, `object_update_date = now()`.
   - `status=4`: `ocr`, `ocr_update_date = now()`.
2. **`youtube_ad_variants`** `ocb_url_status = status` (runs regardless of the upsert result).
3. **Elasticsearch `youtube_ads_data`** — updated **directly by `_id` (= ad_id)**, no search:

| ES field | When | Value |
| -------- | ---- | ----- |
| `image_object`    | status 1 | `object` split on `||` → **array** |
| `image_celebrity` | status 1 | `celebrity` split on `||` → array |
| `image_brand`     | status 1 | `brand_logo` split on `||` → array (note: `image_brand`, **not** image_brand_logo) |
| `image_ocr`       | status 4 | `ocr` split on `||` → array |

   - `detect_noop: false`. **No** language (`_ru`/`_fr`/`_sp`/`_exactly`) families.
   - status 1 and status 4 are **mutually exclusive** — only the matching family is written.

> ⚠️ The upsert flag drives the response: if `youtube_ad_ocb` already held identical
> values (update affected 0 rows) → `code 400 "Image Data is already updated"` and ES is
> skipped. Otherwise ES is patched; `result == "updated"` → 200, else 400.

---

## 4. File layout

```
src/services/youtube/
├── routes/
│   └── youtubeOcrRoutes.js                # GET get-ocb-url, POST insert-update-ocb
├── controllers/
│   └── youtubeOcrController.js            # thin HTTP layer + buildResponse (validation, status codes)
└── ocr/
    ├── repository.js                      # raw parameterized SQL (function-per-op, takes exec=db.sql)
    └── services/
        ├── getOcbUrlService.js            # type-driven lease + URL resolution
        └── insertUpdateOcbService.js      # youtube_ad_ocb upsert + variant flip + ES-by-_id
```

Layering mirrors the existing **gdn/youtube landers** modules:
**routes → controller → service → repository.** No existing route, controller,
repository, or shared file behaviour was altered (changes are additive only).

---

## 5. Image URL resolution (via nasClient)

`type=1` `image_url` values are resolved through the shared `resolveMediaUrl` helper on
`src/insertion/helpers/nasClient.js` using `config.insertion.nas.mediaUrl`. (The helper
was added during the Facebook OCR migration and is **reused unchanged** here.) YouTube
does **not** split on `||` before resolving (faithful to `getOcbUrl`).

```
/pas-dev/stream/yt/adImage/202606/abc.webp
   → https://media.globussoft.com/pas-dev/stream/yt/adImage/202606/abc.webp
```

---

## 6. Data touched

- **MySQL** (`youtube` pool, db `pasdev_youtube`):
  - `youtube_ad_variants` → lease read + `ocb_url_status` update (keyed by `youtube_ad_id`).
  - `youtube_ad` → join only (`type` filter).
  - `youtube_ad_ocb` → upsert (keyed by `youtube_ad_id`).
- **Elasticsearch** (`youtube` connection → index `youtube_ads_data`): `update` by `_id`.

---

## 7. Testing

End-to-end check (server on :3000):
```bash
# 1. lease image OCB queue
curl "http://localhost:3000/api/v1/youtube/ocr/get-ocb-url?type=1"

# 2. report OCB (status 1)
curl --location "http://localhost:3000/api/v1/youtube/ocr/insert-update-ocb" \
  --header "Content-Type: application/json" \
  --data '{ "ad_id": 295834, "status": 1, "object": "shoe||bottle", "celebrity": "", "brand_logo": "Nike", "ocr": "" }'
```

Verify in Elasticsearch (`youtube_ads_data`, by `_id`):
```
GET youtube_ads_data/_doc/295834
```
Expect `image_object` / `image_celebrity` / `image_brand` as `||`-split **arrays**.

```sql
-- MySQL
SELECT youtube_ad_id, object, brand_logo, celebrity, object_update_date FROM pasdev_youtube.youtube_ad_ocb WHERE youtube_ad_id = 295834;
SELECT youtube_ad_id, ocb_url_status FROM pasdev_youtube.youtube_ad_variants WHERE youtube_ad_id = 295834;
```

---

## 8. Files changed in this migration

**Added**
- `src/services/youtube/routes/youtubeOcrRoutes.js`
- `src/services/youtube/controllers/youtubeOcrController.js`
- `src/services/youtube/ocr/repository.js`
- `src/services/youtube/ocr/services/getOcbUrlService.js`
- `src/services/youtube/ocr/services/insertUpdateOcbService.js`
- `docs/youtube-ocb-manifest.md` (this file)
- Swagger: `YouTube OCB` tag + the two paths in `swagger.yml`.

**Reused (no change)**
- `src/insertion/helpers/nasClient.js` → `resolveMediaUrl` (added during Facebook OCR).

---

## 9. Quick diff: YouTube vs Facebook / GDN

| Aspect | Facebook | GDN | YouTube |
| ------ | -------- | --- | ------- |
| Lease driver | `status` (0/4) | `status` (0/4) | **`type=1`** (image), OCB-only |
| Lease marks status | 2 | 2 | **1** |
| Result table | `facebook_ad_variants` | `gdn_ad_variants` | **`youtube_ad_ocb`** (upsert) + status on `youtube_ad_variants` |
| ES locate | search `facebook_ad.id` | search `gdn_ad.id` | **direct by `_id`** (= ad_id) |
| ES value | `||`-split array | normalized `||` string | `||`-split **array** |
| ES brand field | `image_brand_logo` | `image_brand_logo` | **`image_brand`** |
| ES language families | yes (`_ru/_fr/_sp/_exactly`) | yes | **none** |
| ES index | `search_mix` | `gdn_search_mix` | `youtube_ads_data` |
| Body shape | `{code,message,data}` | `{code,message,data}` | PHP buildResponse (`messages`/`data`) |
