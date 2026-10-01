# KT — Insertion Process (Complete Reference)

> Knowledge-transfer doc for the ad-insertion subsystem: the full flow, exactly
> **what data goes to which table/column/NAS/ES, how, and when (insert vs update)**,
> plus verify & debug queries. Companion to [MANIFEST.md](MANIFEST.md) (which is the
> "how to build a new network" guide) and the PHP-SPEC-*.md files (exact legacy behaviour).
>
> **Ad networks:** facebook, instagram, gdn, youtube, google, native, linkedin, reddit, quora, pinterest, tiktok.
> **DONE (live): Facebook** (§1–§11 reference) **+ Instagram** (deltas in §12) **+ Native** (by teammate;
> separate KT: [NATIVE-INSERTION-API-KT.md](../NATIVE-INSERTION-API-KT.md)). Remaining ones follow MANIFEST §7.

---

## 1. Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/v1/facebook/insertion/metaAdsData` | Insert/Update a scraped ad | `x-signature` HMAC OR `platform == "12"` |
| POST | `/api/v1/facebook/insertion/adsLibrary` | Insert/Update an Ad-Library ad | same |
| POST | `/api/v1/facebook/insertion/delete` | Delete ad (SQL + ES) | `x-delete-token` header / body `token` |

Body = a single ad object, a bare array, or `{ "ads": [...] }`. Response always has
`code`, `status` (`ok`/`rejected`/`server_error`/`partial`), `message`, optional `hint`/`warning`/`errors`.

---

## 2. Request lifecycle (metaAdsData)

```
1. Middleware: insertionEnabled(facebook)  → 403 if disabled
                insertionAuth              → 401 if bad signature/platform
2. Controller  → parse body (single/array) → InsertionEngine.run(payload, processMetaAd)
3. processMetaAd(ad):
   a. ad_id null check
   b. validate(ad)            (skip if socionator==1)
   c. VIDEO: LCS≤views + thumbnail_url required
   d. version check (platform 2/5/6)
   e. PARALLEL: resolveUser + getAdByAdId + translate()   ← network calls overlap
   f. branch on existence → INSERT or UPDATE
4. After DB commit: media uploads (post-owner + ad image/video + carousel) run in PARALLEL
5. Elasticsearch index (search_mix) + fire-and-forget ADGPT
6. Respond in ms
```

`adsLibrary` is the same shape with Ad-Library extras (page details, ISO→country, avg impression). `delete` = token → resolve id → cascade SQL delete → ES delete.

---

## 3. INSERT — table-by-table (what is written, from where)

> All in a single SQL transaction (relaxed `sql_mode`). Dimension rows are upserted
> (reused if they already exist), then `facebook_ad`, then children. Media + ES happen AFTER commit.

| # | Table | When | Key columns ← source |
|---|---|---|---|
| 1 | `facebook_users` | read (resolve discoverer); platform 11 sets `ads_info_status=11` | lookup by `facebook_id` |
| 2 | `facebook_ad_post_owners` | upsert by `post_owner_lower` (generated col) | `post_owner_name`←post_owner, `post_owner_image`/`original_post_owner_image`←(NAS, after commit), `ads_count`+1, `verified`, `image_updated` |
| 3 | `facebook_call_to_actions` | upsert by `action` | `action`←call_to_action, `count`+1 |
| 4 | `facebook_category` | upsert by `category_name` | `category_name`←category (library: page_details.page_category) |
| 5 | `country_only` | upsert by `country` | `country`←country[] names |
| 6 | `country` | upsert by city/state/country | `city`,`state`,`country`,`country_only_id` |
| 7 | `facebook_ad_domains` | upsert by `domain` | `domain`← host(destination_url) minus www |
| 8 | `facebook_ad` | **insert** (main row) | see §3a |
| 9 | `facebook_meta_ad_budget` | insert if `meta_ad_id` | `facebook_ad_id`, `meta_ad_id`, `lowerBudget`, `upperBudget` |
| 10 | `facebook_ad_variants` | insert + (image_url after commit) | `title`,`text`,`newsfeed_description`←payload; `image_url_original`←image_video_url (original URL); `image_url`←NAS path (image OR video-thumbnail) |
| 11 | `facebook_ad_analytics` | insert today's row | `likes`,`comments`,`shares`,`impression`,`popularity`(int),`engagement_rate`,`date`,`hits=1` |
| 12 | `facebook_comments` | if `comments_data` | `comment_data`←json |
| 13 | `facebook_ad_image_video` | if `other_multimedia` (after commit) | `ad_type`←type, `ad_image_video`←JSON array of carousel NAS paths |
| 14 | `facebook_ad_countries` / `_countries_only` | bulk per country | `facebook_ad_id`, `country_id`/`country_only_id`, `count` |
| 15 | `facebook_ad_users` | insert/upsert by (ad,user) | `count`+1, `platform`, `userid_status` (platform 3) |
| 16 | `facebook_ad_meta_data` (PK=facebook_ad_id) | insert if absent | `destination_url`, `built_with_status`(4 if no dest), `firstSeenOn*`(by source), `screenshot_url='processing.gif'`, `platform`, `ad_url`, `version`, `lcs_status=5`; library: `meta_ad_url`,`est_audience_size_*`,`active_status`,`ad_run_platforms`,`EUT` |
| 17 | `facebook_translation` (upsert by facebook_ad_id) | always | `ad_title`,`ad_text`,`news_feed_description` (translated copy) |
| 18 | `facebook_lib_page_details` (library only) | insert if absent + back-ref | `gender_details`,`age_details`,`page_name`,`platform_used`,`impression_low/high`,`page_category`,`facebook_ad_id` |
| 19 | `facebook_accounts_activities` (platform 10) | insert | `system_id`,`facebook_ad_id`,`platform`,`is_unique=1` |
| 20 | `Users_Request` (if user_request_id) | updateRequestedStatus | `keyword/advertiser/url_status`, `sent_status`, `meta_sync_count` |

### 3a. `facebook_ad` main row columns
`category_id, call_to_action_id, domain_id, country_id, country_only_id, post_owner_id,
default_variant_id, default_analytics_id, discoverer_user_id, likes, comments, shares,
source(='desktop'), post_date/first_seen/last_seen (DATETIME 'YYYY-MM-DD HH:MM:SS'),
days_running, lower_age_seen, upper_age_seen, type, platform, ad_id, ad_position
('VIDEO FEED'→'VIDEOFEED'), language_id, status, hits=1, views(VIDEO), impression(int),
proxy_status(←country_status), popularity(int), System_id(platform 10)`.
Library adds `collation_id`; defaults language_id=1, lower/upper_age 18/65.

---

## 4. UPDATE — what changes when the ad already exists

Triggered when `getAdByAdId(ad_id)` finds the ad. NOT a fresh insert — it refreshes:

| Table | Update |
|---|---|
| `facebook_ad` | `last_seen`, `days_running`, `hits` (recompute), and (from analytics) `likes/comments/shares/impression/popularity/default_analytics_id/views` |
| `facebook_ad_analytics` | last row updated (10% tolerance) OR new row for a new day; sets impression/popularity/engagement |
| `facebook_ad_post_owners` | `verified`; image re-uploaded if provided |
| `facebook_ad_users` | `count`+1 (+ userid_status platform 3) |
| `facebook_ad_meta_data` | `built_with_status=4` if no destination_url |
| `facebook_ad_variants` | `image_url`/`image_url_original` if media re-uploaded (only when stored image is missing/DefaultImage) |
| `facebook_meta_ad_budget` | insert if a NEW meta_ad_id |
| `country` / `country_only` / `facebook_ad_countries_only` | upsert |
| `facebook_translation` | upsert |
| `facebook_ad_image_video` | upsert carousel (if re-uploaded) |
| Elasticsearch | **delete old doc** (by `_id` via `searchID`) then **re-index** |

> If you re-send the EXACT same payload, only `hits`/analytics change (LCS/last_seen are identical) — that's expected, not "nothing updating".

---

## 5. DELETE — cascade

`processDelete({id} or {ad_id})`:
1. Resolve internal `facebook_ad.id` (from `id`, or `ad_id` lookup).
2. SQL transaction: delete from `facebook_html_content, facebook_translation, facebook_ad_analytics, facebook_ad_countries, facebook_ad_countries_only, facebook_ad_image_video, facebook_ad_meta_data, facebook_ad_outgoing, facebook_ad_users, facebook_ad_variants, facebook_comments, facebook_ad_bug_report` (missing tables skipped), then `facebook_ad`.
3. Elasticsearch: find `_id` by `facebook_ad.id` → delete from `search_mix`.

---

## 6. NAS media storage (media.globussoft.com + video endpoint)

Two endpoints (both config-driven — `config.insertion.nas`, no hardcoding):
- **Images/thumbnail/postowner/carousel** → `mediaUrl` + `mediaUploadPath` (= `/{bucket}/upload`), Bearer token, key in form.
- **Video file** → `videoUrl` + `videoUploadPath` (= `/upload`), multipart `network/file/adid`.

| Upload type | Endpoint | Key / path | Stored in |
|---|---|---|---|
| Ad image (IMAGE) | media | `fb/adImage/<YYYYMM>/<adId>.jpg` | `facebook_ad_variants.image_url` + ES `new_nas_image_url`,`facebook_ad.s3_path` |
| Video thumbnail (VIDEO) | media | `fb/thumbnail/<YYYYMM>/<adId>.jpg` | `facebook_ad_variants.image_url` + ES `Thumbnail` |
| Video file (VIDEO) | **video** | `<adId>.mp4` | **ES `nas_video_url` only** (NOT in SQL — PHP commented it out) |
| Post-owner image | media | `fb/postowner/<YYYYMM>/<postOwnerId>.jpg` | `facebook_ad_post_owners.post_owner_image` + ES `facebook_ad_post_owners.post_owner_image` |
| Carousel / other_multimedia | media | `fb/otherMultiMedia/<YYYYMM>/<adId>_<i>.jpg` | `facebook_ad_image_video.ad_image_video` (JSON array) + ES `othermedia` |

Notes:
- **Filename = the entity id** (adId for ad media; post_owner_id for post-owner image). NOT random.
- Network → folder prefix (`fb`/`insta`/`pint`/`gt`/`yt`/…) in `nasClient.NAS_KEY_PREFIX`.
- NAS returns `path` (e.g. `/pas-dev/stream/fb/adImage/202605/130721.jpg`) — that's what we store. The CDN (`config.cdn.baseUrl`) is prepended on read.
- `image_url_original` always holds the ORIGINAL source URL (the scraped facebook CDN URL).
- Failure / un-downloadable source → `/DefaultImage.jpg` + a `warning` in the response (not a crash).

---

## 7. Elasticsearch (`search_mix`) document

Built from the `getJoinedAd` denormalized row via `esDocBuilder` using the column
template (`esColumns.META_INSERT_COLUMNS` / `LIBRARY_INSERT_COLUMNS`).

- `"table.field"` → `body["table.field"] = row[field]`; `|langs` fans out into `_ru/_fr/_sp/_ge/_exactly` copies.
- Synthetic: `html`(title+text+newsfeed), `mixdata`(+comment_data), `facebook_user_countries`(GROUP_CONCAT), `lang_detect`.
- Extra (added on top): `Thumbnail`/`new_nas_image_url`/`s3_path` (media), `nas_video_url` (video), `othermedia` (carousel array), `facebook_ad.popularity` ({max,current}), `engagement_rate`, `image_url_original`, `facebook_ad_post_owners.post_owner_image`, plus library’s page/budget/category fields.
- **Date fields** must match the ES mapping format: `post_date`/`last_seen`/`firstSeenOn*`/`page_created_date` = `yyyy-MM-dd HH:mm:ss`; `domain_registered_date` = `yyyy-MM-dd`. `esDocBuilder.coerceEsDate` handles Date objects / zero dates / nulls.
- INSERT reuses an existing `_id` if present (replace in place); UPDATE deletes then re-indexes.
- **Carry-over (UPDATE only):** before delete, the old doc's cron/scraper-populated ES-only fields are read and re-added so they aren't wiped: `facebook_ad_outgoing_links.{source_url,redirect_url,final_url}`, `facebook_ad_url.{url_redirects,url_destination,country_code}`, `nas_video_url`, and `<translationField>.ar/.pt/.fr` (config `insertion.translationField` = `facebook_translations`, PHP `TRANSLATION_FEILD`). Fresh values take precedence; carry-over only fills gaps.
- Note: PHP `TRANSLATE_API` (`language-localization`) is **dead/unused** — only `LANGUAGE_TRANSLATION_API` (→ `translationUrl`) is used.

---

## 8. External APIs (config.insertion.api)

| API | Purpose | When | Critical? |
|---|---|---|---|
| translation (`translationUrl`) | detect language + translate copy | before branch | metaAds: **critical** (503 if down, unless `translationRequired=false`); library: best-effort |
| impression (`impressionUrl`) | impressions + engagement_rate | insert + update | tolerated (0 on fail); short-circuits to 0 when LCS+views all 0 |
| popularity (`popularityUrl`) | popularity_percentage → `{max,current}` | insert + update | tolerated |
| adgpt (`adgptInsertionUrl`) | external data push | after index | fire-and-forget (~100ms) |

impression & popularity run in PARALLEL; translation overlaps the DB lookups.

---

## 9. Config reference (`config.json → insertion`)

```jsonc
"insertion": {
  "concurrency": 8,                  // parallel ads within one array request
  "useWorkerThreads": false,         // RESERVED (not wired; use cluster for cores)
  "secretKey": "",                   // x-signature HMAC (else env INSERTION_SECRET_KEY)
  "signatureHeader": "x-signature",
  "allowPlatformBypass": "12",
  "deleteToken": "",                 // delete endpoint (else env API_DELETE_TOKEN)
  "nas": {
    "videoUrl": "https://nas-video-api.poweradspy.com",
    "videoUploadPath": "/upload",
    "mediaUrl": "https://media.globussoft.com",
    "mediaUploadPath": "/{bucket}/upload",   // {bucket} → pas-dev / pas-prod
    "mediaToken": "ak_...:sk_...",
    "bucket": "pas-dev",             // or empty → env-derived
    "verifyTls": false, "timeoutMs": 60000
  },
  "api": {
    "translationUrl": "...", "translationRequired": true,
    "impressionUrl": "...", "popularityUrl": "...",
    "adgptInsertionUrl": "", "adgptTimeoutMs": 100, "timeoutMs": 15000
  }
}
```
Per-network on/off: `networks.<net>.insertion.enabled`. Multi-core: `cluster.enabled=true`.
Every empty field falls back to its env var.

---

## 10. Verify & debug

**SQL — did the ad + media store?**
```sql
SELECT fa.id, fa.ad_id, fa.type, fa.last_seen, fa.hits, fa.impression, fa.popularity,
       po.post_owner_image, v.image_url, v.image_url_original, iv.ad_image_video
FROM facebook_ad fa
LEFT JOIN facebook_ad_post_owners po ON po.id = fa.post_owner_id
LEFT JOIN facebook_ad_variants v     ON v.facebook_ad_id = fa.id
LEFT JOIN facebook_ad_image_video iv ON iv.facebook_ad_id = fa.id
WHERE fa.id = <id>;
```
- `image_url` = NAS path (image, or video THUMBNAIL). `image_url_original` = original source URL.
- `ad_image_video` = JSON array of carousel NAS paths.
- `/DefaultImage.jpg` = upload failed (source URL likely expired).

**Elasticsearch — is the doc + media there?**
```
GET search_mix/_search { "query": { "term": { "facebook_ad.id": <id> } } }
```
Check `_source`: `nas_video_url` (video), `othermedia` (carousel array), `Thumbnail`/`new_nas_image_url`, dates in `yyyy-MM-dd HH:mm:ss`.

**Check a date field's required format:** `GET search_mix/_mapping/field/*`

**Common results**
- `warning: "...image could not be stored"` → source URL un-downloadable (expired `oe=` token) → DefaultImage. Not a code bug.
- `503 translation unavailable` → translation API down; set `translationRequired=false` to bypass (metaAds).
- `402 duplicate` → ad_id already exists (use update by re-sending — it routes to UPDATE automatically).

---

## 11. Gotchas

See [MANIFEST.md §9](MANIFEST.md) for the full list (strict MySQL sql_mode, DATETIME columns,
generated `post_owner_lower`, NOT-NULL defaults via stripNulls, popularity INT, ES date formats,
NAS id-based filenames, post_owner image named by post_owner_id, translation criticality,
expired CDN URLs). Read it before debugging a new network.

---

## 12. Instagram (deltas vs Facebook)

Self-contained under `src/services/instagram/` (own esDocBuilder/esColumns/repository/validate/
normalize/postOwner/pipelines/controllers/routes). Same process & optimizations as Facebook
(§2–§8) — only the data placement below differs. Full spec: [PHP-SPEC-instagram.md](PHP-SPEC-instagram.md).

### Endpoints
| Method | Path | PHP |
|---|---|---|
| POST | `/api/v1/instagram/insertion/gramAdsData` | `InstagramUserController@instaAdsData` |
| POST | `/api/v1/instagram/insertion/adsLibrary` | `@adsLibraryInsert` |
| POST | `/api/v1/instagram/insertion/delete` | `@deleteads` |

### Table map (facebook → instagram)
`facebook_ad`→`instagram_ad`, `_variants`/`_analytics`/`_post_owners`/`_countries`/`_countries_only`/
`_image_video`/`_users`/`_meta_data`→`instagram_ad_*`, `facebook_call_to_actions`→**`instagram_call_to_action`**
(col **`call_to_action`**), `facebook_ad_domains`→**`instagram_ad_domain`**, `country`/`country_only`→
**`instagram_country`/`instagram_country_only`** (network-specific), `facebook_translation`→**`instagram_ad_translation`**,
`facebook_users`→**`instagram_user`** (lookup by `instagram_id`), `facebook_lib_page_detail`→**`instagram_page_details`**,
budget→`instagram_meta_ad_budget`, activities→`instagram_accounts_activities`. **Library-only:**
**`instagram_ad_cost_usage_benefit_analysis`** (audience/EUT). All child FKs are `instagram_ad_id`.

### `instagram_ad` column differences (the ad-row builder)
- **NO `platform`** column (platform → `instagram_ad_meta_data`); **NO `proxy_status`**, **NO `destination_scraper_status`**.
- Has `ad_type` (STORIES: 1=image/2=video), `ad_budget`, `collation_id`, `views`, `System_id`.
- gramAdsData: `first_seen`/`last_seen` = NOW() (PHP), `post_date` = epoch→datetime, `hits=0`, ages from payload, impression/popularity from API. adsLibrary: `first_seen`/`last_seen` from payload, `post_date` payload or `0000-00-00 00:00:00`, ages 18/65, `hits=1`, impression = avg(impressions_high,low), no discoverer.

### Where media/data lands
- Same NAS rules (§6) but folder prefix **`insta`** (`insta/adImage/<YYYYMM>/<id>.jpg`). Video file → `nas_video_url` (ES only); thumbnail → `instagram_ad_variants.image_url`; carousel → `instagram_ad_image_video.ad_image_video` + ES `othermedia`; post-owner image → `instagram_ad_post_owners.post_owner_image` (dedup by **`post_owner_name`**, not lower).
- **Carousel / other_multimedia (IMAGE only, insert + update):** stored in `instagram_ad_image_video.ad_image_video` (JSON array of NAS paths) + ES `othermedia`. `ad_type` is `enum('IMAGE','VIDEO')`. ⚠️ The shared `mediaUpload.uploadMultimedia` returns the id under the legacy key **`facebook_ad_id`** — `repo.upsertAdImageVideo` accepts `instagram_ad_id ?? facebook_ad_id`, else the SQL row is silently skipped (ES still gets it). The UPDATE path also stores the carousel (image already on NAS → still refresh `instagram_ad_image_video`).
- `instagram_ad_meta_data` has its own `id` PK + `instagram_ad_id` FK (Facebook's PK was facebook_ad_id).
- Library audience/EUT/meta_ad_url → `instagram_ad_cost_usage_benefit_analysis`; page gender/age/category → `instagram_page_details`.

### ES (`instagram_search_mix`)
- Field keys prefixed **`instagram_*`** (e.g. `instagram_ad.id`, `instagram_user.gender`, `instagram_call_to_action.call_to_action`, `instagram_ad_domain.domain_registered_date`, `instagram_ad_translation.*`).
- Date fields: `instagram_ad.post_date`/`last_seen`/`instagram_ad_meta_data.firstSeenOn*` = `yyyy-MM-dd HH:mm:ss`; `instagram_ad_domain.domain_registered_date` = `yyyy-MM-dd`; **`instagram_ad.created_date` = ISO `yyyy-MM-ddTHH:mm:ss`** (no explicit format → strict_date_optional_time; esDocBuilder `'iso'` kind).
- Carry-over on UPDATE: `instagram_ad_outgoing_links.*`, `instagram_ad_url.*`, `<translationField>.ar/.pt/.fr`, `nas_video_url`, `new_nas_image_url`.

### Delete (cascade)
`instagram_ad` has `ON DELETE RESTRICT` FKs — `deleteAdCascade` removes all FK children first, then the main row. FK children (from information_schema): `instagram_ad_analytics, instagram_ad_categories, instagram_ad_image_video, instagram_ad_meta_data, instagram_ad_translation, instagram_ad_url, instagram_ad_variants, instagram_hidden_ads (col ad_id), instagram_user_affiliate_ads` (+ other child data). `instagram_user` has no `ads_info_status` (select only `id`).

### Payload specifics
- **gramAdsData:** discoverer by `instagram_id` (or platform 3 country fallback → `userid_status=1`); `type` ∈ IMAGE/VIDEO/**STORIES**; `country` is a **single string**; `ad_url` required.
- **adsLibrary:** `country` is an **array of ISO codes** → names via `country_data.instagram_country_iso` (`["ALL"]` = all); `verified`/`EUT`/`ad_run_platforms` required; no user resolution.

### Verify
```sql
SELECT * FROM pasdev_instagram.instagram_ad WHERE ad_id = '<id>';
-- ES: GET instagram_search_mix/_search {"query":{"term":{"instagram_ad.id":<internalId>}}}
```
