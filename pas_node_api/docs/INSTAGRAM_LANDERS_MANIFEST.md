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

## 4. Database Tables

| Table | Ad-id Column | Role |
|-------|--------------|------|
| `instagram_ad_meta_data` | `instagram_ad_id` | status machine, paths, dates |
| `instagram_ad_domains` | `id` (PK) | domain + registration date |
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

---

**Version: v1.0** – Instagram landers fully implemented with per-ad validation.
