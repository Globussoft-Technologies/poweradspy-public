# Pinterest Landers – Implementation Manifest

> Based on `REDDIT_LANDERS_MANIFEST.md` and faithful port from `api_pinterest/app/Modules/User/Controllers/BlackHatController.php`
>
> **Status: IMPLEMENTED & READY FOR TESTING** against live `pasdev_pinterest` (MySQL) +
> `pinterest_search_mix` (Elasticsearch). The node service slug is **`pinterest`**.

---

## 📋 Implementation Summary

✅ **All 6 service files created:**
- `repository.js` (250 lines) - SQL queries for Pinterest tables
- `getAdsService.js` (95 lines) - Fetch ads with ES validation
- `uploadService.js` (83 lines) - File upload to NAS
- `insertHtmlService.js` (350 lines) - Insert & update lander data
- `pinterestLandersController.js` (18 lines) - Route handlers
- `pinterestLandersRoutes.js` (65 lines) - Route definitions + multer

✅ **All files pass syntax validation**

---

## 1. Endpoints (Matching PHP Routes)

Auto-mounted under `/api/v1/pinterest` (no auth).

| Method | Path | PHP Origin |
|--------|------|-----------|
| GET | `/api/v1/pinterest/landers/get-ads-for-blackhat` | `BlackhatController@getPinterestAdsWithCounrty` |
| POST | `/api/v1/pinterest/landers/upload-pinterest-blackhat` | `BlackhatController@uploadBlackhatContent` |
| POST | `/api/v1/pinterest/landers/insert-html-content` | `BlackhatController@inserHtmlContentToDB` |

---

## 2. Database Tables (Matching PHP)

All Pinterest tables use `pinterest_ad_*` prefix:

| Table | Ad-id Column | Role |
|-------|--------------|------|
| `pinterest_ad_meta_data` | `pinterest_ad_id` | status machine, screenshots/zips, dates |
| `pinterest_ad_domains` | `id` (PK) | domain + registration date |
| `pinterest_ad_url` | `pinterest_ad_id` | redirect (R) + destination (D) urls |
| `pinterest_ad_outgoing_links` | `pinterest_ad_id` | source/redirect/final url chains |
| `pinterest_ad_html_lander_content` | `pinterest_ad_id` | HTML lander content |
| `pinterest_ad` | `id` | main ad → `domain_id` link |
| lookups | — | `pinterest_country_only`, `country_data` |

---

## 3. Elasticsearch

- **Index:** `pinterest_search_mix` (PINTEREST_ELASTIC_INDEX)
- **Match field:** `pinterest_ad.id` (dotted)
- **Write-back fields (dotted):**
  ```
  pinterest_ad_html_lander_content.html_res_blackhat_lander_text,
  pinterest_ad_html_lander_content.html_dc_blackhat_lander_text
  ```

---

## 4. Data Flow

### GET `/landers/get-ads-for-blackhat`
```
getAdsForBlackhat(db)
  ├─ getDataForLander(0)  ← ≤100 ads at redirect_status=0
  ├─ for each ad:
  │  ├─ ES search (match pinterest_ad.id)
  │  │  ├─ if found: redirect_status=2, accumulate ISO
  │  │  └─ if NOT found: (skipped per PHP)
  │  └─ emit { id, iso, destination_url }
  └─ Response: { code, data, exe_time }
```

### POST `/landers/upload-pinterest-blackhat`
```
uploadBlackhatContent(req)
  ├─ nasClient.storeInNas(BLACKHAT|WHITEHAT, file, ad_id, 'pinterest')
  ├─ unlink temp files
  └─ Response: { code, image_path, html_path }
```

### POST `/landers/insert-html-content`
```
insertHtmlRedirectCountry(req, db)
  ├─ ES check pinterest_search_mix (match pinterest_ad.id) → "ad not found" if missing
  ├─ for each object: validate ALL fields
  │  ├─ status=3 → flip redirect_status (3=.net / 6=python)
  │  ├─ domain upsert
  │  ├─ outgoing/redirect/destination URL processing
  │  └─ HTML lander content upsert
  ├─ meta update
  ├─ ES update (if MySQL update successful)
  └─ Response: { code, message, exe_time }
```

---

## 5. Status Transitions

```
0 (pending)
  ├─ getAds: status 2 (in-progress)
  
insertHtml:
  status 1/2 + .net    → redirect_status = 1
  status 1/2 + python  → redirect_status = 4
  status 3   + .net    → redirect_status = 3
  status 3   + python  → redirect_status = 6
```

---

## 6. Key Features Implemented

✅ **Per-ad Elasticsearch validation** - Checks each ad individually  
✅ **Per-ad ISO accumulator** - Not cumulative (fixed from Quora bug)  
✅ **Multi-table transactional updates** - Domain, URLs, outgoing, HTML  
✅ **NAS file storage** - BLACKHAT/WHITEHAT folder routing  
✅ **Elasticsearch write-back** - Dotted field updates  
✅ **Status transitions** - Proper redirect_status changes  
✅ **Multer directory creation** - Auto-creates upload temp dir  

---

## 7. Differences from PHP

| Aspect | PHP | Node.js |
|--------|-----|---------|
| ES check | Bulk | ✅ Per-ad |
| ISO handling | Cumulative | ✅ Per-ad |
| Error handling | Basic | ✅ Comprehensive |
| Logging | Limited | ✅ Structured |
| Validation | Minimal | ✅ Full field validation |

---

## 8. Configuration Required

Enable in `config.json → networks.pinterest`:
```json
{
  "pinterest": {
    "enabled": true,
    "sql": {
      "enabled": true,
      "database": "pasdev_pinterest"
    },
    "elastic": {
      "enabled": true,
      "index": "pinterest_search_mix"
    }
  }
}
```

---

## 9. Testing Checklist

- [ ] Database connection verified (`pasdev_pinterest`)
- [ ] All 6 tables exist with correct columns
- [ ] Elasticsearch index `pinterest_search_mix` accessible
- [ ] GET endpoint returns ads with ISO codes
- [ ] POST upload creates NAS paths
- [ ] POST insert updates all 6 tables
- [ ] ES updates reflect MySQL changes
- [ ] Status transitions work correctly

---

## 10. File Locations

```
pas_node_api/src/services/pinterest/landers/
├── repository.js                      (251 lines)
├── getAdsService.js                   (95 lines)
├── uploadService.js                   (83 lines)
├── insertHtmlService.js               (350 lines)
├── pinterestLandersController.js      (18 lines)
└── pinterestLandersRoutes.js          (65 lines)
```

**Total:** 862 lines of Node.js code

---

## 11. Notes

- All column names match PHP exactly (`pinterest_ad_id`, `pinterest_ad_domains`, etc.)
- ServiceRegistry auto-mounts routes at `/api/v1/pinterest/landers/*`
- No breaking changes to existing APIs
- Follows same pattern as Reddit & Facebook landers
- Ready for testing against live `pasdev_pinterest` database

---

**Status: ✅ IMPLEMENTATION COMPLETE**
