# AdMob - ERD (SQL + Elasticsearch)

[<- back to index](README.md) - MySQL DB `pasdev_admob` - ES index `mob_search_mix`

Source of truth: [scripts/admob/mobdb.schema.sql](../../scripts/admob/mobdb.schema.sql),
[src/services/admob/insertion/repository.js](../../src/services/admob/insertion/repository.js),
[src/services/admob/insertion/esDocBuilder.js](../../src/services/admob/insertion/esDocBuilder.js),
[scripts/admob/mob_search_mix.mapping.json](../../scripts/admob/mob_search_mix.mapping.json).

> **Independent mobile-app ad network.** AdMob does not reuse the Google SQL schema or Google
> Transparency index. SQL stores one main `mob_ads` row per public `ad_id`, then fans out into
> dimensions (`country`, `state`, `sub_network`, `source_app`), URLs, media, retry-safe
> observations, and an ES outbox. **ES doc is FLAT** with nested detail arrays for dimensions.

---

## SQL ERD

```mermaid
erDiagram
    mob_post_owners ||--o{ mob_ads : "owner"
    mob_ads ||--o| mob_ad_urls : "urls"
    mob_ads ||--o{ mob_ad_media : "media"
    mob_ads ||--o{ mob_ad_countries : "country dimension"
    mob_ads ||--o{ mob_ad_states : "state dimension"
    mob_ads ||--o{ mob_ad_sub_networks : "sub-network dimension"
    mob_ads ||--o{ mob_ad_source_apps : "source apps"
    mob_source_apps ||--o{ mob_ad_source_apps : "app catalog"
    mob_ads ||--o{ mob_ad_observations : "observations"
    mob_ads ||--o| mob_es_outbox : "ES retry queue"

    mob_post_owners {
        bigint id PK
        string name
        string name_key "GENERATED, UNIQUE"
        string image_url
        bigint ads_count
        timestamp created_at
        timestamp updated_at
    }
    mob_ads {
        bigint id PK
        string ad_id "UNIQUE public identity"
        bigint post_owner_id FK
        string type
        smallint platform
        string network
        string source
        text ad_title
        text ad_text
        text newsfeed_description
        string ad_image_size
        smallint ad_number_position
        string ad_position
        string ad_sub_position
        string city
        string ip_address
        datetime first_seen
        datetime last_seen
        datetime post_date
        string system_id
        string version
        tinyint status
        timestamp created_at
        timestamp updated_at
    }
    mob_ad_urls {
        bigint ad_id PK, FK
        text ad_url
        text destination_url
        text redirect_url
        text placement_url
        text target_site
        string destination_host
        timestamp updated_at
    }
    mob_ad_media {
        bigint id PK
        bigint ad_id FK
        enum media_kind "IMAGE, VIDEO, THUMBNAIL"
        smallint ordinal
        text original_url
        string nas_path
        timestamp created_at
        timestamp updated_at
    }
    mob_ad_countries {
        bigint ad_id PK, FK
        string country
        string country_key "GENERATED"
        bigint appearance_count
        datetime first_seen
        datetime last_seen
    }
    mob_ad_states {
        bigint ad_id PK, FK
        string state
        string state_key "GENERATED"
        bigint appearance_count
        datetime first_seen
        datetime last_seen
    }
    mob_ad_sub_networks {
        bigint ad_id PK, FK
        string sub_network
        string sub_network_key "GENERATED"
        bigint appearance_count
        datetime first_seen
        datetime last_seen
    }
    mob_source_apps {
        bigint id PK
        string source_app
        string source_app_key "GENERATED"
        string source_app_pkg
        bigint appearance_count
        datetime first_seen
        datetime last_seen
    }
    mob_ad_source_apps {
        bigint ad_id PK, FK
        bigint source_app_id PK, FK
        bigint appearance_count
        datetime first_seen
        datetime last_seen
    }
    mob_ad_observations {
        bigint id PK
        bigint ad_id FK
        string system_id
        binary payload_hash
        datetime observed_at
        timestamp created_at
    }
    mob_es_outbox {
        bigint ad_id PK, FK
        smallint attempts
        text last_error
        datetime next_retry_at
        timestamp created_at
        timestamp updated_at
    }
```

**Important constraints**

- `mob_ads.ad_id` is the immutable public ad identity.
- `mob_ad_media` has a unique media slot per `(ad_id, media_kind, ordinal)`.
- `mob_ad_observations` has a unique retry-safe observation key per `(ad_id, system_id)`.
- `mob_source_apps` deduplicates global apps by `(source_app_key, source_app_pkg)`.
- Per-ad dimensions use generated lowercase keys so matching is case-insensitive.

---

## Elasticsearch - index `mob_search_mix` (FLAT + nested details)

Document = one ad, flat top-level keys plus nested dimension detail arrays. `_id` = internal
`mob_ads.id`.

| Group | Fields |
|---|---|
| Core | `id`, `ad_id`, `type`, `platform`, `network`, `source`, `status`, `system_id`, `version` |
| Creative | `ad_title`, `ad_text`, `newsfeed_description`, `ad_image_size`, `ad_number_position`, `ad_position`, `ad_sub_position` |
| Owner | `post_owner_id`, `post_owner`, `post_owner_image` |
| Dates | `first_seen`, `last_seen`, `post_date`, `indexed_at` |
| URL / lander | `ad_url`, `destination_url`, `redirect_url`, `placement_url`, `target_site`, `destination_host` |
| Media | `image_url_original`, `image_url` |
| Geo / dimension arrays | `country`, `state`, `sub_network`, `source_app`, `source_app_pkg` |
| Aggregates | `source_app_count` |
| Nested detail arrays | `country_details`, `state_details`, `sub_network_details`, `source_app_details` |

**Nested detail shapes**

- `country_details[]` -> `name`, `appearance_count`, `first_seen`, `last_seen`
- `state_details[]` -> `name`, `appearance_count`, `first_seen`, `last_seen`
- `sub_network_details[]` -> `name`, `appearance_count`, `first_seen`, `last_seen`
- `source_app_details[]` -> `name`, `package`, `appearance_count`, `first_seen`, `last_seen`

**Mapping notes**

- Index mapping is `dynamic: "strict"` to catch contract drift early.
- Text search is limited to `post_owner`, `ad_title`, `ad_text`, and `newsfeed_description`.
- Dimension filters are case-insensitive `keyword` fields using the `mob_lowercase` normalizer.
- URL fields and image paths are stored as `keyword` with `index: false`.
- `ip_address` is typed as Elasticsearch `ip` with `ignore_malformed: true`.

---

## Write flow

```text
payload
  -> validate / normalize
  -> SELECT ... FOR UPDATE on mob_ads by public ad_id
  -> upsert owner
  -> insert/update mob_ads
  -> upsert URLs
  -> upsert IMAGE original_url slot
  -> insert observation (retry-safe per ad_id + system_id)
  -> upsert country/state/sub_network rows
  -> upsert source_app master + per-ad source_app pivot
  -> queue mob_es_outbox
  -> commit
  -> upload media to NAS
  -> set mob_ad_media.nas_path
  -> build flat ES doc
  -> index into mob_search_mix
  -> delete outbox row on success / retain for retry on failure
```

This makes MySQL the source of truth while `mob_es_outbox` guarantees Elasticsearch can catch up
after transient indexing failures.
