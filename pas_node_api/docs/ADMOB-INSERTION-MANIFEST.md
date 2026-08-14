# AdMob Network Insertion Manifest

## Scope and isolation

AdMob is an independent network named `admob`. It does not use the Google service,
Google MySQL tables, or Google Elasticsearch index. Its only shared dependencies are
the common insertion engine, insertion authentication, and NAS/media helpers.
User-specific saved/hidden/favourite state for AdMob is stored separately in
`pasdev_admob.mob_hidden_ads`. That state is not indexed into Elasticsearch; it is
only used by the AdMob search routes to build Saved / Hidden views on top of the
same `mob_search_mix` ad index.

| Resource | Value |
|---|---|
| Insert API | `POST /api/v1/admob/insertion/adsData` |
| Search API | `POST /api/v1/admob/ads/search` |
| Common UI search | `POST /api/v1/common/ads/search` with `network: ["admob"]` |
| Platform | `19` |
| Payload network | `mob-network` |
| MySQL database | `pasdev_admob` |
| Elasticsearch index | `mob_search_mix` |
| NAS prefix | `admob` |

The insert API accepts one object, a bare array, or `{ "ads": [...] }`.

## Contract

Required fields are `ad_id`, `country`, `last_seen`, `network`, `platform`,
`source`, `session_id`, `system_id`, `type`, `version`, and `source_app`.

There is no `sub_type` field. `type` directly stores one of:

`BANNER`, `WEBVIEW_BANNER`, `INTERSTITIAL_OR_NATIVE`, `INTERSTITIAL_WEBVIEW`,
`NATIVE_OR_UNKNOWN`, `REWARDED_OR_VIDEO`, `PLAY_STORE_AD`, `VISUAL_BANNER`,
`VISUAL_NATIVE_AD`, or `UNKNOWN`.

`source_app_pkg` is optional. All other documented payload fields are optional and
may be null where validation permits. Unknown fields are rejected to prevent silent
data loss caused by producer/consumer contract drift.

## Update rules

- `ad_id` is the public immutable identity and has a unique index.
- `first_seen` is owned by PAS. When the crawler does not send it, PAS stamps
  the first insert time as the ad's `first_seen`.
- `last_seen` is still accepted by the payload and is used as the observation
  timestamp for the ingestion flow.
- `post_date` is immutable after its first non-null value (`COALESCE` update).
- Country values must be unique within a payload. Country, state, and sub-network
  are stored as case-insensitive per-ad dimensions with appearance counts.
- Source app and package form a case-insensitive identity. Global and per-ad
  appearance counts are maintained.
- `(ad_id, session_id)` is a unique observation. Retrying the same event updates the
  ad safely but does not increase dimension or source-app counts.
- AdMob search documents also expose `occurrence_count`, `days_running`, and
  `lead_score` so the dashboard can rank long-running, frequently seen posters.
- Saved / hidden / favourite actions are stored separately in `mob_hidden_ads`
  using `type=1` (hide advertiser), `type=2` (hide ad), and `type=3`
  (favourite ad). Those actions do not change the ingestion row in `mob_ads`.

All values are bound parameters. Ad row updates use `SELECT ... FOR UPDATE`, and the
ad, dimensions, source app, observation, URL, and ES outbox writes share one transaction.

## Media and NAS

Media kind is independent from the AdMob `type`. When `image_url_original` is present,
the pipeline treats it as an image even when `type` is `BANNER` or another AdMob type.

For `tmpfiles.org` page URLs, the resolver reads the page and extracts its direct
download URL. Existing `/dl/` URLs are used directly. The common media helper then
downloads the actual bytes and uploads them to NAS with this shape:

`/pas-dev/stream/admob/adImage/YYYYMM/<internal_id>.webp`

Both the original source URL and returned NAS path are stored in `mob_ad_media` and
included in Elasticsearch as `image_url_original` and `image_url`.

## Elasticsearch consistency

Every SQL mutation marks `mob_es_outbox` pending in the same transaction. Successful
indexing removes the outbox row. A failed ES write returns a clear partial-failure
response and leaves retry state without inflating counters when the producer retries.

Apply the index definition from `scripts/admob/mob_search_mix.mapping.json` before
enabling insertion. It uses strict mappings and nested analytics dimensions.

Saved / hidden / favourite state is not part of the ES document. The AdMob search
API reads `mob_hidden_ads` first for those views, then returns the matching ads from
`mob_search_mix`.

## Configuration and Plan Control

Runtime settings are under `networks.admob` in `config.json`. The following environment
variables are fallbacks when their corresponding JSON value is absent or null:

`ADMOB_ENABLED`, `ADMOB_INSERTION_ENABLED`, `ADMOB_SQL_ENABLED`,
`ADMOB_SQL_HOST`, `ADMOB_SQL_PORT`, `ADMOB_SQL_USER`, `ADMOB_SQL_PASSWORD`,
`ADMOB_SQL_DATABASE`, `ADMOB_ELASTIC_ENABLED`, `ADMOB_ELASTIC_NODE`,
`ADMOB_ELASTIC_USERNAME`, `ADMOB_ELASTIC_PASSWORD`, and `ADMOB_ELASTIC_INDEX`.

The frontend AdMob platform icon is controlled independently with
`VITE_ENABLE_ADMOB=false`. It is a top-level platform next to TikTok and never
sets a Google or Google Transparency filter.

When `VITE_ENABLE_ADMOB=false`, the frontend also strips AdMob from platform
requests, quick-filter availability probes, search results, shared/public result
meta, and the visible platform selector so AdMob does not surface anywhere in the
client UI.

## SDUI filter hydration

AdMob sidebar filters are hydrated from persisted AdMob insertion history instead of a
hand-maintained static list.

- `source`, `sub_network`, `ad_position`, `ad_sub_position`, `ad_image_size`, and
  `source_app` values are derived from AdMob insertion data and remain available after
  they have been observed.
- New values inserted through the AdMob ingestion flow automatically appear in SDUI
  without manually editing filter options.
- Hydration prefers persistent SQL dimensions over "currently live ads", so once an
  AdMob value has been inserted it remains selectable even if matching creatives are
  no longer part of the latest result set.
- Option hydration is cached briefly in the API process. Newly inserted AdMob values
  become available in SDUI after the next refresh cycle, without any manual seed or
  config update.
- Empty AdMob-only filters stay visible instead of falling back to generic cross-network
  options.
- When the selected platform is only `admob`, the sidebar is narrowed to AdMob
  sections only: `country`, `source`, `network`, `ad position`, `ad sub position`,
  `image size`, and `source app`.
- Dashboard ranking controls can map to:
  - `Top Ranked` -> `lead_score`
  - `Most Seen` -> `occurrence_count`
  - `Active Days` -> `days_running`
  - `Scan Run` -> `session_id`
- The generic `All` traffic-source option is not shown for AdMob; only live AdMob
  source values are surfaced.
- AI quick filters and AI-meta searches are not applicable to AdMob. When any
  AI-meta filter is active, the client excludes AdMob from the request instead of
  letting unsupported AdMob ads leak into those result sets.

AdMob is registered in the Plan Control network registry, so Admin policy can grant or
deny it per plan. Runtime insertion enablement and customer plan access are separate
controls; both must be enabled for their respective use cases.

## Deployment order

1. Review and apply `scripts/admob/mobdb.schema.sql` with a migration-capable DB user.
2. Create `mob_search_mix` using `scripts/admob/mob_search_mix.mapping.json`.
3. Configure production MySQL, Elasticsearch, insertion auth, and NAS credentials.
4. Publish the intended AdMob access in Admin Plan Control.
5. Restart the API and submit a canary payload to the new AdMob route.
6. Verify `mob_ad_media.nas_path`, the browser-accessible NAS URL, and the ES document.

No Google or Google Transparency route, validator, repository, table, or ES index is
part of this flow.
