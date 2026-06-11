# Landers Subsystem — Developer Manifest

> **Read this first.** It is a self-contained guide to the landers subsystem.
> A developer can implement a NEW network landers end-to-end from this file
> alone, reusing all shared code — see §7 for the mechanical recipe and §8 for
> the database/Elasticsearch gotchas already solved during Native implementation.
>
> Source of truth for behaviour = the Native PHP in `api_native`
> (`BlackhatController@getNativeAdsWithCounrty`, `@uploadBlackhatContent`, `@inserHtmlContentToDB`),
> mapped in this manifest.
>
> **For the complete data-flow (what goes to which table/column/NAS/ES, insert vs update,
> verify & debug queries) see the relevant SQL schema documentation.**
>
> **Ad networks** (the platforms we scrape for): native, facebook, instagram, gdn, youtube, google,
> linkedin, reddit, quora, pinterest, tiktok.
> **DONE (live): Native** (3-endpoint pipeline for ad lander scraping).
> The remaining networks are thin layers on the shared engine — copy native's `src/services/{net}/landers/` 
> and adjust the deltas (§7). Each network is self-contained.

---

## 0. Golden rules

1. **Three-endpoint pipeline.** Every landers API has exactly three endpoints: fetch ads → upload files → insert HTML. Sequential, synchronous responses, no background jobs.
2. **Network-isolated schema.** Each network works with its own `{net}_ad_*` tables and `{net}_search_mix` Elasticsearch index. Never query across networks.
3. **DatabaseManager singleton.** All SQL and Elasticsearch access goes through `DatabaseManager.getSQL('native')` and `DatabaseManager.getElastic('native')`. No separate pools.
4. **Shared NAS helper.** File uploads use `src/landers/helpers/nasService.js` — wraps the insertion API's `nasClient`. No duplication.
5. **Minimal scope.** Landers endpoints do NOT call external APIs (translate, impression, popularity). They query local DB, update ES, upload files to NAS. That's it.
6. **Status transitions.** Ad status changes through the pipeline: 0 (pending) → 2 (found) or 5 (not found) → 1/3/4/6 (final). Schema is shared; logic is per-network.

---

## 1. Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/{network}/landers/get_ads_for_blackhat` | Fetch ads with redirect_status=0, check Elasticsearch, update status |
| POST | `/api/v1/{network}/landers/upload_native_blackhat` | Upload screenshot + HTML zip to NAS |
| POST | `/api/v1/{network}/landers/insert_html_content` | Insert HTML, domains, URLs, update ES |

**Legacy path (backward compat):** `/api/landers/{endpoint}` still works for native.

---

## 2. Directory layout (actual)

```
src/
├── landers/                              ★ SHARED — used by ALL networks
│   └── helpers/
│       └── nasService.js                 → wrapper around insertion's nasClient
│
├── insertion/                            (no change — insertion API helpers)
│   └── helpers/
│       ├── nasClient.js                  (used by landers)
│       ├── httpClient.js                 (not used by landers)
│       ├── mediaUpload.js                (not used by landers)
│       └── ...
│
└── services/{network}/                   ← Each network is SELF-CONTAINED
    ├── native/landers/                   ★ Native landers (reference implementation)
    │   ├── routes/
    │   │   └── nativeLandersRoutes.js    → endpoint routing
    │   ├── controllers/
    │   │   └── nativeLandersController.js → request handling (thin)
    │   ├── services/
    │   │   ├── getNativeAdsService.js    → fetch + ES check + status update
    │   │   ├── uploadFilesService.js     → NAS file upload
    │   │   └── insertHtmlContentService.js → store HTML + URLs + metadata
    │   └── models/
    │       ├── NativeAdMetaData.js       → native_ad_meta_data queries
    │       ├── NativeAdDomains.js        → native_ad_domains queries
    │       ├── NativeAdUrl.js            → native_ad_url queries
    │       ├── NativeAdOutgoing.js       → native_ad_outgoing queries
    │       ├── NativeAdHtmlLander.js     → native_ad_html_lander_content queries
    │       └── NativeCountryData.js      → country_data queries (ISO codes)
    │
    ├── facebook/                         (insertion already here)
    │
    └── ... (other networks)
```

---

## 3. Data flow (three endpoints)

### Step 1: GET `/api/v1/native/landers/get_ads_for_blackhat`

```
Request: (empty)

getNativeAdsService.fetchAdsForScraping()
  ├─ NativeAdMetaData.getAdsByStatus(0)
  │  └─ SELECT from native_ad_meta_data WHERE redirect_status = 0
  │     JOIN native_ad, native_country_only for country data
  │
  ├─ For each ad:
  │  ├─ searchAd(adId) → Elasticsearch native_search_mix
  │  ├─ If found → update redirect_status = 2
  │  ├─ If not found → update redirect_status = 5
  │  └─ Get ISO codes from country_data table
  │
  └─ Return: [{ id, destination_url, iso: ["US", "GB"], country: "..." }]

Response: 
{
  "code": 200,
  "message": "Ads fetched successfully",
  "data": [{ id: 232863, destination_url: "https://...", iso: ["US"] }],
  "exe_time": 0.45
}
```

### Step 2: POST `/api/v1/native/landers/upload_native_blackhat`

```
Request:
{
  "ad_id": 232863,
  "country": "US",
  "status": 1,  // 1=BLACKHAT, 2=WHITEHAT
  "media": <file>,      // screenshot
  "zip": <file>         // HTML bundle
}

uploadFilesService.uploadBlackhatContent()
  ├─ Save temp files to storage/nativeData/
  ├─ uploadToNAS(imagePath, adId, 1)
  │  └─ nasService → storeInNas("BLACKHAT", imagePath, adId, "native", adId)
  │     └─ insertion's nasClient → media.globussoft.com/BLACKHAT/...
  ├─ uploadToNAS(zipPath, adId, 1)
  │  └─ nasService → same
  ├─ Clean up temp files
  └─ Return NAS paths

Response:
{
  "code": 200,
  "message": "Files uploaded successfully",
  "image_path": "https://media.globussoft.com/BLACKHAT/232863_US_1_1623456789.jpg",
  "html_path": "https://media.globussoft.com/BLACKHAT/232863_US_1_1623456789.zip"
}
```

### Step 3: POST `/api/v1/native/landers/insert_html_content`

```
Request (single or array):
{
  "ad_id": 232863,
  "status": 1,           // 1/2=found, 3=no_response
  "crawled_by": ".net",  // ".net" or "python"
  "html": "<html>...",
  "domain": "example.com",
  "domain_registered_date": "2024-01-15",
  "outgoing_url": [{ redirect_urls: [...], destination_url: "..." }],
  "destinations": "https://...",
  "country_iso": ["US"]
}

insertHtmlContentService.insertHtmlContent()
  ├─ searchAd(adId) → Elasticsearch (must exist)
  ├─ Handle no-response case (status=3)
  │  └─ Set redirect_status = 3 (.net) or 6 (python)
  │
  ├─ Extract domain → NativeAdDomains.getOrCreate()
  │  └─ INSERT or reuse domain_id
  │
  ├─ Process outgoing URLs → NativeAdOutgoing.processOutgoingUrls()
  │  └─ INSERT into native_ad_outgoing with pipe-delimited country codes
  │
  ├─ Process redirect URLs → NativeAdUrl.insertMultipleUrls()
  │  └─ INSERT into native_ad_url (type='R' for redirect, 'D' for destination)
  │
  ├─ Store HTML → NativeAdHtmlLander.insertHtmlContent()
  │  └─ INSERT into native_ad_html_lander_content
  │     Choose column based on status:
  │     - status=2 → html_whitehat_lander_text
  │     - status=1 → html_res_blackhat_lander_text
  │
  ├─ Update metadata → NativeAdMetaData.updateData()
  │  └─ Set redirect_status based on status + crawled_by:
  │     - status 1/2 + .NET → redirect_status = 1
  │     - status 1/2 + Python → redirect_status = 4
  │     - status 3 + .NET → redirect_status = 3
  │     - status 3 + Python → redirect_status = 6
  │
  ├─ Update main ad table → native_ad
  │  └─ Set domain_id
  │
  └─ Update Elasticsearch → updateAdDocument()
     └─ Update native_search_mix with htmlContent, domainData, outgoingData, urlData

Response:
{
  "code": 200,
  "message": "Destination Lander updated successfully",
  "data": { "success": 1, "failed": 0 },
  "exe_time": 0.23
}
```

---

## 4. Shared helpers (never duplicate — call these from every network)

| Helper | Key API | Notes |
|--------|---------|-------|
| **DatabaseManager** | `getSQL('native')`, `getElastic('native')` | Singleton, manages per-network connections. Used by all models & services. |
| **nasService** | `uploadToNAS(filePath, adId, status, network)` | Wraps insertion's nasClient. Maps status 1→BLACKHAT, 2→WHITEHAT. |
| **NativeAd\* models** | `getAdsByStatus()`, `updateData()`, `getOrCreate()`, etc. | Each model = one table. All use DatabaseManager internally. |

---

## 5. Configuration

### Global — `config.json → landers` (optional, not yet in use)

```jsonc
"landers": {
  "enabled": true,
  "nas": {
    "mediaUrl": "https://media.globussoft.com",
    "mediaToken": "Bearer ...",  // from env NAS_MEDIA_TOKEN
    "bucket": "pas-dev",
  }
}
```

### Per-network — `config.json → networks.<net>.landers.enabled` (future)

```jsonc
"native": {
  "enabled": true,
  "landers": { "enabled": true },
  "elastic": { "index": "native_search_mix" },
  "sql": { "database": "pasdev_native" }
}
```

For now, all enabled per the main network config. No separate landers toggle yet.

---

## 6. Adding a NEW network landers — mechanical recipe (proven with Native)

**Architecture rule (important):** each network is **SELF-CONTAINED** under `src/services/{net}/landers/`.
It keeps its OWN copy of `routes/`, `controllers/`, `services/`, `models/` **specific to that network's schema**.
Only `src/landers/helpers/` is shared across networks.

### Steps:

1. **Extract the PHP VERBATIM** (use an agent) for the network's three endpoints:
   the exact validator rules, the INSERT/UPDATE queries for each table, the Elasticsearch
   field names and date formats, and the status transition logic. Save to `PHP-SPEC-{net}.md`.

2. **Confirm live schema:**
   - `SHOW TABLES LIKE '{net}_%'` + `SHOW COLUMNS` for all tables
   - `GET {net}_search_mix/_mapping/field/*` for ES field prefixes, date formats, field names
   - Column/table names and ES prefix (`{net}_ad.*` vs `native_ad.*`) are the real per-network work.

3. **Enable in config:**
   Already present: `networks.{net}.enabled = true`. Confirm the NAS prefix in `nasService.js`
   (map status 1/2 to BLACKHAT/WHITEHAT, network name).

4. **Copy Native as template:**
   ```bash
   cp -r src/services/native/landers src/services/{net}/landers
   ```
   Then adjust the deltas:
   - `models/*.js` — table/column names to `{net}_ad_*`, ES index to `{net}_search_mix`, FK lookups.
   - `services/*.js` — update table/column references. The logic (loop, validate, update) stays the same.
   - `controllers/*.js` — slug + endpoint paths. (Usually copy-paste, names stay the same.)
   - `routes/*.js` — slug in route mount path.

5. **Verify:**
   - Load all modules (`node -e require(...)`), no parse errors.
   - Mock insert (stub db/elastic), then a real request against live `pasdev_{net}` + `{net}_search_mix`.
   - Fix mismatches in `models/` and `services/` only.

6. **Register in app.js:**
   ```javascript
   app.use('/api/v1/{net}/landers', require('./services/{net}/landers/routes/{net}LandersRoutes'));
   ```

---

## 7. Status transition logic (critical)

Every ad moves through states:

```
Initial: redirect_status = 0 (pending)

After GET /get_ads_for_blackhat:
  ├─ Found in ES native_search_mix → redirect_status = 2 (in progress)
  └─ Not found in ES → redirect_status = 5 (failed)

After POST /insert_html_content:
  ├─ status = 1 or 2 (lander found)
  │  ├─ crawled_by = ".net" → redirect_status = 1 (done)
  │  └─ crawled_by = "python" → redirect_status = 4 (done)
  │
  └─ status = 3 (no response from destination)
     ├─ crawled_by = ".net" → redirect_status = 3 (no response)
     └─ crawled_by = "python" → redirect_status = 6 (no response)

Final: redirect_status ∈ {1, 3, 4, 6} (terminal)
```

**Table: Status Values**

| redirect_status | Meaning | Set By | When |
|---|---|---|---|
| 0 | Pending | Initial insert | Ad created, awaiting GET |
| 1 | Done (.NET) | insertHtmlContent | status 1/2 + crawled_by=".net" |
| 2 | In progress | getNativeAds | Found in Elasticsearch |
| 3 | No response (.NET) | insertHtmlContent | status=3 + crawled_by=".net" |
| 4 | Done (Python) | insertHtmlContent | status 1/2 + crawled_by="python" |
| 5 | Failed | getNativeAds | Not found in Elasticsearch |
| 6 | No response (Python) | insertHtmlContent | status=3 + crawled_by="python" |

---

## 8. Database & Elasticsearch gotchas (already solved)

These were discovered during Native implementation. The same will apply to other networks.

1. **Table naming.** Each network has `{net}_ad_*` tables, not `native_ad_*`. Elasticsearch index is `{net}_search_mix`. Column names MAY differ per network (e.g., Instagram has no `platform`, has `ad_type`). Always query `SHOW COLUMNS` before copying queries.

2. **Strict MySQL (`only_full_group_by`).**
   In `NativeAdMetaData.getAdsByStatus()`, the GROUP BY uses `MAX(destination_url)` to satisfy strict mode.
   Other networks may have the same issue — if the SELECT list has non-aggregated columns, wrap them in `MAX()` or `ANY_VALUE()`.

3. **Elasticsearch date fields.**
   Verify format per network: `native_ad.post_date` = `yyyy-MM-dd HH:mm:ss`, `domain_registered_date` = `yyyy-MM-dd`.
   Use `esDocBuilder.coerceEsDate()` pattern (or inline) to format dates correctly per field.

4. **NAS key format.**
   Keys follow `{type}/{YYYYMM}/{id}.{ext}` where type = BLACKHAT or WHITEHAT.
   Network name and ad ID are used by `nasService.uploadToNAS()`. Should work as-is.

5. **Missing tables.** If `native_country_data` or similar tables don't exist, `getCountryIsoCodes()` falls back gracefully: returns country names as-is, logs a warning. Replicate this pattern.

6. **Foreign key cascades.** Before deleting an ad, check `information_schema.KEY_COLUMN_USAGE` for FK children. Delete them first. Landers doesn't delete, but insertion does — same gotcha applies if you mix patterns.

---

## 9. Status

**Native — DONE & live-tested**
- ✅ Three endpoints: GET (fetch + ES check + status update), POST (upload), POST (insert HTML)
- ✅ All 6 models: NativeAdMetaData, NativeAdDomains, NativeAdUrl, NativeAdOutgoing, NativeAdHtmlLander, NativeCountryData
- ✅ Services: getNativeAdsService, uploadFilesService, insertHtmlContentService
- ✅ Database: native_ad_* tables, native_search_mix ES index, country_data for ISO codes
- ✅ NAS: nasService wrapper in `src/landers/helpers/`
- ✅ Performance: parallel ES checks, batch country ISO lookups, no external API calls
- ✅ Error handling: graceful fallback for missing country_data table
- 📄 Endpoints: `/api/landers/{endpoint}` (legacy) and `/api/v1/native/landers/{endpoint}` (new)

**Other networks — TODO**
Each is a copy-paste + deltas (§7). Start with Native as the template.

---

## 10. Extension guide for adding new networks

### Quick path (under 1 hour):

1. Copy `src/services/native/landers/` → `src/services/{net}/landers/`
2. Update table/column names in models
3. Verify ES index and field names
4. Register routes in `app.js`
5. Test against `pasdev_{net}` database

### Checklist before shipping:

- [ ] `{net}_ad_*` tables exist and columns match
- [ ] `{net}_search_mix` ES index exists and field names match
- [ ] `country_data` table available OR fallback works gracefully
- [ ] NAS folder naming (BLACKHAT/WHITEHAT) is correct
- [ ] Status transition logic is per-network (may differ from Native)
- [ ] No hardcoded "native" strings; use DatabaseManager with network slug
- [ ] Test GET → POST → POST flow end-to-end
- [ ] Verify Elasticsearch updates after each insert

---

## 11. Key files

| Path | Purpose |
|------|---------|
| `src/landers/helpers/nasService.js` | Shared NAS upload wrapper |
| `src/services/native/landers/routes/nativeLandersRoutes.js` | Native endpoint routing |
| `src/services/native/landers/controllers/nativeLandersController.js` | Native request handler |
| `src/services/native/landers/services/*.js` | Native business logic (3 services) |
| `src/services/native/landers/models/*.js` | Native database models (6 models) |
| `src/database/DatabaseManager.js` | Singleton connection manager (shared) |
| `src/app.js` | App startup; registers landers routes |

---

## 12. Conventions

- **Synchronous responses.** All three endpoints return immediately with real results. No background jobs, no webhooks, no queues.
- **Per-network isolation.** Each network's landers are fully independent. Shared code is minimal (DatabaseManager, nasService).
- **Status flow.** Ad status is deterministic: 0 → 2/5 → 1/3/4/6. No bypasses or out-of-order transitions.
- **Error handling.** If a table is missing, log and return a graceful fallback (or empty result), don't crash.
- **Testing.** Before shipping, test all three endpoints in sequence with real database and Elasticsearch.

---

## Document Version

- **v1.0** — Initial manifest, based on Native implementation
- **Last updated:** 2026-06-09
- **Maintained by:** Development team
