# GDN (Google Display Network) Landers — Implementation Manifest

> Companion to `GOOGLE_LANDER_MANIFEST.md`, `YOUTUBE_LANDER_MANIFEST.md` and
> `FACEBOOK_LANDER_MANIFEST.md`. Documents the **GDN** landers as actually built
> and live-verified in `pas_node_api`. Follows the **google landers layout** (a
> single `repository.js`, services directly under `landers/`, NAS via `nasClient`
> directly — no separate `models/` folder, no `nasService` helper).
>
> **Source of truth for behaviour** = the GDN PHP in `api_gdn`
> (`BlackhatController@getGDNAdsWithCounrty`, `@uploadBlackhatContent`,
> `@inserHtmlContentToDB`). Faithful port + ISO-accumulator fix.
>
> **Status: DONE & verified** against live `pasdev_gdn` (MySQL) + `gdn_search_mix`
> (Elasticsearch). The node service slug is **`gdn`**.

---

## 0. Golden rules (as implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_gdn` (`gdn_ad_*` tables) = system of record; Elasticsearch **`gdn_search_mix`** = the searchable projection (gate + write-back target for insert).
3. **DatabaseManager singleton.** `service.db` (`db.sql`, `db.elastic`) injected by `ServiceRegistry` for slug `gdn`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` **directly** (status 1→BLACKHAT, 2→WHITEHAT folder). Same as google/facebook.
5. **ES is DOTTED (search_mix-style), not flat.** Unlike `google_ads_data`, `gdn_search_mix` matches on dotted **`gdn_ad.id`** and the insert write-back uses dotted field names (see §5). The get-ads endpoint does **not** touch ES at all.

---

## 1. Endpoints

Auto-mounted under `/api/v1/gdn` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP origin |
|--------|------|-----------|
| GET | `/api/v1/gdn/landers/get_ads_for_blackhat` | `BlackhatController@getGDNAdsWithCounrty` |
| POST | `/api/v1/gdn/landers/upload_gdn_blackhat` | `BlackhatController@uploadBlackhatContent` |
| POST | `/api/v1/gdn/landers/insert_html_content` | `BlackhatController@inserHtmlContentToDB` |

---

## 2. Directory layout (actual — mirrors google landers)

```
src/
├── insertion/helpers/nasClient.js              ← shared NAS upload (storeInNas) — used directly
└── services/gdn/
    ├── routes/gdnLandersRoutes.js              ← routes + multer (auto-mounted by ServiceRegistry)
    ├── controllers/gdnLandersController.js      ← thin
    └── landers/
        ├── repository.js                       ← all parameterized SQL (one fn per op)
        ├── getAdsService.js                    ← get_ads_for_blackhat
        ├── uploadService.js                    ← upload_gdn_blackhat (calls nasClient.storeInNas)
        └── insertHtmlService.js                ← insert_html_content
```

> The route file exports a **default function** (`createGdnLandersRoutes`), so
> `ServiceRegistry` mounts it under `/api/v1/gdn` via the
> `typeof routeModule === 'function'` branch (the `createGdnRoutes` name is already
> taken by the search/ads `gdnRoutes.js`).

---

## 3. Data flow

### GET `/landers/get_ads_for_blackhat`
```
getAdsService.getGdnAdsWithCountry(db)
  ├─ repository.getDataForLander(0)          → ≤50 ads at redirect_status=0
  │    (join gdn_ad_countries_only → gdn_country_only; ANY_VALUE(destination_url))
  ├─ repository.updateMetaMultiple(all ids, redirect_status=2)   ← BULK flip up-front
  ├─ for each ad:
  │    └─ repository.getIsoByNicenames(ad's OWN country names) → iso
  │       (NO ES check — GDN emits every fetched ad straight from the meta table)
  └─ Response: { code, message, data:[{ id, iso, destination_url }], exe_time }
```

### POST `/landers/upload_gdn_blackhat`  (multipart: media, zip, ad_id, country, status)
```
uploadService.uploadBlackhatContent(req)
  ├─ multer temp files (field names MUST be exactly `media` + `zip`)
  ├─ nasClient.storeInNas(folder, path, adId, 'gdn', `${adId}_${country}_${status}_${ts}_...`)
  │    folder = status 1 → BLACKHAT, status 2 → WHITEHAT
  ├─ unlink temp
  └─ Response: { code, message, image_path (screenshot), html_path (zip) }   ← SEPARATE fields
```

### POST `/landers/insert_html_content`  (JSON **ARRAY**: `[ { ad_id, ... } ]`)
```
insertHtmlService.insertHtmlContent(req, db)
  ├─ ES check gdn_search_mix (match gdn_ad.id = postdata[0].ad_id) → else "ad not found"
  ├─ for each object: validate (required + domain_registered_date present|nullable)
  │    ├─ status=3 → flip redirect_status (3=.net / 6=python) and RETURN
  │    ├─ domain upsert (gdn_ad_domains)                 ← NO dod_date
  │    ├─ country normalize, blackhat(1)/whitehat(2) bookkeeping
  │    ├─ outgoing upsert (gdn_ad_outgoing_links)        ← per-entry inside the loop
  │    └─ ad_url upsert: R rows (redirects) + D row (destination)
  ├─ html_lander upsert (gdn_ad_html_lander_content)
  ├─ gdn_ad.domain_id update (main table, WHERE id)
  ├─ meta update (updateData → affectedRows)
  └─ if updated==1 → resolve gdn_ad_url country_code (iso→nicename) → ES update
     gdn_search_mix (DOTTED fields, §5).  Response: { code, message, exe_time }
```

---

## 4. Tables (DB `pasdev_gdn`) — live-verified

| Table | Ad-id column | Role |
|-------|--------------|------|
| `gdn_ad_meta_data` | `gdn_ad_id` | status machine, screenshot/zip arrays, dates |
| `gdn_ad_domains` | `id` (PK) | domain + `domain_registered_date` |
| `gdn_ad_url` | `gdn_ad_id` | redirect (R) + destination (D) urls, `cat_status` |
| `gdn_ad_outgoing_links` | `gdn_ad_id` | source/redirect/final url chains |
| `gdn_ad_html_lander_content` | `gdn_ad_id` | the 3 html columns |
| `gdn_ad` | `id` | main ad — holds `domain_id` |
| lookups | — | `gdn_ad_countries_only`, `gdn_country_only`, `country_data` (shared, not gdn-prefixed) |

> Verified meta columns: `redirect_status, outgoing_status, png_file, blackhat_status,
> blackhat_date, blackhat_path, white_ad_lander, white_ad_screenshot, white_ad_status,
> white_lander_date, destination_url`. **`blackhat_date` is plain** (no hyphen — unlike
> the LinkedIn `blackhat_date-date` typo). `domain_id` lives on `gdn_ad`, NOT on meta.

---

## 5. Elasticsearch

- **Index:** `gdn_search_mix` (`GDN_ELASTIC_INDEX`). Live count ≈ 117k docs.
- **Match field:** dotted **`gdn_ad.id`**, doc type `doc` (used only by `insert_html_content`).
- **get-ads does NOT use ES** (returns straight from `gdn_ad_meta_data`).
- **Write-back fields are DOTTED** (search_mix-style):
  ```
  gdn_ad_html_lander_content.html_whitehat_lander_text
  gdn_ad_html_lander_content.html_dc_blackhat_lander_text
  gdn_ad_html_lander_content.html_res_blackhat_lander_text
  gdn_ad_domains.domain_registered_date
  gdn_ad_outgoing_links.source_url / redirect_url / final_url
  gdn_ad_url.url_redirects / url_destination / country_code   ← country_code = nicenames resolved from stored ISO
  ```

---

## 6. Status transitions

```
0 (pending)
  └─ getAds: BULK → 2 (in-progress) for ALL fetched ids

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

## 7. ISO accumulator fix (the bug)

**Legacy PHP `getGDNAdsWithCounrty`** kept a single `$a = []` array OUTSIDE the per-ad
loop and pushed every ad's resolved ISO codes into it, then assigned `$response->iso = $a`.
Result: each ad in the response carried the **running union** of all earlier ads' countries
(phantom countries). Same bug existed in google/youtube/facebook/linkedin.

**Fix (this port):** there is no shared accumulator — each ad resolves and emits **only its
own** ISO codes (`iso: isos`).

**Live proof** (read-only, `pasdev_gdn`, redirect_status=0):
```
ad 335997: countries=[Azerbaijan] -> iso=[AZ]
ad 335996: countries=[Azerbaijan] -> iso=[AZ]
ad 335995: countries=[Belgium]    -> iso=[BE]    ← legacy would show [AZ, BE]
ad 335994: countries=[Belgium]    -> iso=[BE]
```

---

## 8. Differences vs Google landers (important)

| | Google (gtext) | GDN |
|---|---|---|
| ES index / match | `google_ads_data` / **flat `id`** | `gdn_search_mix` / **dotted `gdn_ad.id`** |
| ES write-back | **flat** field names | **dotted** field names + `gdn_ad_url.country_code` |
| getAds ES check | yes (emits only ads present in ES) | **no** (emits every fetched ad) |
| upload endpoint | `upload_gtext_blackhat` | `upload_gdn_blackhat` |
| tables | `google_text_ad_*` (PK `google_text_ad_id`) | `gdn_ad_*` (PK `gdn_ad_id`) |
| insert validation | all required | required + `domain_registered_date` **present\|nullable** |

---

## 9. Legacy quirks preserved (verbatim, commented in code)

1. **`html_whitehat_lander_text` always `[]`/null**; whitehat html lands in `html_dc_blackhat_lander_text`.
2. **`updateOutgoingCountry`** filters by the matched row's id passed as `gdn_ad_id`.
3. **`getDataForLander`** wraps `destination_url` in `ANY_VALUE()` to satisfy `only_full_group_by`.
4. **status 3 short-circuits** before the ES update.
5. **Intentional corrections** (consistent with the google lander, NOT faithful-to-bug):
   - `insertDomainName` uses `INSERT … ` returning the real insert id (PHP used `->insert()` returning a bool, so the main ad's `domain_id` was set to `1`).
   - `getOutgoingDetails` / `getDestinationDetails` use null-safe `<=>` matching.
   - ISO accumulator removed (§7).

---

## 10. Config

Already enabled via `config.json → networks.gdn` (committed):
```
sql.enabled=true,  sql.database=pasdev_gdn
elastic.enabled=true, elastic.index=gdn_search_mix
```
No `.env` change required (config.json is read before `.env`). Dependency: `multer`.

---

## 11. Verification (done)

- ✅ All 8 tables/columns exist in `pasdev_gdn`; `getDataForLander` returns pending ads (≈59.4k at redirect_status=0).
- ✅ ES `gdn_search_mix` (≈117k docs), dotted match `gdn_ad.id` resolves a live pending ad.
- ✅ Accumulator-free proven live (§7) — each ad emits only its own ISO codes.
- ✅ All 6 modules load (`node -e require`); the route builder returns a mounted Router.

**Test assets:** `GDN-Landers.postman_collection.json` (GET → upload → insert, status 1/2/3 examples).

---

## Document Version
- **v1.0** — GDN landers, faithful port from `api_gdn` BlackhatController + ISO-accumulator fix.
- **DB/ES verified:** `pasdev_gdn` + `gdn_search_mix`.
