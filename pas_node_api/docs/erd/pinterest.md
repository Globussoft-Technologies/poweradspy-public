# Pinterest — ERD (SQL + Elasticsearch)

[← back to index](README.md) · MySQL DB `pasdev_pinterest` · ES index `pinterest_search_mix` (shared 6.8)

Source of truth: [src/services/pinterest/insertion/repository.js](../../src/services/pinterest/insertion/repository.js),
[esColumns.js](../../src/services/pinterest/insertion/esColumns.js),
[esDocBuilder.js](../../src/services/pinterest/insertion/esDocBuilder.js).

> Variants carry `target_keyword` (pipe‑delimited). `pinterest_ad` adds `ad_start_date`/`ad_end_date`.
> **Platform‑15** ads emit extra targeting fields into ES (interests, reach by country, etc.).

---

## SQL ERD

```mermaid
erDiagram
    pinterest_ad ||--o{ pinterest_ad_variants : "creatives"
    pinterest_ad ||--o| pinterest_ad_meta_data : "meta"
    pinterest_ad ||--o| pinterest_ad_translation : "translated"
    pinterest_ad ||--o| pinterest_ad_image_video : "media"
    pinterest_ad ||--o| pinterest_ad_html_lander_content : "lander html"
    pinterest_ad ||--o{ pinterest_ad_countries : "geo"
    pinterest_ad ||--o{ pinterest_ad_countries_only : "geo"
    pinterest_ad ||--o{ pinterest_ad_url : "urls"
    pinterest_ad ||--o{ pinterest_ad_outgoing_links : "redirects"
    pinterest_ad }o--|| pinterest_ad_post_owners : "advertiser"
    pinterest_ad }o--|| pinterest_ad_domains : "domain"
    pinterest_ad }o--|| pinterest_country : "primary geo"
    pinterest_ad }o--|| pinterest_country_only : "geo rollup"
    pinterest_ad }o--|| languages : "language"
    pinterest_country }o--|| pinterest_country_only : "rolls up"
    pinterest_ad_countries }o--|| pinterest_country : "geo"
    pinterest_ad_countries }o--|| pinterest_country_only : "geo"
    pinterest_ad_countries_only }o--|| pinterest_country_only : "geo"

    pinterest_ad {
        int id PK
        string ad_id
        int language_id FK
        int post_owner_id FK
        int domain_id FK
        int country_id FK
        int country_only_id FK
        datetime post_date
        datetime first_seen
        datetime last_seen
        int days_running
        string ad_position
        string ad_sub_position
        string type "IMAGE/VIDEO"
        string source
        int post_owner_updated
        date ad_start_date
        date ad_end_date
    }
    pinterest_ad_post_owners {
        int id PK
        string post_owner_name
        string post_owner_lower
        string post_owner_image
        int ads_count
    }
    pinterest_ad_variants {
        int id PK
        int pinterest_ad_id FK
        string title
        string text
        string newsfeed_description
        string target_keyword "pipe-delimited"
        string image_url
        string image_url_original
        string image_object
        string image_celebrity
        string image_brand_logo
        string image_ocr
    }
    pinterest_ad_meta_data {
        int id PK
        int pinterest_ad_id FK
        string destination_url
        string ad_url
        int platform "10/15"
        string version
        datetime firstSeenOnDesktop
        datetime lastSeenOnDesktop
        string screenshot_url
        string built_with
        string built_with_analytics_tracking
        string affiliate_data
    }
    pinterest_ad_translation {
        int id PK
        int pinterest_ad_id FK
        string ad_title
        string ad_text
        string news_feed_description
    }
    pinterest_ad_image_video {
        int id PK
        int pinterest_ad_id FK
        string ad_image_video
    }
    pinterest_ad_url {
        int id PK
        int pinterest_ad_id FK
        string url
        string url_destination
        string url_redirects
        string url_type
    }
    pinterest_ad_outgoing_links {
        int id PK
        int pinterest_ad_id FK
        string redirect_url
        string source_url
        string final_url
    }
    pinterest_ad_countries {
        int id PK
        int pinterest_ad_id FK
        int country_id FK
        int country_only_id FK
        int count
    }
    pinterest_ad_countries_only {
        int id PK
        int pinterest_ad_id FK
        int country_only_id FK
        int count
        string ip_address
    }
    pinterest_country {
        int id PK
        string city
        string state
        string country
        int country_only_id FK
        int status
    }
    pinterest_country_only {
        int id PK
        string country
    }
    pinterest_ad_domains {
        int id PK
        string domain
        date domain_registered_date
    }
    pinterest_ad_html_lander_content {
        int id PK
        int pinterest_ad_id FK
    }
    languages {
        int id PK
        string iso
        string name
    }
```

**Also present:** `pinterest_hidden_ads` (ad_id, user_id, type 1/2/3),
`pinterest_ad_recommended_activity`, `pinterest_account_activities` (platform‑10 tracking).

---

## Elasticsearch — index `pinterest_search_mix`

Document = one ad, **nested‑dotted** keys. `_id` = internal `pinterest_ad.id`.

| Group | Fields |
|---|---|
| Core | `pinterest_ad.id`, `post_date`, `last_seen`, `first_seen`, `days_running`, `ad_position`, `ad_sub_position`, `type`, `platform`, `pinterest_ad.country` (array) |
| Creative | `pinterest_ad_variants.title`, `.text`, `.newsfeed_description`, `.image_object`, `.image_celebrity`, `.image_brand_logo`, `.image_ocr` — fanned `_ru _fr _sp _ge _exactly`; plus `.target_keyword` (array) |
| Advertiser | `pinterest_ad_post_owners.post_owner_name` (+lang), `.post_owner_lower`, `.post_owner_image` |
| Geo / lang | `pinterest_country_only.country`, `states` (array), `city` (array), `lang_detect` |
| Lander / meta | `pinterest_ad_meta_data.destination_url`, `.firstSeenOnDesktop`, `.built_with`, `.affiliate_data`, `.built_with_analytics_tracking`, `pinterest_ad_domains.domain`, `.domain_registered_date` |
| URLs | `pinterest_ad_url.url`, `.url_destination`, `.url_redirects`, `pinterest_ad_outgoing_links.source_url`, `.redirect_url`, `.final_url` |
| Media | `image_url`, `new_nas_image_url`, `thumbnail` (VIDEO), `image_url_original`, `post_owner_image` |
| Translation | `pinterest_translations.<lang>` |
| **Platform‑15 targeting** | `ad_start_date`, `ad_end_date`, `interests` (array), `keywords_used` (array), `negative_keywords_used` (array), `pinner_list_types`, `pinner_regionslist_types`, `postal_codes`, `reach_count_eu_low`, `reach_count_eu_high`, `reach_count_by_country` (object) |
