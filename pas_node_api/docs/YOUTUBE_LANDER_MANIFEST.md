# YouTube Landers — Implementation Manifest

> Companion to `LANDER_MANIFEST.md` (Native), `FACEBOOK_LANDER_MANIFEST.md`, and
> `GOOGLE_LANDER_MANIFEST.md`. Documents the **YouTube** landers as built and
> live-verified in `pas_node_api` (service slug **`youtube`**). Same Facebook-style
> layout: single `repository.js`, services under `landers/`, NAS via `nasClient` directly.
>
> **Source of truth** = the YouTube PHP in `api_youtube`
> (`BlackhatControllerYoutube@getYoutubeAdsWithCounrty`, `@uploadBlackhatContent`,
> `@inserHtmlContentToDB`). Faithful port.
>
> **Status: DONE & verified** against live `pasdev_youtube` (MySQL) +
> `youtube_ads_data` (Elasticsearch).

---

## 0. Golden rules (as implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_youtube` (`youtube_ad_*` tables) = system of record; ES **`youtube_ads_data`** = the searchable projection (gate + write-back target).
3. **DatabaseManager singleton.** `service.db` (`db.sql`, `db.elastic`) injected by `ServiceRegistry` for slug `youtube`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` directly (status 1→BLACKHAT, 2→WHITEHAT). Distinct `_media`/`_zip` key bases so screenshot & zip don't collide.
5. **ES is FLAT, youtube-specific.** Doc **`_id` = youtube_ad_id** (verified), and there is also an `ad_id` field. The lander write-back uses youtube's own fields (see §5), NOT the `html_*_lander_text` fields.

---

## 1. Endpoints

Auto-mounted under `/api/v1/youtube` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP origin |
|--------|------|-----------|
| GET | `/api/v1/youtube/landers/get_youtubeid_for_lander` | `BlackhatControllerYoutube@getYoutubeAdsWithCounrty` |
| POST | `/api/v1/youtube/landers/upload_blackhat_image_zip` | `BlackhatControllerYoutube@uploadBlackhatContent` |
| POST | `/api/v1/youtube/landers/insert_html_content_lander` | `BlackhatControllerYoutube@inserHtmlContentToDB` |

---

## 2. Directory layout (actual — mirrors Facebook/Google)

```
src/
├── insertion/helpers/nasClient.js              ← shared NAS upload (storeInNas) — used directly
└── services/youtube/
    ├── routes/youtubeLandersRoutes.js          ← routes + multer (auto-mounted)
    ├── controllers/youtubeLandersController.js  ← thin
    └── landers/
        ├── repository.js                       ← all parameterized SQL (one fn per op)
        ├── transforms.js                       ← shared value transforms (pipeJoin, normalizeCountry, …)
        ├── validate.js                         ← insert validation rules
        ├── getAdsService.js                    ← get_youtubeid_for_lander
        ├── uploadService.js                    ← upload_blackhat_image_zip
        └── insertHtmlService.js                ← insert_html_content_lander (orchestrator)
```

> The string transforms (`pipeJoin`, `normalizeCountry`, `splitDbList`, `extractDomain`,
> `toUnixSeconds`, `esHits`) and the validator are factored out of `insertHtmlService`
> into `transforms.js` / `validate.js` (mirrors the insertion module's normalize/validate
> split), so the insert service stays a focused orchestrator.

---

## 3. Data flow

### GET `/landers/get_youtubeid_for_lander`
```
getAdsService.getYoutubeAdsWithCountry(db)
  ├─ repository.getDataForLander(0)          → ≤100 ads at redirect_status=0 with destination_url NOT NULL
  ├─ for each ad: ES search youtube_ads_data (match ad_id)
  │    ├─ present → resolve ISO (country_data.nicename → iso) + emit { id, iso, destination_url, ad_url }
  │    │           (NOTE: youtube does NOT flip status to 2 here)
  │    └─ absent  → repository.updateMeta(id, redirect_status=5)
  └─ Response: { code, data, exe_time }   ("urls over" when none)
```

### POST `/landers/upload_blackhat_image_zip`  (multipart: media, zip, ad_id, country, status)
```
uploadService.uploadBlackhatContent(req)
  ├─ multer temp files
  ├─ nasClient.storeInNas(folder, path, adId, 'youtube', `${adId}_${country}_${status}_${ts}_media|_zip`)
  ├─ unlink
  └─ Response: { code, message, image_path (screenshot), html_path (zip) }
```

### POST `/landers/insert_html_content_lander`  (JSON: `{ ad_id, insertData }`)
```
insertHtmlService.insertHtmlContent(req, db)
  ├─ ES check youtube_ads_data (match ad_id; use hit._id for the update) → else "ad not found"
  ├─ validate insertData (destinations & screen_shot required; others present|nullable)
  ├─ status=3 → flip redirect_status (3=.net / 5=python) and RETURN
  ├─ domain upsert (youtube_ad_domains) + dod_date + youtube_ad.domain_id
  ├─ country normalize, blackhat(1)/whitehat(2) bookkeeping
  ├─ outgoing upsert (youtube_ad_outgoing_links) — accumulate then one upsert
  ├─ ad_url upsert: R rows (redirects) + D row (destination)
  ├─ html_lander upsert (youtube_ad_html_lander_content)
  ├─ meta update (youtube_ad_meta_data)
  └─ if meta updated → ES update youtube_ads_data (youtube fields, §5)
     Response: { code, message, exe_time }
```

---

## 4. Tables (DB `pasdev_youtube`)

| Table | Ad-id column | Role |
|-------|--------------|------|
| `youtube_ad_meta_data` | `youtube_ad_id` | status machine, screenshot/zip arrays, dates, screenshot_url |
| `youtube_ad_domains` | `id` (PK) | domain + registered date + dod_date |
| `youtube_ad_url` | `youtube_ad_id` | redirect (R) + destination (D) urls |
| `youtube_ad_outgoing_links` | `youtube_ad_id` | source/redirect/final url chains |
| `youtube_ad_html_lander_content` | `youtube_ad_id` | the 3 html columns |
| `youtube_ad` | `id` | main ad — `domain_id` link |
| lookups | — | `youtube_ad_countries_only`, `youtube_country_only`, `country_data` |

> The API `id` field maps to `youtube_ad_id` in the lander child tables, and to `id` in `youtube_ad`.

---

## 5. Elasticsearch

- **Index:** `youtube_ads_data` (`YT_ELASTIC_INDEX`). Doc **`_id` = youtube_ad_id** (verified) + an `ad_id` field.
- **Match field:** `ad_id` (the service searches by `ad_id` and uses the returned `_id` for the update).
- **Write-back fields (youtube-specific — NOT the html_*_lander_text fields):**
  ```
  html_text                  = the (whitehat) html_content  [= dc_black_hat[0]]
  domain_registration_date   = unix seconds (strtotime of domain_registered_date)
  redirect_urls              = array (split of url_redirect on "||"), or null
  outgoing_urls              = the raw request outgoing_url array, or []
  ```

---

## 6. Status transitions

```
0 (pending)
  └─ getAds: in ES → (left at 0; emitted) ;  not in ES → redirect_status = 5

insertHtml:
  status 1/2 + .net    → redirect_status = 1
  status 1/2 + python  → redirect_status = 4
  status 3   + .net    → redirect_status = 3
  status 3   + python  → redirect_status = 5
```

| status | meaning | key writes |
|---|---|---|
| 1 | blackhat | `html_res_blackhat_lander_text`, `png_file`/`blackhat_path`, `blackhat_status`, `blackhat_date` |
| 2 | whitehat | `white_ad_screenshot`/`white_ad_lander`, `screenshot_url`, `white_ad_status`, `white_lander_date` (html → `dc_blackhat`) |
| 3 | no response | only flips `redirect_status` (3/5); short-circuits before the ES update |

---

## 7. Differences vs Google/Facebook landers

| | Google | YouTube |
|---|---|---|
| insert body | JSON array `[ {…} ]` | **`{ ad_id, insertData }`** (object, like facebook) |
| getAds status update | bulk → 2 up-front | **no status-2 update** (found left at 0; missing → 5) |
| ES index / match | `google_ads_data` / flat `id` | `youtube_ads_data` / match `ad_id`, **doc `_id` = ad_id** |
| ES write-back fields | `html_*_lander_text`, `domain`, `source_url`… | **`html_text`, `domain_registration_date` (unix), `redirect_urls`[], `outgoing_urls`[]** |
| outgoing match | by source/redirect/final + proxy_lander_status | by source/redirect/final **only** (no proxy_lander_status) |
| domain dod_date | not stamped | **stamped** (like facebook) |
| meta whitehat | white_ad_screenshot/lander | + **`screenshot_url`** (like facebook) |
| status-3 python | redirect_status 6 | **redirect_status 5** |
| getAds country join | countries_only.youtube_ad_id | `youtube_ad_countries_only.id = meta.youtube_ad_id` (legacy join, faithfully kept) |

---

## 8. Legacy quirks preserved (verbatim, commented in code)

1. **`html_whitehat_lander_text` always null**; whitehat html stored in `html_dc_blackhat_lander_text`.
2. **ES `html_text` = `dc_black_hat[0]`** — so a blackhat (status 1) insert writes `html_text = null` (only whitehat populates it).
3. **`updateOutgoingCountry`** filters by the matched row's id passed as `youtube_ad_id`.
4. **`getDataForLander`** wraps `ad_url`/`destination_url` in `ANY_VALUE()` for `only_full_group_by`; keeps the legacy `countries_only.id = meta.youtube_ad_id` join.
5. **`ad_category` table write NOT ported** — only the `cat_status=1` effect.
6. **status 3 short-circuits** before the ES update.

---

## 9. Config

Enabled via `config.json → networks.youtube` (committed):
```
sql.enabled=true,  sql.database=pasdev_youtube
elastic.enabled=true, elastic.index=youtube_ads_data
```
No `.env` change required. Dependency: `multer`.

---

## 10. Verification (done)

- ✅ All 9 tables/columns exist in `pasdev_youtube`; `getDataForLander` returns pending ads (≈249k at status 0), country resolves.
- ✅ ES `youtube_ads_data` (≈251k docs), `_id === ad_id` confirmed, `html_text`/`domain_registration_date`/`redirect_urls` present on real docs.
- ✅ Processed rows confirm write formats (JSON-array screenshots, whitehat html → `dc_blackhat`, `ad_url` D-rows `country_code="US"`).

**Test assets:** `postman/Youtube_Landers.postman_collection.json` + `postman/sample-files/`.

---

## Document Version
- **v1.0** — YouTube landers, faithful port from `api_youtube` BlackhatControllerYoutube.
- **v1.1** — Extracted `transforms.js` + `validate.js` from `insertHtmlService` (DRY/optimization); no behavior change.
- **DB/ES verified:** `pasdev_youtube` + `youtube_ads_data`.
