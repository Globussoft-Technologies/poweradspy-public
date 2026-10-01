# ChatGPT Ads (platform 21) — Implementation Manifest

> **Status as of 2026-10-01 (updated): schema APPLIED, pipeline WRITTEN, wired into
> ServiceRegistry (auto-mounted — no extra file needed, see §3b), and LIVE-TESTED against
> the real dev infra (SQL + ES, via a disposable scratch harness — INSERT, UPDATE, DELETE,
> NAS/ES/SQL failure handling, the `rejectedPostOwnerNames` deny-list, and an assumed
> VIDEO/carousel shape all exercised with real requests). Two real bugs were found and
> fixed during that testing — see §3c. An ES write-durability outbox (§3d) was added
> afterward, matching an explicit requirement that NEITHER admob's own `mob_es_outbox` nor
> any other network in this codebase actually satisfies (see §3d for why).**
>
> Companion reading: [../MANIFEST.md](../MANIFEST.md) (the general insertion-subsystem guide —
> read that first for the shared engine/helpers/architecture rules) and
> [../KT-INSERTION-PROCESS.md](../KT-INSERTION-PROCESS.md) (Facebook's full data-flow reference,
> used here as a STRUCTURAL reference only — see "What was deliberately NOT copied" below).

## 0. Why this network is different from every other one in this folder

Every other network documented in this `docs/insertion/` folder (Facebook, Instagram, Native)
was built by **extracting the exact legacy PHP behavior verbatim** — there was a working system
whose column-by-column, field-by-field behavior had to be preserved. **ChatGPT Ads has no PHP
legacy.** It is a brand-new network: a browser extension scrapes ads shown inside ChatGPT
conversations and posts them to us directly. There is nothing to port — every schema/mapping
decision below was *designed*, not extracted, and is noted as such.

Per explicit product direction: treat this as a **fully independent, self-contained network** —
no shared tables, no shared ES index, no cross-network code paths. Facebook's folder structure
and the *shape* of its relational split (main ad table → variants → post_owners → analytics →
countries → translation → carousel) is the reference; its legacy column TYPES, its dotted ES
field-key convention, and tables that only exist because of 10-year-old PHP decisions are **not**.

## 1. The real payload (ground truth — nothing below is guessed)

```json
{
  "ad_text": "For long sitting in an ergonomic office chair, here’s a back-support option.",
  "type": "IMAGE",
  "image_url_original": "<redacted image URL>",
  "image_video_url": "<redacted image URL>",
  "ad_title": "Make Every Chair More Comfortable",
  "post_owner": "Leeford Ortho",
  "post_owner_image": "<redacted favicon/logo image URI>",
  "news_feed_description": "Add lower back support to your everyday chair for better comfort while you sit.",
  "destination_url": "<redacted tracking URL>",
  "ad_id": "<generated 12-digit ID>",
  "platform": "21",
  "country": "<countryName from geolocation lookup>",
  "ad_position": "conversational_bottom",
  "first_seen": 1790748655853,
  "last_seen": 1790748655853,
  "version": "1.0.0",
  "uid": "<extension record ID>",
  "newsfeed_description": "Add lower back support to your everyday chair for better comfort while you sit.",
  "network": "chatgpt"
}
```

This is the **only** confirmed sample — it is a `type: "IMAGE"` ad. Product has confirmed
**all media types (image/video/carousel) will be sent**, but no real VIDEO or carousel
(`other_multimedia`-shaped) sample payload has been seen yet. §6 below states exactly what is
assumed vs. confirmed for those.

### Field notes (read before touching normalize.js later)

- **`platform` is fixed at `"21"`** per product confirmation — not a varying value, kept as a
  real column anyway (consistency with every other network + cheap future-proofing).
- **`news_feed_description` AND `newsfeed_description` are BOTH sent, with the identical value.**
  This looks like the extension defensively sending both spellings rather than an intentional
  distinct pair. **Open item: ask the crawler/extension team to drop one.** Until then,
  normalize.js must treat them as aliases of the same value (prefer `newsfeed_description`,
  fall back to `news_feed_description`) and store/index exactly ONE canonical value — never both.
- **`image_url_original` and `image_video_url` are both sent with the same value** in this
  sample (the source image URL). Mirrors facebook's two-named-same-concept pattern
  (`ad_image` vs `image_video_url`) — normalize.js should read whichever is present, preferring
  `image_video_url` (matches facebook's own preference order: `n.image_video_url ?? n.ad_image`).
- **`country` is a plain resolved NAME string** (geolocation lookup), not an ISO code and not an
  array — simpler than facebook library's ISO-array shape. No ISO→name translation step needed.
- **`uid`** ("extension record ID") — stored for traceability/debugging only. The INSERT-vs-UPDATE
  branch decision is still made on `ad_id` alone, matching every other network. Nothing currently
  depends on `uid` functionally; treat it as an indexed-but-inert column until a real need shows up.
- **No `call_to_action`, no `page_category`, no `likes`/`comments`/`shares`/`popularity` fields at
  all.** This is not missing data — a ChatGPT conversational ad surface has no such concepts
  (no CTA button field sent, no category, no social engagement surface). The schema below does
  **not** invent tables/columns for data that structurally cannot exist here.
- **No `meta_ad_id`/budget, no `est_audience_size`/`EUT`/`active_status`/`ad_run_platforms`,
  no gender/age targeting.** This payload is shaped like facebook's simpler `metaAdsData`
  (scraper event), not the richer `adsLibrary` (audience/budget metadata) shape — so this network
  very likely only needs **one** insertion pipeline, not Facebook's two (`metaAdsData` +
  `adsLibrary`). Confirm this assumption before writing the pipeline.

## 2. What's done (this pass)

| Artifact | File | Notes |
|---|---|---|
| ES mapping | [chatgpt_search_mix.mapping.json](chatgpt_search_mix.mapping.json)* | See §4 |
| ES index-create script | [apply-chatgpt-es-mapping.js](apply-chatgpt-es-mapping.js)* | Dry-run by default; `--apply` creates. Refuses to touch an already-existing index. |
| SQL schema | [chatgptads_schema.sql](chatgptads_schema.sql)* | See §5. `IF NOT EXISTS` everywhere — safe to re-run. |
| Config wiring | `src/config/networks.js` → `networks.chatgptads` | Added, following the exact facebook/instagram/native shape. Verified with `node -e "require('./src/config/networks').chatgptads"` — resolves real dev DB/ES credentials correctly (shared dev MySQL host, shared dev ES node, network-specific `pasdev_chat_ads` database name and `chatgpt_search_mix` index name). |
| NAS folder prefix | `src/insertion/helpers/nasClient.js` → `NAS_KEY_PREFIX.chatgptads = 'gpt'` | The `network` argument passed into `storeInNas()`/`mediaUpload.*` throughout the (not-yet-written) pipeline must be the literal string `"chatgptads"` (the config slug) — **not** the payload's own `"network":"chatgpt"` field, which is just descriptive ad-row data. Confirmed as the single most likely footgun for whoever writes the pipeline next. |

*paths are relative to this file's folder (`pas_node_api/docs/insertion/chatgptads/`); the actual
files live in `pas_node_api/scripts/chatgptads/`.

**Applied and verified live (2026-10-01):**
- `chatgptads_schema.sql` run against the real `pasdev_chat_ads` database — all 9 tables exist,
  confirmed via `information_schema.TABLES`: `InnoDB` engine, `utf8mb4_unicode_ci` collation on
  every one.
- `chatgpt_search_mix` ES index created via `apply-chatgpt-es-mapping.js --apply` — confirmed ES
  cluster is version **6.8.0** (matches the `mappings.doc.properties` shape used). Read back the
  live mapping and settings afterward: 30 real fields (the mapping file's own `_comment*` keys
  correctly stripped before sending), `number_of_shards: 2`, `number_of_replicas: 1`,
  `codec: best_compression` — exactly as designed, nothing drifted on the way in.
- Both are empty (zero rows / zero docs) — ready for the insertion pipeline to start writing.

## 3b. Routing — confirmed auto-mounted, no extra file needed

`ServiceRegistry.js`'s **dynamic service discovery** (not the legacy class-based path admob
etc. use) scans `src/services/*` for any folder containing a `routes/` subdirectory and
auto-mounts whatever that folder exports at `/api/v1/<folder-name>`. `src/services/chatgptads/
routes/chatgptadsInsertionRoutes.js` satisfies this with no additional top-level service-class
file — confirmed by reading `ServiceRegistry.js` in full and by a live `require()` + router-build
smoke test. `POST /api/v1/chatgptads/insertion/adsData` and `/insertion/delete` are live as soon
as the server restarts.

## 3c. Two real bugs found by live testing (both fixed)

1. **`domain_id`/`country_only_id` FK violation when `destination_url`/`country` are absent.**
   Both columns were `INT UNSIGNED NOT NULL DEFAULT 0` with a real FK constraint — but `0` is
   never a valid row id, and both source fields are legitimately optional per `validate.js`
   ('nullable'). Any ad missing either field would fail to insert at all. **Fixed**: both
   columns are now `NULL DEFAULT NULL` (live table altered + `chatgptads_schema.sql` updated),
   and `chatgptadsPipeline.js` now defaults `domainId`/`countryOnlyId` to `null`, not `0`. Verified
   both ways (missing field → inserts with `NULL`; present → still resolves to a real id).
2. **Fire-and-forget outbox write** (introduced while building §3d below, caught before it shipped
   un-tested): the `.catch((e) => { ...; repo.queueEsOutbox(...).catch(()=>{}); })` callbacks on
   `indexAd()` were not `async`, so the retry-queue INSERT wasn't awaited — a request could
   return before the durability record actually landed. Fixed by making both callbacks `async`
   and `await`ing the queue/clear calls.

Everything else tested (INSERT/UPDATE field semantics, NAS pre-gate vs post-commit failure,
SQL rollback, the post-owner deny-list, VIDEO's `thumbnail_url` gate) behaved as designed and
matches facebook's own equivalent behavior exactly (verified by direct comparison, not assumed).

## 3d. ES write-durability outbox (`chatgptads_es_outbox` + `chatgptadsEsOutboxJob.js`)

Every pipeline in this codebase (including chatgptads' own first draft) only *logs* an ES
index/delete failure — the ad can sit un-searchable (write success) or the ES doc can be
left orphaned (delete success) with nothing ever revisiting it. Admob's `mob_es_outbox` is the
only existing precedent, and it **only** covers the index-failure case — its outbox row
`ON DELETE CASCADE`s away the moment the ad is deleted, so a failed ES *delete* is silently
never retried anywhere in this codebase, for any network.

chatgptads now has its own outbox, covering **both** directions:
- `chatgptads_es_outbox` (`action: 'index'|'delete'`, no FK on `chatgptads_ad_id` — a 'delete'
  row's ad is gone by design, unlike admob's table).
- Queued from `chatgptadsPipeline.js` (index/reindex failure) and `deletePipeline.js` (ES delete
  failure); `deletePipeline.js` also clears any stale pending row for an ad before deleting it.
- `chatgptadsEsOutboxJob.js` — cron runner, registered as `chatgptadsEsOutbox` in
  `src/jobs/cronManager.js` + `config.json` (`crons.jobs.chatgptadsEsOutbox`, every 1 min,
  mirrors admob's schedule/batchSize/maxAttempts shape). For `'index'`, it rebuilds the ES doc
  purely from the durably-stored SQL row (+ best-effort carry-over from any still-existing ES
  doc for VIDEO's `nas_video_url`/`lang_detect`, which aren't stored in SQL at all — see the
  open-items list below). For `'delete'`, it searches+deletes by internal id; "not found" counts
  as success (already gone).
- **Live-tested end to end** (2026-10-01): simulated an ES index failure → confirmed outbox row
  queued → ran the cron → confirmed the ad became searchable and the outbox row cleared.
  Simulated an ES delete failure → confirmed a `'delete'` outbox row queued despite the SQL row
  already being gone → ran the cron → confirmed the orphaned doc was removed (ES delete
  acknowledged synchronously; search-visibility lag is bounded by the mapping's own
  `refresh_interval: 30s`, by design — not a defect).

**New open item**: VIDEO's `nas_video_url` is only ever stored in ES, never in SQL — so if an
ES reindex is queued (old doc already deleted, as in `updatePath`'s delete-then-reindex order)
AND no other ES doc instance survives to carry it over from, a VIDEO ad's `nas_video_url` would
come back `null` until the next real re-seen upload. Noted, not fixed — no real VIDEO payload
exists yet to design around (see §6 below), and the window only matters for an already-rare
double-failure (ES reindex fails right after a delete-then-reindex cycle).

## 3e. Pending config.json changes before production

Three items in `config.json` need attention from whoever takes this to production — none are
blocking for continued dev work, but the network is NOT production-ready until these are
resolved:

1. **`insertion.nas.sftpHost`** (currently `125.16.67.186`) — the NAS IP changed; this value
   is stale. Owner (user) said they'll update it themselves.

2. **`insertion.nas.originUrl` vs `mediaUrl` — both currently identical**
   (`"https://media.globussoft.com"` for both). By design (see `nasHttpUpload.js`'s header
   comment) `mediaUrl` is the Cloudflare-fronted endpoint (small files only — Cloudflare 413s
   any body over ~100MB) and `originUrl` is meant to be a direct, Cloudflare-free path so large
   VIDEO uploads have no size cap. With both set to the same Cloudflare-fronted domain, a large
   video upload would still hit the ~100MB Cloudflare limit. Not urgent today (VIDEO traffic
   for this network hasn't started), but must be a real origin address before VIDEO volume
   matters. Confirm whether this was intentional or needs a real origin value.

3. **`networks.chatgptads.sql.database` / `mongo.database` — currently dev-named**
   (`"pasdev_chat_ads"` / `"chatgpt_ads"`). As of 2026-10-01 these are **no longer hardcoded in
   code** (`src/config/networks.js` falls back to the shared `config.databases.sql.database`
   default like every other network — facebook/instagram/gdn/etc. — instead of a chatgptads-
   specific literal; fixed per explicit instruction, see git history on that file). But the
   config.json VALUE itself is still the dev-named one. Before a production deploy, either set
   a real production database name directly in config.json, or set it via the `CGA_SQL_DATABASE`
   / `CGA_MONGO_DATABASE` environment variables on the production server (env overrides
   config.json). `host`/`port`/`user`/`password` are all `null` → fall back to the shared
   `config.databases.sql.*` server (same MySQL box every other network uses) — fine unless
   chatgptads is meant to live on its own dedicated DB server, in which case fill these in too.

Everything else in `config.json` (the global `insertion.secretKey`/`deleteToken`/
`signatureHeader`, `insertion.api.translationUrl`, `crons.jobs.chatgptadsEsOutbox`,
`networks.chatgptads.insertion.rejectedPostOwnerNames`) is already correctly wired and needs
no further action.

## 3. What's NOT done (next pass)

Per MANIFEST.md §7's mechanical recipe, applied to a network with no PHP precedent:

- `src/services/chatgptads/insertion/{validate,normalize,repository,postOwner,esDocBuilder,esColumns}.js`
- `src/services/chatgptads/insertion/{metaAdsPipeline or adsPipeline}.js` (name TBD — see the
  "only one pipeline?" note in §1) — INSERT + UPDATE branches, same shape as
  `adsLibraryPipeline.js`/`metaAdsPipeline.js` but built against `chatgptads_*` tables.
  No `deletePipeline.js` requirement was stated by the user this pass, but the standard
  `/insertion/delete` endpoint should still be added for consistency unless told otherwise.
- `src/services/chatgptads/controllers/*.js` + `src/services/chatgptads/routes/chatgptadsInsertionRoutes.js`
  (mirrors `facebookInsertionRoutes.js`'s shape; auto-mounted by ServiceRegistry)
- Wire media upload calls (`src/insertion/helpers/mediaUpload.js` — already shared, **do not
  duplicate it**): `uploadImage`/`uploadThumbnail`/`uploadVideo`/`uploadPostOwner`/`uploadMultimedia`,
  exactly as `adsLibraryPipeline.js` calls them, with `network = 'chatgptads'`.
- Add `chatgptads` to whatever hardcoded network-slug lists the new routes need to pass through
  (per `docs/CONFIG_RULES.md`'s own checklist: *"if a hardcoded list needs to grow alongside it,
  search for every duplicate of that list first"*) — **not yet done, not yet searched for.**
  Known candidates to check before wiring routes: `ServiceRegistry`'s network list (however it
  discovers `src/services/<net>/`), and any plan/entitlement platform-slug arrays if this network
  is ever meant to be customer-visible search (out of scope for "insertion and update API" as
  asked, flagging only so it isn't forgotten later).

## 4. ES mapping design (`chatgpt_search_mix.mapping.json`)

Modeled on **`google_ads_data_v2.mapping.json`** — the most recently *tuned* mapping in this
codebase (rewritten from a live 206M-doc/219GB diagnostic specifically to fix CPU-heavy
wildcard/edge_ngram problems) — not on facebook/instagram's older mapping shape.

- **Flat field names, no `table.field` dotted prefixes.** Facebook/instagram's ES docs use
  dotted keys (`facebook_ad.id`, `facebook_ad_post_owners.post_owner_name`) because of how the
  old PHP `$params['body']["table.field"]` builder worked. That convention is the direct cause
  of a whole class of bugs seen elsewhere in this codebase this session (dotted-key-vs-nested-
  object ambiguity in `readPath()`-style helpers). There is no legacy reason to repeat it here —
  flat keys (`ad_title`, `destination_url`, `post_owner_name`) are simpler and avoid that class
  of bug entirely.
- **`dynamic: false`** — an unmapped payload key is stored in `_source` but never auto-indexed.
  This is the exact fix google's own mapping needed after an unmapped field silently triggered
  ES's default dynamic mapping and ballooned the index with auto-generated ngram fields.
- **`keyword` + `lowercase_normalizer`** for every exact-match/filter field (`type`, `ad_position`,
  `country`, `domain`, `version`, …) — `term`/`terms` queries against these are the cheapest shape
  ES has. **No field here is a `wildcard`-type field and no free-text field should ever be queried
  with a leading `*wildcard*`** — that is the specific CPU trap this design avoids, per the
  explicit ask. If a future feature genuinely needs substring search, add a dedicated `.kw` or
  n-gram sub-field for that ONE field rather than wildcard-querying a `text` field.
- **`text` + `content_analyzer`** (standard tokenizer, lowercase + asciifolding, **no edge_ngram,
  no stemming**) only on the handful of fields that are genuinely free-text search targets:
  `ad_title`, `ad_text`, `newsfeed_description`, plus a synthetic `html` field (title+text+
  newsfeed concatenated — same convenience pattern facebook's `html` field provides, for one-field
  "search everything" queries) — not yet wired by any pipeline code, reserved for when the
  pipeline is written.
- **`index: false, doc_values: false`** on anything that is purely for display and never
  filtered/sorted/aggregated on: raw source URLs (`image_url_original`), post-owner avatar
  (`post_owner_image`), the finished carousel path list (`othermedia`), the finished video path
  (`nas_video_url`). `new_nas_image_url` and `Thumbnail` (the two fields the displayable-media
  gate needs `exists`/`wildcard(*DefaultImage*)` checks on, matching facebook/instagram's own
  gate — see `compeitetor_analysis/utils/displayableMediaFilters.js` for that exact pattern if a
  search/displayable-media gate is ever built for this network too) stay indexed.
- **`number_of_shards: 2`**, not Google's `4`. Google's shard count was sized for 206M existing
  documents; this index starts at **zero** documents. Over-sharding a new/small index wastes
  resources and slows aggregations for no benefit — re-shard (reindex into a new index) only once
  real volume justifies it. `number_of_replicas: 1` for basic durability from day one.
- **`codec: best_compression`**, `refresh_interval: 30s` — same low-churn defaults google's
  mapping uses; reasonable for a write-heavy, not-yet-read-heavy new index.

## 5. SQL schema design (`chatgptads_schema.sql`)

Table split mirrors facebook/instagram's proven shape (see `KT-INSERTION-PROCESS.md` §3 for the
original), **trimmed to only what this payload actually has**, with every column using modern
types — matching `scripts/google_transparency_schema.sql` (the most recently fresh-built schema
in this codebase), not facebook's legacy column types:

| Table | Purpose | Deliberately NOT copied from facebook |
|---|---|---|
| `chatgptads_ad_post_owners` | advertiser dedup (generated `post_owner_lower`, same pattern) | — |
| `chatgptads_ad_domains` | domain dedup (from `destination_url`) | — |
| `chatgptads_country_only` | country dedup | no city/state table — payload has only a flat country name, no ISO/geo breakdown to normalize further |
| `chatgptads_ad` | main row | no `call_to_action_id`, no `category_id` — payload has neither; `destination_url` lives directly on this row, not in a separate `_meta_data` table (that table would hold exactly one column here — a needless JOIN with no legacy-compatibility reason to keep it separate) |
| `chatgptads_ad_variants` | title/text/newsfeed_description/image paths | — |
| `chatgptads_ad_analytics` | **impression + hits only** | **no likes/comments/shares/popularity/engagement_rate columns** — structurally impossible data for this ad surface, not an oversight |
| `chatgptads_ad_countries` | ad↔country join + sighting count | — |
| `chatgptads_ad_image_video` | carousel (JSON array of NAS paths) | same shape as facebook, `JSON` type (not a string-serialized array) |
| `chatgptads_translation` | best-effort translated copy | `detected_language` is a plain `VARCHAR(8)` ISO string, **not** a shared `language_id` FK — no evidence a cross-network `language` dimension table exists that a self-contained network could safely depend on (and depending on one would violate the "don't parameterize one network from another" architecture rule) |

Modern-type fixes applied everywhere (the two problems explicitly asked to avoid):
- `utf8mb4` / `utf8mb4_unicode_ci` on every table (not `latin1` / 3-byte `utf8` — required for
  emoji and non-Latin scripts in ad copy; this is the "latin conversion" issue named in the ask).
- `TEXT` (not `VARCHAR(255)`) for anything that can be long free text or a long signed CDN URL —
  `image_url_original` in particular is routinely 300-800+ characters on facebook/instagram's
  real data and would silently truncate under a `VARCHAR(255)` (the "size chhota hai" issue
  named in the ask).
- `INT`/`BIGINT UNSIGNED` throughout (no id/count can be negative).
- Explicit `FOREIGN KEY ... ON DELETE {CASCADE|RESTRICT}` on every relationship, stated up front
  (facebook/instagram's FK behavior had to be reverse-engineered from `information_schema` after
  the fact — this schema just says it directly).

**Applied 2026-10-01** against the real `pasdev_chat_ads` database — all 9 tables confirmed via
`information_schema.TABLES` (InnoDB, utf8mb4_unicode_ci). Still worth a one-time
`SHOW CREATE TABLE chatgptads_ad;` sanity check before the pipeline starts writing, to confirm
the FK constraints actually attached as intended (a typo in a
referenced column name fails silently different ways depending on MySQL version/strict mode).

## 6. Open questions for whoever writes the pipeline next

1. **VIDEO payload shape is unconfirmed.** Facebook's VIDEO ads require a `thumbnail_url` field
   (validated, gates the insert per `MEDIA-UPLOAD-FLOW.md`). No real ChatGPT VIDEO sample has
   been seen — get one before writing VIDEO validation/gating logic. Don't assume the field name
   is `thumbnail_url` just because that's facebook's name for it.
2. **Carousel payload shape is unconfirmed.** Facebook's `other_multimedia` is an array of media
   URLs. No real ChatGPT carousel sample has been seen — same caution as above.
3. **`news_feed_description`/`newsfeed_description` duplicate field** — ask the crawler team to
   send only one. Until then, normalize.js must alias them (see §1).
4. **Is there really only one insertion endpoint needed** (not facebook's `metaAdsData` +
   `adsLibrary` pair)? The sample payload matches `metaAdsData`'s simpler shape. Confirm before
   building two pipelines nobody asked for.
5. **NAS download Referer** — `mediaUpload.js`'s `REFERER_BY_NETWORK` map has no `chatgptads`
   entry (deliberately left unset this pass — the real CDN host serving ChatGPT ad creatives is
   unknown, and `refererFromUrl()`'s same-origin fallback is a safe default until it's known
   whether these creative URLs are protected/signed and need a specific Referer to download
   successfully). If image/video downloads start failing with 401/403 in
   `logs/nas-media-<date>.log`, that's the first thing to check.
6. **`uid` (extension record ID)** — stored for traceability only this pass (see §1). If the
   crawler team says it should drive idempotency/dedup beyond `ad_id`, that needs its own design,
   not a silent assumption.
