# Google (gtext) Landers — Implementation Manifest

> Companion to `LANDER_MANIFEST.md` (Native) and `FACEBOOK_LANDER_MANIFEST.md`.
> This file documents the **Google / gtext** landers as actually built and
> live-verified in `pas_node_api`. It follows the **Facebook landers layout** (a
> single `repository.js`, services directly under `landers/`, NAS via `nasClient`
> directly — no separate `models/` folder and no `nasService` helper).
>
> **Source of truth for behaviour** = the gtext PHP in `api_gtext`
> (`BlackhatController@getGoogleAdsWithCounrty`, `@uploadBlackhatContent`,
> `@inserHtmlContentToDBO`). Faithful port.
>
> **Status: DONE & verified** against live `pasdev_gtext` (MySQL) +
> `google_ads_data` (Elasticsearch). The node service slug is **`google`**.

---

## 0. Golden rules (as implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_gtext` (`google_text_ad_*` / `google_ad_*` tables) = system of record; Elasticsearch **`google_ads_data`** = the searchable projection (gate + write-back target).
3. **DatabaseManager singleton.** `service.db` (`db.sql`, `db.elastic`) injected by `ServiceRegistry` for slug `google`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` **directly** (status 1→BLACKHAT, 2→WHITEHAT folder). No separate landers NAS helper — same as Facebook.
5. **ES is FLAT, not dotted.** Unlike facebook's `search_mix`, `google_ads_data` uses flat field names and matches on `id` (see §5). The PHP `inserHtmlContentToDBO` already targets this newer index.

---

## 1. Endpoints

Auto-mounted under `/api/v1/google` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP origin |
|--------|------|-----------|
| GET | `/api/v1/google/landers/get_ads_for_blackhat` | `BlackhatController@getGoogleAdsWithCounrty` |
| POST | `/api/v1/google/landers/upload_gtext_blackhat` | `BlackhatController@uploadBlackhatContent` |
| POST | `/api/v1/google/landers/insert_html_content` | `BlackhatController@inserHtmlContentToDBO` |

---

## 2. Directory layout (actual — mirrors Facebook landers)

```
src/
├── insertion/helpers/nasClient.js              ← shared NAS upload (storeInNas) — used directly
└── services/google/
    ├── routes/googleLandersRoutes.js           ← routes + multer (auto-mounted by ServiceRegistry)
    ├── controllers/googleLandersController.js   ← thin
    └── landers/
        ├── repository.js                       ← all parameterized SQL (one fn per op)
        ├── getAdsService.js                    ← get_ads_for_blackhat
        ├── uploadService.js                    ← upload_gtext_blackhat (calls nasClient.storeInNas)
        └── insertHtmlService.js                ← insert_html_content
```

> Identical shape to `src/services/facebook/` landers. The route file lives in the
> service's top-level `routes/` dir so `ServiceRegistry` auto-mounts it under
> `/api/v1/google` (no shim needed).

---

## 3. Data flow

### GET `/landers/get_ads_for_blackhat`
```
getAdsService.getGoogleAdsWithCountry(db)
  ├─ repository.getDataForLander(0)          → ≤50 ads at redirect_status=0
  │    (join google_text_ad_countries_only → google_text_country_only; ANY_VALUE(destination_url))
  ├─ repository.updateMetaMultiple(all ids, redirect_status=2)   ← BULK flip up-front (no status 5)
  ├─ for each ad:
  │    ├─ repository.getIsoByNicenames(country names) → accumulate ISO
  │    └─ ES search google_ads_data (match id) → if present, emit { id, iso, destination_url }
  └─ Response: { code, message, data, exe_time }
```

### POST `/landers/upload_gtext_blackhat`  (multipart: media, zip, ad_id, country, status)
```
uploadService.uploadBlackhatContent(req)
  ├─ multer temp files
  ├─ nasClient.storeInNas(folder, path, adId, 'google', `${adId}_${country}_${status}_${ts}`)
  │    folder = status 1 → BLACKHAT, status 2 → WHITEHAT
  ├─ unlink
  └─ Response: { code, message, image_path (screenshot), html_path (zip) }   ← SEPARATE fields
```

### POST `/landers/insert_html_content`  (JSON **ARRAY**: `[ { ad_id, ... } ]`)
```
insertHtmlService.insertHtmlContent(req, db)
  ├─ ES check google_ads_data (match id = postdata[0].ad_id) → else "ad not found"
  ├─ for each object: validate (ALL fields required)
  │    ├─ status=3 → flip redirect_status (3=.net / 6=python) and RETURN
  │    ├─ domain upsert (google_text_ad_domains)         ← NO dod_date (unlike facebook)
  │    ├─ country normalize, blackhat(1)/whitehat(2) bookkeeping
  │    ├─ outgoing upsert (google_ad_outgoing_links)     ← per-entry inside the loop
  │    └─ ad_url upsert: R rows (redirects) + D row (destination)
  ├─ html_lander upsert (google_ad_html_lander_content)
  ├─ google_text_ad.domain_id update
  ├─ meta update (updateDataO → affectedRows)
  └─ if updated==1 → ES update google_ads_data (FLAT fields, §5)
     Response: { code, message, exe_time }   (==0 → "No Changes to Update")
```

---

## 4. Tables (DB `pasdev_gtext`)

| Table | Ad-id column | Role |
|-------|--------------|------|
| `google_text_ad_meta_data` | `google_text_ad_id` | status machine, screenshot/zip arrays, dates |
| `google_text_ad_domains` | `id` (PK) | domain + registered date |
| `google_ad_url` | `google_text_ad_id` | redirect (R) + destination (D) urls |
| `google_ad_outgoing_links` | `google_text_ad_id` | source/redirect/final url chains |
| `google_ad_html_lander_content` | `google_text_ad_id` | the 3 html columns |
| `google_text_ad` | `id` | main ad — `domain_id` link |
| lookups | — | `google_text_ad_countries_only`, `google_text_country_only`, `country_data` |

> The API response `id` field maps to `google_text_ad_id` in the lander child tables,
> and to `id` in the main `google_text_ad` table.

---

## 5. Elasticsearch

- **Index:** `google_ads_data` (`GOOG_ELASTIC_INDEX`).
- **Match field:** flat **`id`**, doc type `doc`.
- **Write-back fields are FLAT** (not dotted like search_mix):
  ```
  html_whitehat_lander_text, html_dc_blackhat_lander_text, html_res_blackhat_lander_text,
  domain_registered_date, domain,
  source_url, redirect_url, final_url,
  url_redirects, url_destination
  ```
- The doc's existing top-level `status` field is the ad's own indexed value — the lander update does **not** write it.

---

## 6. Status transitions

```
0 (pending)
  └─ getAds: BULK → 2 (in-progress) for ALL fetched ids   ← no status 5 for google

insertHtml:
  status 1/2 + .net    → redirect_status = 1
  status 1/2 + python  → redirect_status = 4
  status 3   + .net    → redirect_status = 3
  status 3   + python  → redirect_status = 6
```

| status | meaning | key writes |
|---|---|---|
| 1 | blackhat | `html_res_blackhat_lander_text`, `png_file`/`blackhat_path`, `blackhat_status`, `blackhat_date` |
| 2 | whitehat | `white_ad_screenshot`/`white_ad_lander`, `white_ad_status`, `white_lander_date` (html → `dc_blackhat`) |
| 3 | no response | only flips `redirect_status` (3/6); short-circuits before the ES update |

---

## 7. Differences vs Facebook landers (important)

| | Facebook | Google |
|---|---|---|
| insert body | `{ ad_id, insertData }` | **JSON array** `[ { ad_id, … } ]` |
| insert validation | `present`/nullable | **all fields required** |
| ES index / match | `search_mix` / dotted `facebook_ad.id` | `google_ads_data` / **flat `id`** |
| ES write-back | dotted field names | **flat field names** |
| upload response | both files → `image_path` | `image_path` (media) **+** `html_path` (zip) |
| getAds status update | per-ad (2 found / 5 not-found) | **bulk → 2** up-front; no status 5 |
| getAds country source | user's country (facebook_ad_users) | **ad's own** countries (countries_only) |
| domain dod_date | stamped | **not** stamped |
| meta update | plain UPDATE | `updateDataO` → returns affectedRows (0 ⇒ "No Changes to Update") |

---

## 8. Legacy quirks preserved (verbatim, commented in code)

1. **`html_whitehat_lander_text` always `[]`/null**; whitehat html lands in `html_dc_blackhat_lander_text`.
2. **`updateOutgoingCountry`** filters by the matched row's id passed as `google_text_ad_id`.
3. **`getDataForLander`** wraps `destination_url` in `ANY_VALUE()` to satisfy `only_full_group_by` (manifest §8 gotcha #2).
4. **`ad_category` table write NOT ported** — only the `cat_status=1` effect.
5. **status 3 short-circuits** before the ES update, so ES reflects the last status-1/2 call while MySQL `redirect_status` shows 3/6.

---

## 9. Config

Already enabled via `config.json → networks.google` (committed):
```
sql.enabled=true,  sql.database=pasdev_gtext
elastic.enabled=true, elastic.index=google_ads_data
```
No `.env` change required (config.json is read before `.env`). Dependency: `multer`.

---

## 10. Verification (done)

- ✅ All 9 tables/columns exist in `pasdev_gtext`; `getDataForLander` returns pending ads.
- ✅ ES `google_ads_data` (≈68.8k docs), match field `id`, flat lander fields present.
- ✅ `insert_html_content` (status 1/2/3) — MySQL writes persist across all tables (meta, domain, ad_url R+D, outgoing, html), confirmed live on a real ad.
- ✅ ES write-back reflects MySQL (flat fields), with the status-3 short-circuit behaving as PHP.

**Test assets:** `postman/Google_Landers.postman_collection.json` + `postman/sample-files/` (dummy screenshot + zip).

---

## 11. Adding the next network (recipe)

1. Confirm the PHP source (`BlackhatController` of `api_{net}`) and the live schema (`SHOW COLUMNS`, ES `_mapping`).
2. Copy the google (or facebook) landers: `repository.js`, the 3 service files, the controller, and the route file. Adjust table/column names in `repository.js`, and the ES index + match field + field names in the services.
3. Place the route file in `src/services/{net}/routes/{net}LandersRoutes.js` (auto-mounted — no shim).
4. Enable the network in `config.json → networks.{net}` (sql + elastic).
5. Verify modules load (`node -e require`), then test GET → POST → POST against live `pasdev_{net}` + the network's ES index.

---

## Document Version
- **v1.0** — Google/gtext landers, faithful port from `api_gtext` BlackhatController.
- **DB/ES verified:** `pasdev_gtext` + `google_ads_data`.
