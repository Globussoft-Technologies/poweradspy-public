# Reddit Landers – Implementation Manifest

> Companion to `GOOGLE_LANDER_MANIFEST.md` (Google/gtext) and `FACEBOOK_LANDER_MANIFEST.md`.
> This file documents the **Reddit landers** as actually built and live-verified in `pas_node_api`.
> It follows the **Facebook landers layout** (a single `repository.js`, services directly under `landers/`,
> NAS via `nasClient` directly — no separate `models/` folder and no `nasService` helper).
>
> **Source of truth for behaviour** = the Reddit PHP in `api_reddit` (`BlackhatController@getRedditAdsWithCounrty`,
> `@uploadBlackhatContent`, `@insertHtmlContentToDB`). Faithful port.
>
> **Status: IMPLEMENTED & VERIFIED** against live `pasdev_reddit` (MySQL) +
> `reddit_search_mix` (Elasticsearch). The node service slug is **`reddit`**.

---

## 0. Golden Rules (as Implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_reddit` (`reddit_ad_*` tables) = system of record; Elasticsearch
   **`reddit_search_mix`** = the searchable projection (gate + write-back target).
3. **DatabaseManager singleton.** `service.db` (`db.sql`, `db.elastic`) injected by `ServiceRegistry`
   for slug `reddit`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` **directly**
   (status 1→BLACKHAT, 2→WHITEHAT folder). No separate landers NAS helper — same as Facebook.
5. **ES is DOTTED.** Unlike google_ads_data (flat), `reddit_search_mix` uses dotted field names
   (e.g., `reddit_ad.id`, `reddit_ad_html_lander_content.html_res_blackhat_lander_text`) and
   matches on `reddit_ad.id`.

---

## 1. Endpoints

Auto-mounted under `/api/v1/reddit` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP Origin |
|--------|------|-----------|
| GET | `/api/v1/reddit/landers/get_ads_for_blackhat` | `BlackhatController@getRedditAdsWithCounrty` |
| POST | `/api/v1/reddit/landers/upload_reddit_blackhat` | `BlackhatController@uploadBlackhatContent` |
| POST | `/api/v1/reddit/landers/insert_reddit_blackhat_html` | `BlackhatController@insertHtmlContentToDB` |

---

## 2. Directory Layout (Actual — Mirrors Facebook Landers)

```
src/
├── insertion/helpers/nasClient.js              ← shared NAS upload (storeInNas) — used directly
├── services/reddit/
    ├── routes/redditRoutes.js                  ← main Reddit routes (auto-mounted by ServiceRegistry)
    ├── landers/redditLandersRoutes.js          ← landers-specific routes + multer
    ├── controllers/redditLandersController.js  ← thin
    ├── landers/
        ├── repository.js                       ← all parameterized SQL (one fn per op)
        ├── getAdsService.js                    ← get_ads_for_blackhat
        ├── uploadService.js                    ← upload_reddit_blackhat (calls nasClient.storeInNas)
        ├── insertHtmlService.js                ← insert_reddit_blackhat_html
```

> Identical shape to `src/services/facebook/` landers. The route file lives in the service's
> top-level `routes/` dir so `ServiceRegistry` auto-mounts it under `/api/v1/reddit`
> (no shim needed).

---

## 3. Data Flow

### GET `/landers/get_ads_for_blackhat`
```
getAdsService.getAdsForBlackhat(db)
  ├─ repository.getDataForLander(0)          ← ≤100 ads at redirect_status=0
  │  (join reddit_ad_meta_data ← reddit_ad ← reddit_country_only; GROUP_CONCAT country)
  │
  ├─ for each ad:
  │  ├─ ES search reddit_search_mix (match reddit_ad.id)
  │  │  ├─ if found: update redirect_status=2, accumulate ISO, emit { id, iso, destination_url }
  │  │  └─ if NOT found: update redirect_status=5 (no response)
  │  └─ accumulate unique ISOs in isoAccumulator (per-ad, not cumulative)
  │
  └─ Response: { code, data, exe_time }
```

### POST `/landers/upload_reddit_blackhat` (multipart: media, zip, ad_id, country, status)
```
uploadService.uploadBlackhatContent(req)
  ├─ multer temp files
  ├─ nasClient.storeInNas(folder, path, adId, 'reddit', `${adId}_${country}_${status}_${ts}`)
  │  folder = status 1 → BLACKHAT, status 2 → WHITEHAT
  ├─ unlink temp files
  └─ Response: { code, message, image_path (screenshot), html_path (zip) }   ← SEPARATE fields
```

### POST `/landers/insert_reddit_blackhat_html` (JSON **ARRAY**: `[ { ad_id, ... } ]`)
```
insertHtmlService.insertHtmlRedirectCountry(req, db)
  ├─ ES check reddit_search_mix (match reddit_ad.id = postdata[0].ad_id) → else "ad not found"
  ├─ for each object: validate (ALL fields required)
  │  ├─ status=3 → flip redirect_status (3=.net / 6=python) and RETURN
  │  ├─ domain upsert (reddit_ad_domains)
  │  ├─ country normalize & bookkeeping
  │  ├─ outgoing upsert (reddit_ad_outgoing_links)     ← per-entry inside the loop
  │  ├─ ad_url upsert: R rows (redirects) + D row (destination)
  │  └─ status 1/2 routing (blackhat vs whitehat)
  │
  ├─ html_lander upsert (reddit_ad_html_lander_content)
  ├─ reddit_ad.domain_id update
  ├─ meta update (updateAdMetaData → affectedRows)
  ├─ if updated==1 → ES update reddit_search_mix (DOTTED fields)
  └─ Response: { code, message, exe_time }
```

---

## 4. Tables (DB `pasdev_reddit`)

| Table | Ad-id Column | Role |
|-------|--------------|------|
| `reddit_ad_meta_data` | `reddit_ad_id` | status machine, screenshot/zip arrays, dates |
| `reddit_ad_domains` | `id` (PK) | domain + registered date |
| `reddit_ad_url` | `reddit_ad_id` | redirect (R) + destination (D) urls |
| `reddit_ad_outgoing_links` | `reddit_ad_id` | source/redirect/final url chains |
| `reddit_ad_html_lander_content` | `reddit_ad_id` | the 3 html columns |
| `reddit_ad` | `id` | main ad → `domain_id` link |
| lookups | — | `reddit_country_only`, `country_data` |

> The API response `id` field maps to `reddit_ad_id` in lander child tables,
> and to `id` in the main `reddit_ad` table.

---

## 5. Elasticsearch

- **Index:** `reddit_search_mix` (REDDIT_ELASTIC_INDEX).
- **Match field:** dotted **`reddit_ad.id`**, doc type `doc`.
- **Write-back fields are DOTTED** (not flat like google_ads_data):
  ```
  reddit_ad_html_lander_content.html_whitehat_lander_text,
  reddit_ad_html_lander_content.html_dc_blackhat_lander_text,
  reddit_ad_html_lander_content.html_res_blackhat_lander_text,
  reddit_ad_domain.domain_registered_date,
  reddit_ad_outgoing_links.source_url,
  reddit_ad_outgoing_links.redirect_url,
  reddit_ad_outgoing_links.final_url,
  reddit_ad_url.url_redirects,
  reddit_ad_url.url_destination,
  reddit_ad_url.country_code
  ```
- The doc's existing top-level status field is the ad's own indexed value — the lander update
  does **not** write it.

---

## 6. Status Transitions

```
0 (pending)
  ├─ getAds: per-ad in ES → 2 (in-progress)
  │          per-ad NOT in ES → 5 (not found)
  │
insertHtml:
  status 1/2 + .net    → redirect_status = 1
  status 1/2 + python  → redirect_status = 4
  status 3   + .net    → redirect_status = 3
  status 3   + python  → redirect_status = 6
```

| status | meaning | key writes |
|--------|---------|-----------|
| 1 | blackhat residential | `html_res_blackhat_lander_text`, `png_file`/`blackhat_path`, `blackhat_status`, `blackhat_date` |
| 2 | whitehat/data center | `html_dc_blackhat_lander_text`, `white_ad_screenshot`/`white_ad_lander`, `white_ad_status`, `white_lander_date` |
| 3 | no response | only flips `redirect_status` (3/6); short-circuits before the ES update |

---

## 7. Differences vs Facebook Landers

| | Facebook | Reddit |
|---|---|---|
| insert body | `{ ad_id, insertData }` | **JSON array** `[ { ad_id, … } ]` |
| insert validation | `present`/nullable | **all fields required** |
| ES index / match | `search_mix` / dotted `facebook_ad.id` | `reddit_search_mix` / **dotted `reddit_ad.id`** |
| ES write-back | dotted field names | **dotted field names** |
| upload response | both files → `image_path` | `image_path` (media) **+** `html_path` (zip) |
| getAds status update | per-ad (2 found / 5 not-found) | **per-ad** (2 found / 5 not-found) |
| ISO accumulator | N/A | **per-ad**, not cumulative |
| domain dod_date | stamped | **stamped** |
| meta update | plain UPDATE | UPDATE → returns affectedRows |

---

## 8. Legacy Quirks Preserved (Verbatim, Commented in Code)

1. **`html_whitehat_lander_text` always `[]`/null**; whitehat html lands in `html_dc_blackhat_lander_text`.
2. **Per-ad ES check** before update; don't bulk-update.
3. **`GROUP_CONCAT` with country names**, not ISO codes (ISO conversion happens in service).
4. **`ad_category` table write NOT ported** — only the `cat_status=1` effect.
5. **status 3 short-circuits** before the ES update, so ES reflects the last status-1/2 call
   while MySQL `redirect_status` shows 3/6.
6. **Per-ad ISO accumulator**, not cumulative (unlike old buggy Quora code).

---

## 9. Config

Already enabled via `config.json → networks.reddit` (committed):
```
sql.enabled=true,  sql.database=pasdev_reddit
elastic.enabled=true, elastic.index=reddit_search_mix
```
No `.env` change required (config.json is read before `.env`). Dependency: `multer`.

---

## 10. Verification (Done)

- ✅ All 7 tables/columns exist in `pasdev_reddit`; `getDataForLander` returns pending ads.
- ✅ ES `reddit_search_mix` (>1000k docs), match field `reddit_ad.id`, dotted lander fields present.
- ✅ `insert_redis_blackhat_html` (status 1/2/3) → MySQL writes persist across all tables
  (meta, domain, ad_url R+D, outgoing, html), confirmed live on real ads.
- ✅ ES write-back reflects MySQL (dotted fields), with the status-3 short-circuit behaving
  as PHP.
- ✅ Syntax validated on all 6 files.
- ✅ Per-ad ES check fixed (was bulk-updating in old code).
- ✅ ISO accumulator fixed (was cumulative, now per-ad).

---

## 11. Adding the Next Network (Recipe)

1. Confirm the PHP source (`BlackhatController` of `api_{net}`) and the live schema
   (`SHOW COLUMNS`, ES `_mapping`).
2. Copy the reddit (or facebook) landers: `repository.js`, the 3 service files, the controller,
   and the route file. Adjust table/column names in `repository.js`, and the ES index +
   match field + field names in the services.
3. Place the route file in `src/services/{net}/routes/{net}LandersRoutes.js` (auto-mounted
   — no shim).
4. Enable the network in `config.json → networks.{net}` (sql + elastic).
5. Verify modules load (`node -c`), then test GET → POST → POST against live `pasdev_{net}` +
   the network's ES index.

---

## Document Version

- **v1.0** – Reddit landers, faithful port from `api_reddit` BlackhatController.
- **DB/ES verified:** `pasdev_reddit` + `reddit_search_mix`.
- **Fixes applied:** Per-ad ES check (was bulk), per-ad ISO accumulator (was cumulative).
