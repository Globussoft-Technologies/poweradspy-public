# Quora Landers – Implementation Manifest

> Companion to `REDDIT_LANDERS_MANIFEST.md` and `PINTEREST_LANDERS_MANIFEST.md`.
> This file documents the **Quora landers** as built and verified in `pas_node_api`.
> It follows the **Facebook/Reddit landers layout** (repository.js, services under landers/, NAS via nasClient).
>
> **Source of truth for behaviour** = the Quora PHP in `api_quora` (`BlackhatController@getPinterestAdsWithCounrty`,
> `@uploadBlackhatContent`, `@insertHtmlContentToDB`). Faithful port with bug fixes.
>
> **Status: IMPLEMENTED & VERIFIED** against live `pasdev_quora` (MySQL) + Elasticsearch.
> The node service slug is **`quora`**.

---

## 0. Golden Rules (as Implemented)

1. **Three-endpoint pipeline.** fetch ads → upload files → insert HTML. Synchronous.
2. **Schema.** MySQL `pasdev_quora` (`quora_ad_*` tables) = system of record; Elasticsearch = searchable projection.
3. **DatabaseManager singleton.** `service.db` injected by `ServiceRegistry` for slug `quora`.
4. **NAS upload.** Uses `src/insertion/helpers/nasClient.js` `storeInNas` directly (status 1→BLACKHAT, 2→WHITEHAT).
5. **Per-ad ES validation.** Fixed: was bulk-updating all ads before ES check → now validates each ad individually.
6. **Per-ad ISO handling.** Fixed: was cumulative (Ad2 got [Ad1_iso, Ad2_iso]) → now per-ad only.

---

## 1. Endpoints

Auto-mounted under `/api/v1/quora` (no auth). Legacy endpoint names preserved.

| Method | Path | PHP Origin |
|--------|------|-----------|
| GET | `/api/v1/quora/landers/get-ads-for-lander` | `BlackhatController@getPinterestAdsWithCounrty` |
| POST | `/api/v1/quora/landers/upload-lander-image-zip` | `BlackhatController@uploadBlackhatContent` |
| POST | `/api/v1/quora/landers/insert-lander-details-todb` | `BlackhatController@insertHtmlContentToDB` |

---

## 2. Directory Layout

```
src/services/quora/
├── routes/quoraRoutes.js                          ← main Quora routes (auto-mounted)
├── landers/
    ├── quoraLandersRoutes.js                      ← landers-specific routes + multer
    ├── quoraLandersController.js                  ← thin wrapper
    ├── repository.js                              ← SQL abstraction
    ├── getAdsService.js                           ← get-ads-for-lander
    ├── uploadService.js                           ← upload-lander-image-zip
    ├── insertHtmlService.js                       ← insert-lander-details-todb
```

---

## 3. Key Bug Fixes

1. **Per-ad ES validation:** Was updating all ads to status 2 before ES check. Now validates each ad individually.
2. **ISO accumulator:** Was cumulative across all ads. Now tracks per-ad only.
3. **Multer directory:** Now auto-creates `/tmp/quora-landers/` with `fs.mkdirSync`.
4. **ES check on insert:** Now returns error (400) if ad not found instead of silently continuing.

---

## 4. Database Tables

| Table | Ad-id Column | Role |
|-------|--------------|------|
| `quora_ad_meta_data` | `quora_ad_id` | status machine, paths, dates |
| `quora_ad_domains` | `id` (PK) | domain + registration date |
| `quora_ad_url` | `quora_ad_id` | redirect + destination urls |
| `quora_ad_outgoing_links` | `quora_ad_id` | source/redirect/final chains |
| `quora_ad_html_lander_content` | `quora_ad_id` | HTML lander content |
| `quora_ad` | `id` | main ad table |

---

## 5. Status: IMPLEMENTED & VERIFIED

- ✅ All 3 endpoints working
- ✅ Per-ad ES validation verified
- ✅ Per-ad ISO handling verified
- ✅ Multi-table transactional updates
- ✅ JSON array path storage
- ✅ Bug fixes applied

---

**Version: v1.0** – Quora landers with critical bug fixes.
