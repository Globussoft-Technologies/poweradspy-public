# Insertion Subsystem — Developer Manifest

> **Read this first.** It is a self-contained guide to the ad-insertion subsystem.
> A developer (or an AI agent) can implement a NEW network end-to-end from this file
> alone, reusing all shared code — see §7 for the mechanical recipe and §9 for the
> environment gotchas already solved during Facebook.
>
> Source of truth for behaviour = the GDN PHP in `api_gdn`
> (`GdnAdController@insertAds`, `UserController@deleteads`), mapped in [PHP-SPEC-gdn.md](PHP-SPEC-gdn.md).
>
> **For the complete data-flow (what goes to which table/column/NAS/ES, insert vs update,
> verify & debug queries) see [KT-INSERTION-PROCESS.md](KT-INSERTION-PROCESS.md).**
>
> **Ad networks** (the platforms we insert for): facebook, instagram, gdn, youtube, google, native,
> linkedin, reddit, quora, pinterest, tiktok.
> **DONE (live): Facebook, Instagram, Native, GDN** (Native = adsData + delete; by teammate). The remaining ones
> (youtube, google, linkedin, reddit, quora, pinterest, tiktok) are thin layers on the shared
> engine — copy a done network's `src/services/<net>/` and adjust the deltas (§7). Each network is self-contained.

---

## 0. Golden rules

1. **Synchronous, fast response.** Every request returns the real per-ad result in ms. NO background/cross-request buffering. A single ad never waits on a batch.
2. **Don't touch existing read/search code.** Insertion is an additive, parallel flow — only add files.
3. **No duplicated logic across networks.** Shared things (engine, NAS, HTTP, post-owner upsert, ES builder, repository pattern) live in shared modules. If you copy a function into a 2nd network, promote it to `src/insertion/`.
4. **Config-driven.** Concurrency, secrets, NAS/API endpoints, per-network on/off — all in `config.json`, never hard-coded.
5. **Faithful to PHP**, but FIX the known PHP hazards (early commit, stray rollbacks, raw-string error returns) — see specs §11.

---

## 1. Endpoints

| Method | Path | PHP origin |
|---|---|---|
| POST | `/api/v1/gdn/insertion/gdnAdsData` | `GdnAdController@insertAds` |
| POST | `/api/v1/gdn/insertion/delete` | `UserController@deleteads` |

GDN live. `gdnAdsData` is one endpoint for **both insert and update** (new `ad_id` → INSERT, existing `ad_id` → UPDATE). Each accepts a **single ad object**, a bare **array**, or `{ "ads": [...] }`.

---

## 2. Is it multithreaded? (throughput model)

Insertion is **I/O-bound** (DB, Elasticsearch, NAS, HTTP) — not CPU-bound. Throughput comes from **three layers**, and **every network inherits all three automatically** (they share the engine + server):

1. **Cluster (real multi-core)** — `server.js` forks N worker **processes** (one per core) when `config.cluster.enabled = true`. This is the primary "multithreading". *Currently disabled in config — enable for production.*
2. **Async event loop** — each process handles thousands of concurrent requests (Node's core model).
3. **Per-request parallelism** — `InsertionEngine` runs a multi-ad batch with bounded concurrency (`config.insertion.concurrency`), and within one ad the independent network calls run in parallel (translation overlaps DB lookups; impression‖popularity; post-owner-image‖ad-image uploads after commit).

> **`config.insertion.useWorkerThreads` is RESERVED / not wired.** OS worker_threads only help CPU-heavy work, which this isn't. Leave it `false`. The real lever for cores is `config.cluster.enabled`.

A new network needs **zero** extra work to be "multithreaded" — it runs under the same cluster + engine.

---

## 3. Directory layout (actual)

```
src/
├─ config/
│   ├─ index.js          → parses config.insertion (concurrency, secret, deleteToken, nas, api)
│   └─ networks.js       → per-network insertion.enabled
├─ middleware/
│   ├─ insertionAuth.js  → x-signature HMAC + platform bypass   (PHP InsertionAuthentication)
│   ├─ insertionEnabled.js → 403 if networks.<net>.insertion.enabled = false
│   └─ deleteAuth.js     → x-delete-token / body.token guard    (PHP API_DELETE_TOKEN)
│
├─ insertion/                         ★ SHARED — used by ALL networks
│   ├─ InsertionEngine.js             → run(payload, processOne): single/array + bounded concurrency, per-ad isolation
│   └─ helpers/
│       ├─ httpClient.js              → postJson / getJson / postFireAndForget  (PHP postApiCall)
│       ├─ nasClient.js               → storeInNas(type,file,id,network,keyBaseName)  (PHP StoreInNAS2 + NAS doc)
│       ├─ nasUploadQueue.js          → durable on-disk retry queue for failed NAS uploads (enqueueFailedUpload / sweepPending)
│       ├─ mediaUpload.js             → uploadImage/Thumbnail/Video/PostOwner/Multimedia + mediaIssueWarning  (PHP fileUpload)
│       ├─ apiClients.js              → translate / impression / popularity / adgptInsert
│       ├─ responses.js               → ok / updated / rejected / serverError / validationError  (meaningful results)
│       └─ util.js                    → nowDateTime / today / epochToDateTime / toInt
│
└─ services/gdn/                      ← GDN network (self-contained; copy this shape)
    ├─ routes/gdnInsertionRoutes.js        → auto-mounted; guards + 2 endpoints (gdnAdsData, delete)
    ├─ controllers/
    │   ├─ metaAdsDataController.js         → thin: parse → engine → respond (gdnAdsData handler)
    │   └─ deleteAdController.js            → thin
    └─ insertion/
        ├─ validate.js        → Laravel-style rule set (META_ADS_RULES) + ip/not_in checks
        ├─ normalize.js       → urldecode / cleanStr / amp-fix / version checks
        ├─ repository.js      → ALL raw SQL (gdn_* tables) + withTransaction + getJoinedAd + deleteAdCascade
        ├─ esDocBuilder.js    → buildSearchMixDoc / searchIdQuery('gdn_ad.id') + height/width + ES date coercion
        ├─ esColumns.js       → META_INSERT_COLUMNS (the gdn_search_mix field template)
        ├─ metaAdsPipeline.js → processMetaAd: INSERT (processAd) + UPDATE (updateAdsData) branches
        └─ deletePipeline.js  → processDelete: cascade SQL delete + ES delete

docs/  → MANIFEST.md (this) + PHP-SPEC-gdn.md
```

---

## 4. Shared helpers (never duplicate — call these from every network)

| Helper | Key API | Notes |
|---|---|---|
| **InsertionEngine** | `run(payload, processOne, {concurrency})` | single ad → `{batch:false, result}`; array → `{batch:true, results, summary}`. One ad's throw becomes a 500 result, never aborts the batch. |
| **httpClient** | `postJson`, `getJson`, `postFireAndForget` | never throws; `{statusCode,data}` or `{code,message}`. |
| **nasClient** | `storeInNas(type, filePath, id, network, keyBaseName)` | type → subfolder; network → NAS folder prefix (fb/insta/pint/gt/yt/…); filename = `keyBaseName` (the id). Key sent WITHOUT extension — NAS appends the file's real ext. Bearer token, bucket pas-dev/pas-prod. SHORT timeout + quick retries; on failure defers to `nasUploadQueue` and returns the deterministic predicted path (never blocks). |
| **nasUploadQueue** | `enqueueFailedUpload`, `sweepPending` | durable on-disk queue (`data/nas-pending/`): persists the bytes of a failed NAS upload; a background cron (`jobs/nasUploadRetryCron.js`) re-uploads to the same key until it succeeds. Expiry-proof (no re-download), no data loss. |
| **mediaUpload** | `uploadImage/Thumbnail/Video/PostOwner(url,id,network)`, `uploadMultimedia`, `mediaIssueWarning(paths,type)` | downloads to temp → storeInNas → cleanup. Temp file ext comes from the response Content-Type (`mime-types`). NAS-only (PHP S3 was commented out — no AWS SDK needed). |
| **apiClients** | `translate`, `impression`, `popularity`, `adgptInsert` | endpoints from `config.insertion.api`. impression/popularity short-circuit to 0 when LCS+views all 0. popularity returns `{max,current}`. |
| **responses** | `ok(id,msg,extra)`, `updated(id,warning)`, `rejected(code,msg,{hint,errors,field})`, `serverError(code,msg,{hint,error})`, `validationError(errors)` | every result carries `status` (ok/rejected/server_error) + a `hint`. |
| **insertionAuth / insertionEnabled / deleteAuth** | middleware | signature / per-network toggle / delete-token. |
| **repository** (per-network, but identical pattern) | `withTransaction(sql, fn)`, one fn per table op, `getJoinedAd`, `deleteAdCascade`, ES synthetic-field SQL | see §6. Copy + adjust column names per network's schema. |

---

## 5. Configuration

### Global — `config.json → insertion`
```jsonc
"insertion": {
  "concurrency": 8,            // ads processed in parallel within one multi-ad request
  "useWorkerThreads": false,   // RESERVED — not wired (workload is I/O-bound). Use cluster instead.
  "secretKey": "",             // HMAC for x-signature (else env INSERTION_SECRET_KEY)
  "signatureHeader": "x-signature",
  "allowPlatformBypass": "12", // body.platform that skips signature (null disables)
  "deleteToken": "",           // delete endpoint token (else env API_DELETE_TOKEN)
  "nas": {
    "videoUrl":"https://nas-video-api.poweradspy.com", "videoUploadPath":"/upload",
    "mediaUrl":"https://media.globussoft.com", "mediaUploadPath":"/{bucket}/upload",
    "mediaToken":"", "bucket":"pas-dev", "verifyTls":false, "timeoutMs":60000
  },
  "api": {
    "translationUrl":"", "translationRequired":true,   // false = insert even if translation is down
    "impressionUrl":"https://impression.poweradspy.com/get_impressions_and_popularity",
    "popularityUrl":"", "adgptInsertionUrl":"", "adgptTimeoutMs":100, "timeoutMs":15000
  }
}
```
Every empty field falls back to its env var. Parsed in `src/config/index.js`.

### Per-network — `config.json → networks.<net>.insertion.enabled`
```jsonc
"gdn": { "enabled": true, "insertion": { "enabled": true }, "elastic": { "index": "gdn_search_mix" }, "sql": { "database": "pasdev_gdn" } }
```
`false` → that network's insertion endpoints return **403** (read/search unaffected). Env override `<PREFIX>_INSERTION_ENABLED`.

### Multi-core — `config.json → cluster.enabled = true` (production).

---

## 6. The repository pattern (raw SQL — copy per network)

Each network's `repository.js` wraps the DB. Conventions (mirrors the legacy PHP models, see PHP-SPEC-internals §A):
- Every fn takes `exec` first: pass `db.sql` (autocommit, pooled) or a transaction `tx` from `withTransaction`.
- **`withTransaction(sql, fn)`** opens ONE connection, relaxes strict `sql_mode` for that connection (matches the old PHP server), runs `fn(tx)`, commits, restores sql_mode, releases. **A single connection cannot run parallel queries — keep tx queries sequential.** Parallelize only HTTP/upload calls (not DB) inside it.
- `getX` → `{code:200, data:rows}` | `{code:400, data:null}`. `insertX` → inserted id. `updateX` → affected rows.
- Dynamic-column inserts use `stripNulls()` so NOT-NULL columns fall back to DB defaults.
- `getJoinedAd(exec, 'gdn_ad.id', id)` builds the denormalized `gdn_search_mix` row (joined, `ANY_VALUE()` on joined cols for only_full_group_by).
- `deleteAdCascade(exec, id)` deletes all child tables (skipping any that don't exist) then the main row.

---

## 7. Adding a NEW network — mechanical recipe (proven with Instagram)

**Architecture rule (important):** each network is **SELF-CONTAINED** under `src/services/<net>/`.
It keeps its OWN copy of `insertion/{esDocBuilder, esColumns, repository, validate, normalize,
postOwner, *Pipeline, deletePipeline}` + `controllers/` + `routes/`. **Do NOT touch another
network's files** and do NOT try to parameterize one network from another — copy + adjust.
Only `src/insertion/` (InsertionEngine, helpers: httpClient/nasClient/mediaUpload/apiClients/responses/util)
and `src/middleware/` are shared across networks.

Steps:
1. **Extract the PHP VERBATIM** (use an agent) for the network's two insert methods + delete:
   the exact validator rules, the main-ad insert array (every column→value), variants/analytics/
   meta/post_owner/users/countries inserts, the `$currentTableColumns` arrays (insert + update),
   the ES `$params['body'][...]` extras, and the getJoinedAds SELECT. Save to `PHP-SPEC-<net>.md`.
2. **Confirm live schema:** `SHOW TABLES LIKE '<net>_%'` + `SHOW COLUMNS` for the main tables, and
   `GET <net>_search_mix/_mapping/field/*` for ES field prefixes + date formats. Column/table names
   and the ES prefix (`<net>_ad.*` vs `facebook_ad.*`) are the real per-network work.
3. **Enable** in config (already present): `networks.<net>.insertion.enabled = true`. Confirm the NAS
   prefix in `nasClient.NAS_KEY_PREFIX` (fb/insta/pint/gt/yt/gdn/native/tiktok/linkedin/quora/reddit/bing).
4. **Copy a DONE network** (`facebook/` or `instagram/`, whichever is closer) → `src/services/<net>/`,
   then adjust the deltas:
   - `repository.js` — table/column names to `pasdev_<net>` schema + the `getJoinedAd` join/aliases. **~90% of the work.**
   - `esColumns.js` — the exact `<net>_*`-prefixed column arrays + index name (`<net>_search_mix`).
   - `esDocBuilder.js` — `ES_DATE_FIELDS` map (verified formats), `searchIdQuery` term (`<net>_ad.id`),
     synthetic user-countries token (`<net>_user_countries`), `CARRY_OVER_KEYS` (`<net>_*` prefixes).
   - `validate.js` / `normalize.js` — the exact rules/coercions.
   - pipelines — adjust the ad-row builder columns (each network's `<net>_ad` has different columns —
     e.g. Instagram has no `platform`/`proxy_status`, has `ad_type`/`collation_id`), user-resolution
     field (facebook_id vs instagram_id), and any per-network tables (page_details, cost_usage…).
     Keep the optimized shape (parallel APIs + media after commit).
   - controllers/routes — slug + endpoint paths (e.g. `gramAdsData` for Instagram).
5. **Verify:** load all modules (`node -e require(...)`), a mock insert (stub db/api/media), then a
   real ad against live `pasdev_<net>` + `<net>_search_mix`. Fix mismatches in `repository.js`/`esColumns.js` only.

> If a writer/helper is byte-identical to Facebook's, **promote it to `src/insertion/`** and import from both — don't keep two copies.

---

## 8. Status

**Facebook — DONE & live-tested**
- ✅ Config (global insertion + per-network toggle + nas + api + deleteToken), parsing, raw-body capture.
- ✅ Middleware: insertionAuth, insertionEnabled, deleteAuth.
- ✅ Shared: InsertionEngine, httpClient, nasClient, mediaUpload, apiClients, responses, util.
- ✅ Facebook: validate, normalize, repository (raw SQL + tx + getJoinedAd + deleteAdCascade), postOwner, esDocBuilder, esColumns.
- ✅ Pipelines: metaAds (INSERT+UPDATE, all tables), adsLibrary (INSERT+UPDATE), delete (cascade SQL + ES).
- ✅ Controllers + routes (3 endpoints, auto-mounted) + Swagger.
- ✅ NAS wired to media.globussoft.com (id-based filenames per the Media Upload API doc).
- ✅ Performance: external APIs + media uploads parallelized; media moved out of the transaction.

**Instagram — DONE** (gramAdsData + adsLibrary + delete; self-contained `src/services/instagram/`,
own esDocBuilder/esColumns/repository/validate/normalize/postOwner/pipelines, instagram_* tables,
`instagram_search_mix` index, NAS folder `insta`; optimized like Facebook). Spec: [PHP-SPEC-instagram.md](PHP-SPEC-instagram.md).
Endpoints: `/api/v1/instagram/insertion/{gramAdsData,adsLibrary,delete}`. Facebook untouched.

**Native — DONE & live-tested** (by teammate; branch `email_details/implementation`)
- ✅ validate (exact PHP rules — filled, not_in, ip, nullable-on-empty-string).
- ✅ normalize (cleanStr, urldecode, amp-fix, epoch→datetime, version gate, image fallback).
- ✅ repository (17 tables: native_ad, variants, post_owners, domains, country, country_only, networks, target_site, target_site_link, network_link, placement_url, countries, countries_only, meta_data, translation, users, account_activities).
- ✅ esColumns (NATIVE_INSERT_COLUMNS, 34 fields, `native_search_mix` index) + esDocBuilder (buildNativeSearchMixDoc, sentinel, date coercion, |langs fan-out).
- ✅ postOwner (upsertPostOwner + saveOwnerImage, mirrors Facebook).
- ✅ Pipelines: insertNativeAdPipeline (INSERT + UPDATE), deletePipeline (14-table cascade + ES).
- ✅ Controller + routes (2 endpoints: `adsData` + `delete`, auto-mounted).
- ✅ Performance: translation capped at 3s; 7 pre-tx lookups parallelized; image download overlaps DB work.
- 📄 Full KT: [docs/NATIVE-INSERTION-API-KT.md](../NATIVE-INSERTION-API-KT.md). Endpoints: `/api/v1/native/insertion/{adsData,delete}`.

**Pinterest — DONE & live-tested** (branch: `insertion`)
- ✅ validate (exact PHP rules — type accepts Image/Video/IMAGE/VIDEO/image/video, ip nullable, source in:desktop,android,ios).
- ✅ normalize (type→uppercase for DB ENUM, cleanStr, urldecode, amp-fix, post_date from milliseconds÷1000, first_seen/last_seen default to now).
- ✅ repository (10+ tables: pinterest_ad, variants, post_owners, domains, country, country_only, countries, countries_only, meta_data, account_activities + getJoinedAd + deleteAdCascade).
- ✅ esColumns (PINTEREST_INSERT_COLUMNS, 27 fields, `pinterest_search_mix` index) + esDocBuilder (target_keyword split by | and lowercased, sentinel, date coercion, |langs fan-out).
- ✅ postOwner (upsertPostOwner + saveOwnerImage with Pinterest CDN headers — Referer + User-Agent required).
- ✅ INSERT (PHP-exact): media uploaded to NAS FIRST → if fails return 500 no DB writes → parallel pre-tx lookups → transaction with real NAS URL → NAS key uses internal DB id.
- ✅ UPDATE: last_seen + days_running → country upsert → media re-upload (Pinterest CDN headers) → variant update (target_keyword append, image_url, image_url_original) → ES partial update.
- ✅ ES fields: Image → image_url + new_nas_image_url only; Video → thumbnail only (matches PHP exactly).
- ✅ Controller + routes (2 endpoints: `pintAdsData` + `delete`, auto-mounted by ServiceRegistry).
- ✅ Confirmed in DB: all 10 tables populated, NAS paths correct, post_owner_image stored as NAS path.
- 📄 Endpoints: `/api/v1/pinterest/insertion/{pintAdsData,delete}`.

**Quora — DONE & live-tested** (branch: `insertionpinterest`)
- ✅ validate (exact PHP rules).
- ✅ normalize (cleanStr, urldecode, amp-fix, epoch→datetime coercion).
- ✅ repository (quora_ad, variants, post_owners, domains, country, country_only, countries, countries_only, meta_data, account_activities + getJoinedAd + deleteAdCascade).
- ✅ esColumns (QUORA_INSERT_COLUMNS, fields, `quora_search_mix` index) + esDocBuilder (sentinel, date coercion, |langs fan-out).
- ✅ postOwner (upsertPostOwner + saveOwnerImage).
- ✅ Pipelines: quoraAdsPipeline (INSERT + UPDATE), deletePipeline (cascade SQL + ES delete).
- ✅ Controllers + routes (2 endpoints: `quoraAdsData` + `delete`, auto-mounted by ServiceRegistry).
- ✅ Confirmed in DB: all tables populated, NAS paths correct.
- 📄 Endpoints: `/api/v1/quora/insertion/{quoraAdsData,delete}`.

**Reddit — DONE & live-tested** (branch: `quorafixes`)
- ✅ validate (exact PHP rules — type IMAGE/VIDEO/TEXT, platform required, ip validation).
- ✅ normalize (cleanStr, urldecode, amp-fix, epoch→datetime coercion, version gate).
- ✅ repository (reddit_ad, variants, post_owners, domains, country, country_only, countries, countries_only, meta_data, account_activities, analytics, users, url + getJoinedAd + deleteAdCascade).
- ✅ esColumns (REDDIT_INSERT_COLUMNS, fields, `reddit_search_mix` index) + esDocBuilder (sentinel, date coercion, |langs fan-out).
- ✅ postOwner (upsertPostOwner + saveOwnerImage).
- ✅ Pipelines: redditAdsPipeline (INSERT + UPDATE with platform field storage), deletePipeline (cascade SQL + ES delete).
- ✅ Controllers + routes (2 endpoints: `redAdsData` + `delete`, auto-mounted by ServiceRegistry).
- ✅ Confirmed in DB: all tables populated, platform field stored, NAS paths correct.
- ✅ Platform field now stored in reddit_ad table for Kibana filtering.
- 📄 Endpoints: `/api/v1/reddit/insertion/{redAdsData,delete}`.

**Other 5 networks — TODO** (thin layer each, per §7).

---

## 9. Environment gotchas already solved (read before debugging!)

These were discovered while making Facebook work against the live `pasdev_facebook` DB + `search_mix` ES. The same will apply to other networks — handle them up front.

1. **Strict MySQL (`only_full_group_by` + `STRICT_TRANS_TABLES`).** The live server is strict; the old PHP server wasn't. Handled by: `ANY_VALUE()` on joined columns in `getJoinedAd`, and `withTransaction` relaxing `sql_mode` for the insertion connection (restored on release so other code is unaffected).
2. **DATETIME columns** (`facebook_ad.post_date/first_seen/last_seen`, `created_date`, `l_c_s_updated_date`) — store `'YYYY-MM-DD HH:MM:SS'` via `epochToDateTime()`, NOT epoch ints.
3. **Generated columns** — `facebook_ad_post_owners.post_owner_lower` is generated from `post_owner_name`; never insert it (query it freely).
4. **NOT-NULL columns with no value** (e.g. `proxy_status`) — `stripNulls()` drops null keys so the DB default applies (relaxed sql_mode lets omitted NOT-NULL cols default).
5. **Integer columns given JSON** — `popularity` is INT in SQL: store a number (`popToSql` = popularity_percentage). Keep the `{max,current}` object only for the ES doc.
6. **Elasticsearch `date` fields** in `search_mix` use explicit formats: `post_date`/`last_seen`/`firstSeenOn*`/`page_created_date` = `yyyy-MM-dd HH:mm:ss`; `domain_registered_date` = `yyyy-MM-dd`. mysql2 returns DATETIME as JS `Date` → `esDocBuilder.coerceEsDate()` formats each field to its mapped format (zero/empty → null/sentinel). Verify a new index's date-field formats with `GET <index>/_mapping/field/*`.
7. **NAS (media.globussoft.com) — uploads, extensions & resilience.** Per the Media Upload API doc: key = `<networkFolder>/<typeSubfolder><YYYYMM>/<id>`; Bearer token; bucket pas-dev/pas-prod; response `path` (e.g. `/pas-dev/stream/fb/adImage/202605/130721.jpg`) is what we store. **Filename = the entity id** (ad id for ad media, post_owner_id for post-owner image) — NOT random. Network→folder map lives in `nasClient.NAS_KEY_PREFIX`. **Endpoints + paths are config-driven** (`nas.mediaUrl`+`mediaUploadPath`) — never hardcode routes.
   - **Extension is NAS-decided, NOT hard-coded / NOT URL-parsed.** `mediaUpload.downloadToTemp` names the temp file from the response `Content-Type` (via `mime-types`); `storeInNas` sends the key WITHOUT an extension + the file WITH its real extension, and the NAS validates+appends it. So image→`.jpg/.jpeg`, video→`.mp4`, and a video that arrives in `other_multimedia` is stored as a video.
   - **Video files** now go to the SAME unified media endpoint as images (subfolder `adVideo/`) — the old dedicated `nas-video-api.poweradspy.com` endpoint (`videoUrl`+`videoUploadPath`) is RETIRED (config keys remain, unused). Only Facebook & Instagram upload video. The path is stored ONLY in ES `nas_video_url` (PHP never stored it in SQL). For a VIDEO ad, `<net>_ad_variants.image_url` = THUMBNAIL, `image_url_original` = original video URL.
   - **Carousel / other_multimedia** → uploaded in parallel, stored in `facebook_ad_image_video.ad_image_video` (JSON array) AND ES `othermedia`. Each item keeps its real extension (video item → `.mp4`).
   - **Resilience — never blocks the response, never loses media (even if NAS is DOWN or the source URL EXPIRES).** media.globussoft.com (behind Cloudflare) intermittently 5xx's. (a) The in-request upload uses a SHORT timeout (`nas.uploadTimeoutMs`, default 10s) + 2 quick retries, so the API never waits long. (b) On failure we do NOT re-download later (source URLs expire) — `storeInNas` persists the already-downloaded BYTES to a durable on-disk queue (`data/nas-pending/`, module `nasUploadQueue.js`) and returns the **deterministic predicted NAS path** (key is fixed → stored path is fixed), so the ad references the eventual file immediately — NO ES/SQL patch needed. (c) Background cron `jobs/nasUploadRetryCron.js` (every 1 min, worker-1 per machine) re-uploads each pending blob to the SAME key until it succeeds, then deletes it; after 50 attempts the blob moves to `data/nas-pending/failed/` (kept for manual recovery). Net: media upload failures/slowness can't affect the insert response or lose data — they self-heal in the background.
8. **post_owner image is named by post_owner_id**, not ad id — one advertiser shares one profile image across all its ads (dedup). Expected, not a bug.
9. **Translation is critical for metaAdsData** (PHP aborts 400 on failure) but **best-effort for adsLibrary**. `config.insertion.api.translationRequired=false` lets metaAds insert even when the translation service is down (dev/testing).
10. **Per-network column quirks (Instagram, vs Facebook)** — confirm each network's real schema:
    - `instagram_ad` has **no `platform` column** (platform → `instagram_ad_meta_data`) and **no `proxy_status`**; it adds `ad_type`, `ad_budget`, `collation_id`, `views`, `System_id`. So the ad-row builder differs per network.
    - `instagram_call_to_action` column is **`call_to_action`** (Facebook used `action`).
    - `instagram_ad_domain` (singular), `instagram_country`/`instagram_country_only` (network-specific, not shared), `instagram_ad_translation`, `instagram_page_details`.
    - post-owner dedup is by **`post_owner_name`** (Instagram), not `post_owner_lower`.
    - `instagram_ad_meta_data` has its own `id` PK + `instagram_ad_id` FK (Facebook's meta PK was facebook_ad_id).
    - adsLibrary audience/EUT go to **`instagram_ad_cost_usage_benefit_analysis`**; country is ISO → name via `country_data.instagram_country_iso`; no ad_users / no city-state country write.
    - ES index `instagram_search_mix`, field keys prefixed `instagram_*`, date fields verified (`instagram_ad.post_date`/`last_seen`/`firstSeenOn*` = `yyyy-MM-dd HH:mm:ss`, `instagram_ad_domain.domain_registered_date` = `yyyy-MM-dd`). **`instagram_ad.created_date` = `yyyy-MM-dd HH:mm:ss` (esDocBuilder `'datetime'` kind), same space form as the other date fields — the earlier assumption that it was ISO/`strict_date_optional_time` was wrong (the `'iso'`/`'T'` form was REJECTED by the live mapping and caused the `created_date_es_dateparse` errors).**
    - `instagram_user` has **no `ads_info_status`** column (Facebook's `facebook_users` did) — select only `id`.
    - **Delete cascade FK children:** `instagram_ad` has `ON DELETE RESTRICT` FKs — all FK children must be deleted first. Verified via `information_schema`: `instagram_ad_analytics, instagram_ad_categories, instagram_ad_image_video, instagram_ad_meta_data, instagram_ad_translation, instagram_ad_url, instagram_ad_variants, instagram_hidden_ads (FK col **ad_id**), instagram_user_affiliate_ads`. (See §9.11 — run the information_schema query per network.)
    - Dead env: PHP `TRANSLATE_API` (`language-localization`) is unused — only `LANGUAGE_TRANSLATION_API` matters.
11. **Delete cascade & FK constraints (every network).** The main `<net>_ad` table usually has
    `ON DELETE RESTRICT` foreign keys from child tables — you MUST delete those children before the
    main row, or delete fails with a FK error. Don't guess the list — get it from the DB:
    ```sql
    SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE REFERENCED_TABLE_SCHEMA='pasdev_<net>' AND REFERENCED_TABLE_NAME='<net>_ad';
    ```
    Add every result to `deleteAdCascade` (note the FK column name — some use `ad_id`, not `<net>_ad_id`).
    `deleteAdCascade` skips tables that don't exist, so listing extra child tables is safe.
12. **Shared `mediaUpload.uploadMultimedia` returns a Facebook-named key.** It returns
    `{ facebook_ad_id: id, ad_type, ad_image_video }` (legacy). A non-Facebook network's
    `upsertAdImageVideo` must accept **`<net>_ad_id ?? facebook_ad_id`** (or the caller must map the id),
    otherwise the carousel row is **silently skipped in SQL** while ES still gets `othermedia`
    (the value is in the object). Symptom: carousel in ES but missing in `<net>_ad_image_video`.
13. **Carousel (other_multimedia) — IMAGE only, on BOTH insert AND update.** PHP stores other_multimedia
    only when `type == IMAGE` (the VIDEO branch is commented out), and the UPDATE path also stores it.
    Store the NAS-path JSON array in `<net>_ad_image_video.ad_image_video` (+ ES `othermedia`). The
    `<net>_ad_image_video.ad_type` column is an `enum('IMAGE','VIDEO')`. Note `ad_image_video` upserts run
    AFTER commit on the pool (not the relaxed-sql_mode tx) — so the data must already be valid.
14. **`native_ad_translation` has only 4 columns** — `native_ad_id`, `ad_text`, `news_feed_description`, `ad_title`. No `detected_language` column. Do NOT add extra columns to the INSERT (confirmed from the migration).
15. **`native_ad_variants.image_url` is NOT NULL** — use `stripNulls()` on insert so TEXT-type ads fall back to the DB default instead of failing; never pass `null` explicitly.
16. **`native_ad_image_video` uses the `facebook_ad_id` column even for native** — original PHP schema naming. `deleteAdCascade` (and inserts) must use `facebook_ad_id` as the column, not `native_ad_id`.
17. **Facebook CDN image URLs expire** (`oe=` token). If a download fails, media falls back to `/DefaultImage.jpg` and the response carries a `warning` — not a code bug.
18. **Pinterest CDN blocks plain downloads.** All Pinterest image/thumbnail/post-owner downloads MUST include `Referer: https://www.pinterest.com/` + proper `User-Agent` headers or the CDN returns 403. Use a dedicated `downloadPinterestImage()` helper (not the shared `mediaUpload.downloadToTemp`) for all Pinterest media.
19. **`pinterest_ad.type` is ENUM('IMAGE','VIDEO') uppercase.** PHP validates `in:Image,Video` (mixed case) but MySQL stores the canonical uppercase enum value. Always normalize `type` to uppercase in `normalize.js` before any DB or logic checks (`Image` → `IMAGE`, `Video` → `VIDEO`). All pipeline checks must use `=== 'IMAGE'` / `=== 'VIDEO'`.
20. **Pinterest `post_date` is in milliseconds.** PHP: `date('Y-m-d H:i:s', $postData["post_date"] / 1000)`. Divide by 1000 in `normalize.js` (`msToDateTime`). Do NOT use the shared `epochToDateTime` (which handles 10-digit seconds).
21. **Pinterest `first_seen`/`last_seen` default to now.** PHP comments these out and always uses `date('Y-m-d H:i:s', time())`. Do not read from the payload.
22. **Pinterest ES fields per type (PHP-exact):** Image ads → set `image_url` + `new_nas_image_url` only; Video ads → set `thumbnail` only. Never set all three for the same ad — that is wrong.
23. **Pinterest NAS key must use internal DB id, not platform ad_id.** For INSERT, we upload to NAS before the transaction (PHP pattern), so we don't have the internal id yet — use platform `ad_id` as temp key. For UPDATE, always use internal id. Verify NAS paths in DB: expected format `/pas-dev/stream/pint/{type}/{YYYYMM}/{internal_id}.jpg`.
24. **Pinterest `ip_address` must be stored in `pinterest_ad_countries_only`.** The table column is `NOT NULL` with no default. Always include `ip_address` in the `pinterest_ad_countries_only` insert (fall back to `''` when empty/null) — both on INSERT and UPDATE paths.
25. **Pinterest `country` payloads can be comma-separated.** Platform 12 (and 15) ads may contain many countries in one string. The pipeline must split by comma, ensure each individual country in `pinterest_country_only` / `pinterest_country`, and insert one `pinterest_ad_countries` + `pinterest_ad_countries_only` row per country. The `pinterest_ad.country_id` / `country_only_id` is set to the last country to match PHP behavior. The ES doc must use the full country list (`getAdCountriesList`), not the single joined row.
```
