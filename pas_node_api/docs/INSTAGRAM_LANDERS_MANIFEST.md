# Instagram Landers – Implementation Manifest

> Companion to `REDDIT_LANDERS_MANIFEST.md`, `PINTEREST_LANDERS_MANIFEST.md`, and `QUORA_LANDERS_MANIFEST.md`.
> This file documents the **Instagram landers** as built and verified in `pas_node_api`.
> It follows the **Facebook/Reddit landers layout** (repository.js, services under landers/, NAS via nasClient).
>
> **Source of truth for behaviour** = the Instagram PHP in `api_instagram` landers implementation.
> Faithful port with per-ad validation and ISO handling.
>
> **Status: IMPLEMENTED & VERIFIED** against live `pasdev_instagram` (MySQL) + Elasticsearch.
> The node service slug is **`instagram`**.

---

## 0. Golden Rules (as Implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_instagram` (`instagram_ad_*` tables) = system of record; Elasticsearch = searchable projection.
3. **DatabaseManager singleton.** `service.db` injected by `ServiceRegistry` for slug `instagram`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` directly (status 1→BLACKHAT, 2→WHITEHAT).
5. **Per-ad ES validation.** Validates each ad individually in Elasticsearch before processing.
6. **Per-ad ISO handling.** ISO codes tracked per-ad only, not cumulative.

---

## 1. Endpoints

Auto-mounted under `/api/v1/instagram` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP Origin |
|--------|------|-----------|
| GET | `/api/v1/instagram/landers/get-ads-for-blackhat` | Instagram BlackhatController |
| POST | `/api/v1/instagram/landers/upload_file_to-server` | Instagram BlackhatController |
| POST | `/api/v1/instagram/landers/insert_html_lander` | Instagram BlackhatController |

---

## 2. Directory Layout

```
src/services/instagram/
├── routes/instagramRoutes.js                      ← main Instagram routes (auto-mounted)
├── routes/instagramLandersRoutes.js               ← landers-specific routes + multer
├── landers/
    ├── instagramLandersController.js              ← thin wrapper
    ├── repository.js                              ← SQL abstraction
    ├── getAdsService.js                           ← get-ads-for-blackhat
    ├── uploadService.js                           ← upload_file_to-server
    ├── insertHtmlContentService.js                ← insert_html_lander
```

---

## 3. Features

1. **Per-ad ES validation:** Each ad checked individually in Elasticsearch.
2. **Per-ad ISO handling:** ISO codes accumulated per ad, not globally.
3. **Multi-table transactional updates:** Updates across domain, URL, outgoing, HTML tables.
4. **NAS file storage:** Media and zip files uploaded to BLACKHAT/WHITEHAT folders.
5. **Elasticsearch write-back:** Updated ES index after successful DB inserts.

---

## 3a. `POST /landers/insert_html_lander` — request payload & error contract

### Request payload (per lander / `insertData` object)

The scraper posts either `{ ad_id, insertData: { …fields } }` or a bare flat
object, optionally inside a top-level array for a batch. `insertData` fields:

| Field | Rule | Notes |
|-------|------|-------|
| `ad_id` | required | also accepted on the outer wrapper |
| `status` | required, `1` (blackhat) or `2` (whitehat) | |
| `crawled_by` | required, `.net` or `python` | |
| `country_iso` | present, string or null | e.g. `"us"`, `"in"` |
| `destinations` | present, string or null | full destination URL |
| `html_path` | present, string or null | NAS zip path |
| `screen_shot` | present, string or null | NAS png path |
| `html_content` | present, string or null | rendered lander text (also read as `html`) |
| `domain_registered_date` | present, may be null | `YYYY-MM-DD` |
| `redirects` | optional array | |
| `outgoing_url` | optional array of `{ redirect_urls, destination_url, … }` | |
| `domain_age`, `IsDataCenterProxy`, `ad_category` | optional | not validated |

> Field contract is **identical to the Facebook landers validator**
> (`insertHtmlService.js`). Example (verified):
> ```json
> { "ad_id": 149710, "insertData": {
>     "ad_id": 149710, "redirects": [], "outgoing_url": [],
>     "destinations": "https://takedownshop.com/pages/wholesale",
>     "country_iso": "us", "html_path": "/pas-dev/.../149710_us_2_..._html.zip",
>     "html_content": "…", "screen_shot": "/pas-dev/.../149710_us_2_....png",
>     "status": 2, "domain_age": 1, "domain_registered_date": "2007-01-30",
>     "IsDataCenterProxy": 1, "crawled_by": "python", "ad_category": [] } }
> ```

> **Known gap (not yet aligned with Facebook):** the service derives the domain
> from `data.domain_name`, but the scraper sends the URL as `destinations`. With
> real payloads `domain_name` is absent, so the `instagram_ad_domain` upsert and
> the `instagram_ad.domain_id` link are skipped. Facebook derives this from
> `destinations` via `extractDomain()`.

### Error contract

Mirrors the Facebook landers behaviour: every failure returns a professional,
specific message instead of a generic string.

```
LandersController.insertHtmlContent(req, res, service)
  ├─ body guard        → empty body / array → { code:400, "Request body is empty ..." }
  ├─ normalizeLanderItems → accepts { insertData:{} } | { insertData:[{}] } | flat { ad_id, … }
  │                         | [ … ] (top-level array); ad_id read from wrapper OR lander object
  │      malformed item  → { code:400, "No lander details were found for payload item(s) at index N ..." }
  ├─ dependency guard   → db.sql | db.elastic missing → { code:500, "A backend dependency is not available ..." }
  ├─ validateRequest(item) per item → names every offending field, e.g.
  │      rules (same field contract as the Facebook landers validator):
  │             ad_id required · status required|in:1,2 · crawled_by required|in:.net,python
  │             country_iso | destinations | html_path | screen_shot | html_content = present|string|nullable
  │             domain_registered_date = present|nullable
  │      one missing:  { code:400, 'The "insertData.<field>" field is missing from the payload and is required.' }
  │      many missing: { code:400, 'The following required fields are missing from insertData: "a", "b".' }
  │      bad value:    { code:400, 'The "insertData.crawled_by" field is invalid ... must be exactly ".net" or "python".' }
  │      (multi-item payloads prefix the message with "... for payload item at index N")
  └─ InsertHtmlContentService.insertHtmlContent(items, db)  → per-item result in data[]:
         ES miss           → { code:400, 'Ad "<id>" was not found in the search index (instagram_search_mix) ...' }
         domain insert 0   → { code:400, 'Insert failed: could not add domain "<d>" to instagram_ad_domain ...' }
         meta update 0 rows→ { code:400, 'Update failed: the instagram_ad_meta_data update for ad "<id>" affected 0 rows ...' }
         any thrown error  → { code:400, 'Failed to store the destination lander for ad "<id>": <actual DB/validation error>' }
         success           → { code:200, 'HTML content inserted successfully' }
     Envelope stays { code:200, message:"Processing complete", data:[…], exe_time }.
```

---

## 4. Database Tables

| Table | Ad-id Column | Role |
|-------|--------------|------|
| `instagram_ad_meta_data` | `instagram_ad_id` | status machine, paths, dates |
| `instagram_ad_domain` | `id` (PK) | domain + registration date (singular table name in `repository.js`) |
| `instagram_ad_url` | `instagram_ad_id` | redirect + destination urls |
| `instagram_ad_outgoing_links` | `instagram_ad_id` | source/redirect/final chains |
| `instagram_ad_html_lander_content` | `instagram_ad_id` | HTML lander content |
| `instagram_ad` | `id` | main ad table |

---

## 5. Status: IMPLEMENTED & VERIFIED

- ✅ All 3 endpoints working
- ✅ Per-ad ES validation verified
- ✅ Per-ad ISO handling verified
- ✅ Multi-table transactional updates
- ✅ JSON array path storage
- ✅ NAS file upload integration
- ✅ `insert_html_lander` error contract aligned with Facebook (§3a) — specific
  messages for missing/invalid fields, malformed body, missing dependency,
  ES miss, failed domain insert, and 0-row meta update
- ⚠️ Domain derivation still reads `domain_name` instead of `destinations` (§3a Known gap)

---

**Version: v1.1** – Instagram landers with per-ad validation and the Facebook-parity
`insert_html_lander` error contract (§3a). Validator field contract matches
`facebook/landers/insertHtmlService.js`.
