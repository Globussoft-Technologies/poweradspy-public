# Facebook Landers — Implementation Manifest

> Companion to `LANDER_MANIFEST.md` (Native). This file documents the **Facebook**
> landers as actually built and live-verified in `pas_node_api`.
>
> **Source of truth for behaviour** = the Facebook PHP in `api`
> (`BlackHatController@getAdwithCountryCode`, `@uploadFileToServer`,
> `@insertHtmlRedirectCountry`). This is a faithful port — same request/response
> shapes, status machine, DB writes and ES write-back as the PHP.
>
> **Status: DONE & verified** against live `pasdev_facebook` (MySQL) +
> `search_mix` (Elasticsearch).

---

## 0. Golden rules (as implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous, no jobs.
2. **Schema.** MySQL = system of record (`facebook_ad_*` tables); Elasticsearch `search_mix` = the searchable projection that both gates eligibility and receives the enriched lander data.
3. **DatabaseManager singleton.** SQL + ES come from `service.db` (`db.sql`, `db.elastic`), injected by `ServiceRegistry` per network slug `facebook`.
4. **Shared NAS helper.** Uploads go through `src/insertion/helpers/nasClient.js` (`storeInNas`).
5. **Faithful quirks.** Several legacy behaviours are preserved verbatim (see §7).

---

## 1. Endpoints

Auto-mounted under `/api/v1/facebook` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP origin |
|--------|------|-----------|
| GET | `/api/v1/facebook/landers/getAdwithCountryCode` | `BlackHatController@getAdwithCountryCode` |
| POST | `/api/v1/facebook/landers/uploadFileToServer` | `BlackHatController@uploadFileToServer` |
| POST | `/api/v1/facebook/landers/insertHtmlRedirectCountry` | `BlackHatController@insertHtmlRedirectCountry` |

---

## 2. Directory layout (actual)

```
src/
├── insertion/helpers/nasClient.js          ← shared NAS upload (storeInNas)
└── services/facebook/
    ├── routes/facebookLandersRoutes.js      ← routes + multer (auto-mounted)
    ├── controllers/facebookLandersController.js  ← thin
    └── landers/
        ├── repository.js                    ← all parameterized SQL (one fn per op)
        ├── getAdsService.js                 ← getAdwithCountryCode
        ├── uploadService.js                 ← uploadFileToServer
        └── insertHtmlService.js             ← insertHtmlRedirectCountry
```

> Note: Facebook uses a flatter layout than the Native manifest (a single
> `repository.js` instead of a `models/` folder). The Google landers later adopted
> the full manifest structure — see `GOOGLE_LANDER_MANIFEST.md`.

---

## 3. Data flow

### GET `/landers/getAdwithCountryCode`
```
getAdsService.getAdwithCountryCode(db)
  ├─ repository.getDataForLander(0)         → ≤50 ads at redirect_status=0
  │    (join facebook_ad_users → facebook_users → country_only for the user's country)
  ├─ for each ad:
  │    ├─ ES search search_mix (term facebook_ad.id)
  │    ├─ present → updateMeta redirect_status=2 ; resolve ISO (per-ad, see §7) ; emit
  │    └─ absent  → updateMeta redirect_status=5
  └─ Response: { code, message, data:[{ id, ad_url, iso, destination_url }], exe_time }
```

### POST `/landers/uploadFileToServer`  (multipart: media, zip, ad_id, country, status)
```
uploadService.uploadFileToServer(req)
  ├─ multer writes media/zip to a temp dir
  ├─ storeInNas(folder, path, adId, 'facebook', `${adId}_${country}_${status}_${ts}`)
  │    folder = status 1 → BLACKHAT, status 2 → WHITEHAT
  ├─ unlink temp files
  └─ Response: { code, message, image_path }   (both files share image_path — PHP parity)
```

### POST `/landers/insertHtmlRedirectCountry`  (JSON: `{ ad_id, insertData }`)
```
insertHtmlService.insertHtmlRedirectCountry(req, db)
  ├─ ES check search_mix (must exist) → else { code:400, "ad not found" }
  ├─ validate insertData (present|nullable fields; ad_id/status/crawled_by required)
  ├─ status=3 → flip redirect_status (3=.net / 5=python) and RETURN
  ├─ domain upsert (facebook_ad_domains) + dod_date stamp + facebook_ad.domain_id
  ├─ country normalize ("us,gb" → "US||GB")
  ├─ blackhat(1)/whitehat(2) bookkeeping (screenshots/zips JSON arrays, dates, statuses)
  ├─ outgoing upsert (facebook_ad_outgoing_links)
  ├─ ad_url upsert: R rows (redirects) + D row (destination)
  ├─ html_lander upsert (facebook_ad_html_lander_content)
  ├─ meta update (facebook_ad_meta_data)
  └─ if meta updated → ES update search_mix (DOTTED fields, see §5)
     Response: { code, message, exe_time }
```

---

## 4. Tables (DB `pasdev_facebook`)

| Table | Ad-id column | Role |
|-------|--------------|------|
| `facebook_ad_meta_data` | `facebook_ad_id` | status machine, screenshot/zip arrays, dates |
| `facebook_ad_domains` | `id` (PK) | domain + registered date + dod_date |
| `facebook_ad_url` | `facebook_ad_id` | redirect (R) + destination (D) urls |
| `facebook_ad_outgoing_links` | `facebook_ad_id` | source/redirect/final url chains |
| `facebook_ad_html_lander_content` | `facebook_ad_id` | the 3 html columns |
| `facebook_ad` | `id` | main ad — `domain_id` link |
| lookups | — | `facebook_ad_users`, `facebook_users`, `country_only`, `country_data` |

---

## 5. Elasticsearch

- **Index:** `search_mix` (`FB_ELASTIC_INDEX`).
- **Match field:** `facebook_ad.id` (dotted), doc type `doc`.
- **Write-back fields are DOTTED** (search_mix is denormalized with dotted keys):
  ```
  facebook_ad_html_lander_content.html_whitehat_lander_text
  facebook_ad_html_lander_content.html_dc_blackhat_lander_text
  facebook_ad_html_lander_content.html_res_blackhat_lander_text
  facebook_ad_domains.domain_registered_date
  facebook_ad_outgoing_links.source_url | redirect_url | final_url
  facebook_ad_url.url_redirects | url_destination | country_code
  ```
- `country_code` is written to ES as the **nicename** (ISO `IN` → `["India"]`); MySQL stores the ISO.

---

## 6. Status transitions

```
0 (pending)
  ├─ getAds: in ES   → 2 (found / in-progress)
  └─ getAds: not ES  → 5 (failed)

insertHtml:
  status 1/2  + .net    → redirect_status = 1
  status 1/2  + python  → redirect_status = 4
  status 3    + .net    → redirect_status = 3
  status 3    + python  → redirect_status = 5
```

| status (insertData) | meaning | key writes |
|---|---|---|
| 1 | blackhat lander | `html_res_blackhat_lander_text`, `png_file`/`blackhat_path`, `blackhat_status`, `blackhat_date` |
| 2 | whitehat lander | `white_ad_screenshot`/`white_ad_lander`, `white_ad_status`, `white_lander_date` (html → `dc_blackhat`) |
| 3 | no response | only flips `redirect_status` (no html/domain/url writes) |

---

## 7. Legacy quirks preserved (verbatim, commented in code)

1. **`html_whitehat_lander_text` is always null/`[]`** — the PHP `$whitehat` array is never populated.
2. **Whitehat html lands in `html_dc_blackhat_lander_text`** (status 2 pushes to `dc_black_hat`).
3. **`updateOutgoingCountry` filters by the matched row's id** passed as the `facebook_ad_id` where value (PHP latent quirk).
4. **ES `country_code` = nicename array** while MySQL stores the ISO.
5. **`getAds` ISO accumulator** is shared across ads — each ad's `iso` is a snapshot of the running set.
6. **`png_file` is `varchar(128)`** (vs `blackhat_path text`) — a pre-existing schema constraint, left as-is.
7. **`ad_category` table write is NOT ported** (out of the 3-endpoint scope) — only the observable `cat_status=1` effect is replicated.

---

## 8. Config

Enabled via `config.json → networks.facebook` (and/or `.env` `FB_*`):
```
sql.enabled=true, sql.database=pasdev_facebook
elastic.enabled=true, elastic.index=search_mix
```
Dependency added: `multer` (multipart upload parsing).

---

## 9. Verification (done)

- ✅ All referenced tables/columns exist in `pasdev_facebook`.
- ✅ `getAdwithCountryCode` returns pending ads and flips `redirect_status`.
- ✅ `insertHtmlRedirectCountry` (status 1/2/3) — all MySQL writes persist (incl. accumulate/dedup).
- ✅ ES `search_mix` write-back matches MySQL (with the ISO→nicename transform).

**Test assets:** `postman/Facebook_Landers.postman_collection.json`.

---

## 10. Key files

| Path | Purpose |
|------|---------|
| `src/services/facebook/routes/facebookLandersRoutes.js` | routes + multer |
| `src/services/facebook/controllers/facebookLandersController.js` | thin controller |
| `src/services/facebook/landers/repository.js` | parameterized SQL |
| `src/services/facebook/landers/getAdsService.js` | getAdwithCountryCode |
| `src/services/facebook/landers/uploadService.js` | uploadFileToServer |
| `src/services/facebook/landers/insertHtmlService.js` | insertHtmlRedirectCountry |
| `src/insertion/helpers/nasClient.js` | shared NAS upload |

---

## Document Version
- **v1.0** — Facebook landers, faithful port from `api` BlackHatController.
- **DB/ES verified:** `pasdev_facebook` + `search_mix`.
