# Google Ads Transparency insertion — platform 18

Status: implemented for payload contract `3.2.0`  
Network: `google`  
Platform discriminator: integer `18`

This flow is additive. The legacy Google Text insertion route and every file in
`src/services/google/insertion/` remain unchanged. The shared route registry
sorts discovered filenames so the new interceptor order is deterministic on
Linux and Windows; existing route contents and URLs are unchanged.

## API

There is exactly one insertion endpoint, the same one already used by Google:

```text
POST /api/v1/google/insertion/gtAdsData
```

It uses the normal Google insertion guards. A request may be one object, a bare
array, or `{ "ads": [...] }`. The platform-18 route module is discovered before
the legacy route. It intercepts a request containing platform 18; in a mixed
batch each item is dispatched independently:

```text
platform == 18  -> transparencyInsertion/pipeline.js
other platform  -> existing google/insertion/metaAdsPipeline.js
```

Requests containing no platform-18 item fall through to the untouched legacy
router. No second platform-18 insertion API is exposed.

## Contract validation

`transparencyInsertion/validate.js` enforces the supplied v3.2.0 contract before
any SQL, NAS, or Elasticsearch work. Its top-level
`TRANSPARENCY_RULES` object follows the normal Google validator's editable
rule-list pattern:

- `required`: key and non-empty value required;
- `present`: key required, with explicit null accepted only with `nullable`;
- `optional`: key may be omitted but is validated when supplied;
- `disabled`: key is allowed and its validation is skipped.

Change the first token for a field to enable/disable its requirement without
rewriting validation logic. Normalization supplies safe null/array/common
defaults for optional platform-18 fields. Keep `ad_id` and `platform` required
because routing and idempotent canonical lookup depend on them.

With the checked-in rules:

- 25 top-level fields must be present; `post_date` is optional and nullable;
- unknown top-level and nested fields are rejected;
- nullable fields must be explicit JSON `null`;
- `CR<digits>` and `AR<digits>` IDs must match `ad_url`;
- URLs, RFC 3339 timestamps, alpha-2 codes, enum values, arrays, duplicates,
  country order, and impression bounds are checked;
- every country row contains `first_seen`, `last_seen`, and `times_shown`;
  each value may be explicit JSON `null`, otherwise the dates must be RFC 3339;
- the constant tuple is `network=google`, `source=desktop`, `platform=18`,
  `version=3.2.0`.

Invalid items return HTTP/result code `422` with `{field,message}` errors. One
invalid item does not abort the rest of a batch.

## SQL ownership and relationships

Existing tables remain the source of truth for fields the product already has:

| Existing storage | Reused contract data |
|---|---|
| `google_text_ad` | `ad_id`, type, first/last/post dates, source, `system_id`, status, running days, canonical FKs |
| `google_text_ad_post_owners` | `post_owner` (nullable) |
| `google_text_ad_variants` | title, text, original image and NAS image |
| `google_text_ad_meta_data` | platform 18, contract `version`, destination URL, desktop seen dates |
| `google_text_ad_domains` | destination domain |
| `google_text_country_only`, `google_text_country` | country dimensions |
| `google_text_ad_countries`, `_only` | existing ad-to-country relationships |
| `languages` | detected two-letter language and language name |
| `google_ad_translation` | translated title, text, and news-feed description |

Two new tables hold only Transparency-specific structures:

```text
google_text_ad (canonical row)
  1 ── 1 google_transparency_ad_payload
  1 ── N google_transparency_country_delivery
              N ── 1 google_text_country_only
```

`google_transparency_ad_payload` stores advertiser ID, Transparency URL,
subnetwork, request region, aggregate impression bounds, original video URL,
redirect URL, and other-media JSON. `system_id` and `version` are not duplicated
here; they use the existing common SQL columns described above. Its
primary key is also the FK to `google_text_ad.id`, making the write idempotent
per creative without duplicating common ad columns.

`google_transparency_country_delivery` stores one compact row per ad/country:
source order, country code, nullable first/last-seen timestamps, and
country-specific
impression bounds. It links both the canonical ad and the existing country
dimension. The primary key `(google_text_ad_id,country_only_id)` prevents
duplicates.

This shape is intended for high volume:

- no full raw-payload duplicate is stored;
- fixed fields remain a 1:1 row;
- only the variable country list fans out;
- advertiser and `(region,subnetwork)` indexes support ingestion/debug lookups;
- country/date indexes support delivery filtering;
- transaction upserts make retries safe.

DDL: `scripts/google_transparency_schema.sql`

Dry run and apply:

```powershell
node scripts/apply-google-transparency-schema.js
node scripts/apply-google-transparency-schema.js --apply
```

The runner prints the resolved Google SQL host/schema before doing anything.
It also safely renames an earlier draft schema's `first_shown`/`last_shown`
columns to `first_seen`/`last_seen` and upgrades them to `DATETIME`. If the draft
new table already contains duplicate system/version columns, they are made
nullable for compatibility and no new writes use them.
Run `--apply` separately in each environment with that environment's config.

## Insert/update transaction

For each valid item:

1. Normalize RFC 3339 timestamps and derive the destination domain.
2. Send title/text to the existing configured `translationUrl`. When
   translation is required and unavailable, return `503` before any SQL write.
   A successful response counts as usable only when at least one translated
   title, text, or description is non-empty. A bare `detected_language=en`
   accompanying three empty translated values is an empty result, not English.
3. Start one SQL transaction.
4. Find or create the existing owner, domain, country, and detected-language
   dimensions.
5. Insert `google_text_ad`, or update the existing row selected by public
   `ad_id`.
6. Upsert the existing variant, metadata, and `google_ad_translation` rows.
7. Upsert the 1:1 Transparency row.
8. Merge the ad's country delivery: update an existing country row or append a
   new country, and maintain the existing country relationships.
9. Commit.
10. Store an IMAGE through the shared NAS helper only when no successful NAS
   path already exists, then attach the real path to the existing variant.
11. Index one flat ES document using `_id = google_text_ad.id`.
12. For VIDEO, enqueue the shared durable background downloader after the ES
    document exists; it later writes the real NAS path to `image_video_url`.

SQL failure rolls back all SQL work for that item. NAS/ES failures do not erase
the committed canonical ad; they are logged and media failure is returned as a
non-fatal warning, matching the existing insertion architecture.

### Temporary step-by-step debug trace

Detailed platform-18 tracing is temporarily enabled in `config.json`:

```json
"transparencyDebug": true
```

Every line starts with `[GT18 TRACE NN]` and contains `ad_id`, request ID, batch
index, elapsed milliseconds, event name, and event-specific values. The trace
covers:

1. request fields and contract validation;
2. normalized SQL/date/country/media projections;
3. translation API request and exact detected-language/translated result;
4. transaction begin and canonical-ad lookup;
5. owner/domain/language/country IDs;
6. canonical, variant, translation, metadata, Transparency and country-table
   writes;
7. transaction commit or rollback/error;
8. existing Elasticsearch state;
9. NAS upload/reuse decisions and returned paths;
10. final Elasticsearch document summary and index result;
11. video queue decision and final API result.

In development the records appear in the server console and in the normal
combined log. Tail every platform-18 trace:

```powershell
$day = Get-Date -Format "yyyy-MM-dd"
Get-Content ".\logs\combined-$day.log" -Wait |
  Select-String "GT18 TRACE"
```

Filter one creative:

```powershell
Get-Content ".\logs\combined-2026-07-23.log" -Tail 2000 |
  Select-String "GT18 TRACE.*CR90000000000000000002"
```

The logger removes credential-shaped keys (`secret`, `password`, `token`,
`signature`, `authorization`) and truncates very large strings. Creative copy
and media/destination URLs are intentionally visible for this temporary
debugging phase.

After rollout debugging, set the flag to `false` and restart the API. No code
removal is required:

```json
"transparencyDebug": false
```

### Live shared-schema compatibility

The platform-18 payload is more nullable than the existing Google SQL schema.
The insertion adapter uses these deliberate compatibility values:

| Payload case | Existing SQL representation | Elasticsearch representation |
|---|---|---|
| `post_date` null/omitted | `google_text_ad.post_date = 1000-01-01 00:00:00` sentinel | `post_date = null` |
| later real `post_date` | replaces only null/sentinel SQL value | real date; an existing real date is preserved |
| `post_owner` null on a new ad | advertiser ID is used as the canonical owner name so the required FK is valid | original `post_owner = null` |
| empty `country` | canonical `country_id=0`, `country_only_id=0` | empty country array |
| country later becomes available | canonical zero IDs are backfilled and delivery rows append normally | rebuilt country data |
| country dimension without city/state | empty strings are stored because live `city`/`state` are `NOT NULL` | country name/code only |
| Transparency `subnetwork=SHOPPING`, etc. | canonical enum-safe `ad_position=FEED`; subnetwork remains in the Transparency table | `ad_position=FEED`, original `subnetwork` retained |
| null translated title/text/description | empty strings in live `google_ad_translation` `NOT NULL` columns | null when translation did not provide a value |
| successful translation response with no translated copy | `language_id=0` and blank translation columns because the live columns are `NOT NULL` | `language_id=0`, `lang_detect=null`, translated copy fields `null` |
| `first_seen` null/omitted | a SQL-only effective date is required for legacy running-date calculations | `first_seen=null` until the scraper supplies a real value |

The metadata insert also supplies explicit zeroes for all live `NOT NULL`
status/counter columns instead of depending on non-strict MySQL implicit
defaults. These constraints were verified against the configured Google dev
schema. A SQL `500` is transactionally rolled back, so retrying the same
`ad_id` after a compatibility fix is safe.

MySQL `DATETIME` values returned as either strings or JavaScript `Date` objects
are normalized without applying the Node host's Asia/Kolkata offset. This
prevents stored UTC-like wall-clock values such as `2026-07-05 00:00:00` from
silently becoming `2026-07-04 18:30:00` during an update/re-index.

### NAS folders

Existing Google media folders remain unchanged:

```text
gt/adImage/<YYYYMM>/<id>.<detected-extension>
gt/adVideo/<YYYYMM>/<id>.<detected-extension>
gt/otherMultiMedia/<YYYYMM>/<id>_<index>.<detected-extension>
```

Platform-18 TEXT ads can also carry `image_url_original`; that missing case uses:

```text
gt/adT/<YYYYMM>/<id>.<detected-extension>
```

The downloader prefers the response Content-Type for the real extension and
uses the URL extension as fallback. `othermultimedia` stays in its existing
folder whether an item is an image or video. Original payload URLs remain in
`google_transparency_ad_payload.othermultimedia`; Elasticsearch/search output
uses the single field `othermultimedia` for successful NAS paths. No
`nas_othermultimedia` field is created or written. A realtime ES `_get` reuses
each successful path by stable array position on later updates, so immediate
repeated requests do not upload the file again.

If an environment already received the earlier temporary
`nas_othermultimedia` mapping, Elasticsearch cannot remove a field mapping in
place. The pipeline reads that legacy `_source` value once to avoid a duplicate
upload, then replaces the document without that field. A future reindex removes
the unused mapping metadata itself.

### When the ad already exists

The lookup key is public `ad_id`; the existing `google_text_ad.id` is reused.
The update does not create a second canonical ad:

- `google_text_ad`: updates type, canonical `ad_position=FEED`, source,
  `system_id`, domain/country/owner links and running dates. Transparency
  `subnetwork` is stored separately. Existing `post_date` is kept; it is filled
  only when currently null/sentinel. A valid existing `first_seen`
  is untouched when the payload value is null; otherwise the earlier value is
  kept. `last_seen` always participates in the update, and a null payload value
  is normalized to server current time before keeping the later value.
- `google_text_ad.language_id`: a usable translation updates the detected
  language and reuses/creates the common `languages` row. A successful but
  empty translation result clears it to the live-schema placeholder `0`.
  An optional translation API failure preserves the previous valid language.
- `google_ad_translation`: translated title/text/description are upserted for
  the same canonical ad. A successful empty result clears these columns to
  blank SQL placeholders; Elasticsearch/search exposes them as `null`. If
  translation is optional and temporarily fails, existing translated values
  are preserved.
- `google_text_ad_variants`: updates title, text and original image URL. The NAS
  image path changes only after a successful first/missing-image upload.
- `google_text_ad_post_owners.post_owner_image` is uploaded/updated only when
  the shared owner has no successful non-default image.
- `google_text_ad_meta_data`: sets platform 18 and updates version, destination
  URL and desktop last-seen; the original desktop first-seen is retained.
- `google_transparency_ad_payload`: updates `ad_url`, destination-independent
  Transparency fields, aggregate impressions, video source, `redirect_url`,
  `othermultimedia`, and refreshes `received_at`. `destination_url` is updated
  in the common metadata table.
- `google_transparency_country_delivery`: same country updates its earliest
  first-seen, latest last-seen and current impression interval. A previously
  unseen country is appended at the next ordinal. The composite primary key
  prevents duplicates.
- Existing country relationship counters are incremented for countries in the
  new payload; existing dimension rows are reused.
- Elasticsearch indexes the rebuilt document using the same canonical ID.
  Existing successful NAS image/video paths are carried forward. Video download
  is queued only when the VIDEO `image_video_url` NAS path is still missing.

## Elasticsearch

The document keeps the existing flat Google fields (`id`, `ad_id`, title/text,
owner, dates, country, destination, image/NAS paths, platform) and adds:

```text
advertiser_id, ad_url, subnetwork, region_code,
impressions_min, impressions_max, impressions_operator,
video_url_original, othermultimedia, country_details,
language_id, lang_detect,
ad_title, ad_text, news_feed_description
```

The additions are declared in `scripts/google_ads_data_v2.mapping.json`.
`lang_detect` is the normalized two-letter detected-language value used by the
existing language filter. `ad_title`, `ad_text`, and
`news_feed_description` contain translated copy; `title` and `text` retain the
original creative.
`country_details` is a bounded `nested` field so its country, code,
`first_seen`, `last_seen`, and `times_shown` bounds are searchable while preserving per-country
association. Unknown nested keys remain disabled. Large display-only URLs and
other-media values are stored but not indexed.

### Search response null contract

`POST /api/v1/common/ads/search` uses the Google controller for Google hits.
For `platform=18`, SQL-safe compatibility placeholders never become frontend
business values:

The Google search query `_source` allow-list must include `platform`,
`image_video_url`, the original primary URLs, and `othermultimedia`.
If `platform` is omitted there, the controller cannot identify the hit as
platform 18: the API drops the discriminator and the frontend intentionally
falls back to the legacy Google text-card behavior.

- unknown `post_date`, original `first_seen`, language, and translated copy are
  returned as JSON `null`, not sentinel dates, `0`, empty strings, or English;
- `platform` is returned as the integer `18`;
- `image_video_url` is the only primary display URL for both IMAGE and VIDEO;
- `othermultimedia` contains successful NAS paths and is omitted when empty;
- `image_url_nas`, `nas_video_url`, `othermultimedia_original`,
  `carousel_media`, `language_id`, and `lang_detect` are internal and are not
  returned. NAS image/video writes are controlled only by
  `insertion.nas.store` in server `config.json` (or `NAS_STORE_IMAGE` /
  `NAS_STORE_VIDEO`). A payload-level `store` field is rejected.

The React `MasonryCard` applies these rules only when `platform === 18`:

- `type=TEXT` is the Transparency creative category, not a forced text-only
  card: when `image_video_url` exists it renders as media, and only a missing
  URL falls back to the Google text card;
- the visible card type remains `TEXT`; frontend `renderType` selects the
  image/video element without relabelling the creative as IMAGE or VIDEO;
- every media card chooses `<img>` or `<video>` from the extension of
  `image_video_url`, including TEXT creatives;
- carousel images and videos use the NAS-only `othermultimedia` array;
- the detail modal uses the same `renderType`, so a TEXT creative with media
  renders its image/video while retaining the TEXT label;
- Show Original for an image creative displays `image_url_original` directly
  with natural aspect (`height:auto`, `object-contain`) and no simulated Google
  Search layout, crop, overlay, or NAS substitution;
- a visible `Transparency` badge differentiates the card. Normal Google cards
  do not enter this branch.

The existing Google search APIs accept these platform-18 filters:

| Request field | Shape | ES behavior |
|---|---|---|
| `seen_btn_sort` | existing two-value last-seen range | matches top-level `last_seen` **or** nested `country_details.last_seen` |
| `country_first_seen` | `[from,to]` timestamps/dates | nested `first_seen` range |
| `country_last_seen` | `[from,to]` timestamps/dates | nested `last_seen` range |
| `country_times_shown` / `times_shown` | `[min,max]` | overlaps the nested impression interval |
| `country_detail_code` | code or array | nested alpha-2 country-code filter |
| `country` | existing country filter | also constrains the same nested row whenever a delivery filter is used |

Explicit delivery filters accept RFC 3339 timestamps or `YYYY-MM-DD`. Impression
filtering understands `range`, unbounded `over`, and unbounded `under` records.

Apply the additive field mapping with:

```powershell
node scripts/apply-google-transparency-es-mapping.js
node scripts/apply-google-transparency-es-mapping.js --apply
```

The first command is offline/dry-run. `--apply` resolves the configured Google
index, checks for an incompatible pre-existing `country_details` object, and
uses the correct typed ES 6 or typeless ES 7+ mapping request. Elasticsearch
cannot change an existing plain object to `nested`; if that conflict is found,
create/reindex using `google_ads_data_v2.mapping.json`.

Before enabling producers, apply the mapping additions (or create/cut over to
the v2 index using the existing Google mapping runbook). Because the mapping is
`dynamic:false`, skipping this step would store new keys in `_source` but make
the new filter fields unsearchable.

## File map

```text
src/services/google/routes/google18TransparencyInsertionRoutes.js
src/services/google/controllers/googleTransparencyAdsController.js
src/services/google/transparencyInsertion/
  validate.js
  normalize.js
  repository.js
  esDocBuilder.js
  pipeline.js
scripts/google_transparency_schema.sql
scripts/apply-google-transparency-schema.js
scripts/rollback-google-transparency-schema.sql
scripts/rollback-google-transparency-schema.js
scripts/google_transparency_es_fields.mapping.json
scripts/apply-google-transparency-es-mapping.js
tests/services/google/transparencyInsertion/
src/services/ServiceRegistry.js  (deterministic route-file ordering only)
```

## Verification

```powershell
.\node_modules\.bin\vitest.cmd run tests\services\google\transparencyInsertion
node -e "JSON.parse(require('fs').readFileSync('scripts/google_ads_data_v2.mapping.json','utf8'))"
node scripts/apply-google-transparency-schema.js
node scripts/apply-google-transparency-es-mapping.js
```

After a real insert, verify the links:

```sql
SELECT a.id, a.ad_id, a.type, m.platform, t.advertiser_id,
       t.subnetwork, t.region_code, a.system_id, m.version
FROM google_text_ad a
JOIN google_text_ad_meta_data m ON m.google_text_ad_id = a.id
JOIN google_transparency_ad_payload t ON t.google_text_ad_id = a.id
WHERE a.ad_id = 'CR...';

SELECT co.country, d.country_code, d.first_seen, d.last_seen,
       d.impressions_min, d.impressions_max, d.impressions_operator
FROM google_transparency_country_delivery d
JOIN google_text_country_only co ON co.id = d.country_only_id
WHERE d.google_text_ad_id = <internal-id>
ORDER BY d.ordinal;
```

Expected ES invariant: document `_id`, `_source.id`, and
`google_text_ad.id` are the same value; `_source.platform` is `18`.

## Deployment order and rollback

From the `pas_node_api` directory:

1. Configure `LANGUAGE_TRANSLATION_API`. Translation is required by default
   (`insertion.api.translationRequired=true`).
2. Preview SQL:
   `node scripts/apply-google-transparency-schema.js`
3. Apply the two additive SQL tables:
   `node scripts/apply-google-transparency-schema.js --apply`
4. Preview the ES mapping:
   `node scripts/apply-google-transparency-es-mapping.js`
5. Apply the ES mapping:
   `node scripts/apply-google-transparency-es-mapping.js --apply`
6. Deploy/restart the Node API.
7. Send one TEXT, one IMAGE, one empty-`country_details`, and one invalid
   payload; verify SQL/ES/NAS and the 422 response.
8. Enable production producers gradually.

The existing delete endpoint supports both legacy and platform-18 rows:

```text
POST /api/v1/google/insertion/delete
body: {"id": <internal-id>} or {"ad_id": "CR..."}
auth: x-delete-token
```

It deletes both Transparency child rows, the existing Google child rows, the
canonical ad, and the ES document in the existing transaction/pipeline.

To remove only the two newly created SQL tables, first stop platform-18
producers and delete/export any data that must be retained. Then:

```powershell
# Preview only
node scripts/rollback-google-transparency-schema.js

# Destructive: prints row counts, then drops only google_transparency_* tables
node scripts/rollback-google-transparency-schema.js --apply --confirm-drop
```

This schema rollback does not delete canonical `google_text_*` ads and does not
remove fields from an existing ES mapping. Removing ES mapping fields requires
creating/reindexing into a clean index. The legacy insertion flow needs no code
rollback.

## SDUI search filters

The Google sidebar configuration is Mongo-driven. Document
`sdui_config.google_transparency` is available only for the Google network and
contains:

- `google_transparency_ads`: toggle. When enabled, the common search API is
  restricted to Google and the Google Elasticsearch query requires
  `platform = 18`.
- `google_transparency_subnetwork`: dependent dropdown. `All` is the default
  and adds no subnetwork clause. The other exact values are `MAPS`, `PLAY`,
  `SHOPPING`, `SEARCH`, and `YOUTUBE`.

The frontend sends these fields to `POST /api/v1/common/ads/search`:

```json
{
  "network": ["google"],
  "platform": 18,
  "google_transparency_ads": true,
  "google_transparency_subnetwork": "SEARCH"
}
```

Manage the Mongo configuration from `pas_node_api`:

```powershell
node scripts/manage-google-transparency-sdui.js --status
node scripts/manage-google-transparency-sdui.js --apply
node scripts/manage-google-transparency-sdui.js --rollback
```

`--apply` saves the pre-change document and exact Google platform matrix once
in `sdui_migration_backups.google_transparency_sdui_v1`. `--rollback` restores
that snapshot; it does not guess the previous state. After applying or rolling
back, refresh the frontend so its cached SDUI response is fetched again.

## Platform-18 analytics UI contract

`POST /api/v1/common/ads/search` keeps the following Transparency fields
structured for the card and analytics modal:

- `platform: 18` and `subnetwork`; the UI labels `subnetwork` as **Platform**
  (`SEARCH`, `SHOPPING`, `MAPS`, `PLAY`, or `YOUTUBE`).
- `impressions: {min, max, operator}`; this is an estimate and must not be
  converted to a fake exact count.
- `country_details[]`, including each country's first/last seen dates and
  `times_shown` estimate.
- `first_seen`, `last_seen`, `post_date`, and `city` remain nullable.

The analytics modal renders these fields in the isolated **Transparency
Delivery** panel. Impression estimates use plain-language cards instead of a
technical axis: `range` is shown as **From / To**, `over` as **At least** with
no reported upper limit, and `under` as **Up to**.
`country_details` drives three separate analytics views:

- readable overall and per-country impression range cards;
- readable country activity cards showing `first_seen`, `last_seen`, and the
  inclusive active-day count;
- a platform-18 choropleth keyed by `country_code`, shaded logarithmically by
  the minimum/baseline `times_shown` value.

All three support multiple countries and use the readable `21 Dec 2025` date
form. Missing values are shown as `--`.

The pre-existing **Country Reach** Map/Globe, date range, and AD
LEVEL/ADVERTISER LEVEL analytics remain a separate component and are not
changed or replaced by Transparency Delivery.

SQL may keep an operational current-time fallback for a missing `last_seen`,
but the Elasticsearch/search document receives `null` when the producer did
not send that value, so generated metadata is not presented as scraper data.

The Transparency panel and its country visualization render only for
`platform = 18`. Legacy Google analytics, keywords, lander behavior, and every
other network retain their existing flow.
