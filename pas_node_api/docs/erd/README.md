# PowerAdSpy Node API — Data Model & Architecture (Bird's‑Eye View)

> Entity‑Relationship reference for the **SQL** (MySQL) and **Elasticsearch** stores behind the
> PowerAdSpy ad‑intelligence API, plus a high‑level map of how data flows through the system.
>
> This is the **index**. Each ad network has its own full table‑level ERD in a sibling file —
> see [Per‑network ERDs](#per-network-erds). For the runtime/insertion internals see
> [../MANIFEST.md](../MANIFEST.md) and [../KT-INSERTION-PROCESS.md](../KT-INSERTION-PROCESS.md).

---

## 1. What this system is

A multi‑network ad‑spy backend. For each advertising network it **ingests** ads (insertion engine),
**stores** the relational truth in a per‑network MySQL database, **denormalizes** each ad into a
per‑network Elasticsearch index for fast faceted search, and **serves** search/detail/landers/OCR
endpoints to the frontend.

**11 networks:** `facebook`, `instagram`, `gdn`, `youtube`, `google`, `native`, `linkedin`,
`reddit`, `quora`, `pinterest`, `tiktok`.

Every network is **self‑contained** under `src/services/<net>/` and shares only the engine
(`src/insertion/`), middleware, config loader, and `DatabaseManager`.

---

## 2. The two stores per network

| Store | Role | Shape |
|---|---|---|
| **MySQL** (`pasdev_<net>`) | Source of truth, normalized | One main `<net>_ad` table + ~15–25 child/lookup tables (3NF‑ish) |
| **Elasticsearch** (`<net>_search_mix` / `<net>_ads_data`) | Read/search model, denormalized | One big flattened document per ad — a JOIN of the SQL graph, language‑fanned, plus synthetic & AI fields |

The ES document is built per network by `insertion/esDocBuilder.js` from a SQL "joined ad" row
(`repository.getJoinedAd`). **Writes go to MySQL first, then the denormalized doc is pushed to ES.**

---

## 3. Network registry (at a glance)

| Network | MySQL DB | Main table prefix | ES index | ES server | Doc shape | Insertion |
|---|---|---|---|---|---|---|
| Facebook | `pasdev_facebook` | `facebook_ad` | `search_mix` | shared 6.8 | nested (dotted) | ✅ live |
| Instagram | `pasdev_instagram` | `instagram_ad` | `instagram_search_mix` | shared 6.8 | nested (dotted) | ✅ live |
| GDN | `pasdev_gdn` | `gdn_ad` | `gdn_search_mix` *(live: `gdn_search_mix_v2`)* | shared 6.8 | nested (dotted) | ✅ live |
| YouTube | `pasdev_youtube` | `youtube_ad` | `youtube_ads_data` | shared 6.8 | **flat** | ✅ |
| Google (GT) | `pasdev_gtext` | `google_text_ad` | `google_ads_data` | shared 6.8 | **flat** | ✅ |
| Native | `pasdev_native` | `native_ad` | `native_search_mix` *(live: `native_search_mix_v2`)* | shared 6.8 | nested (dotted) | ✅ live |
| LinkedIn | `pasdev_linkedin` | `linkedin_ad` | `linkedin_ads_data` | shared 6.8 | **flat** (epoch dates) | ✅ |
| Reddit | `pasdev_reddit` | `reddit_ad` | `reddit_search_mix` | shared 6.8 | nested (dotted) | ✅ |
| Quora | `pasdev_quora` | `quora_ad` | `quora_search_mix` | shared 6.8 | nested (dotted) | ✅ |
| Pinterest | `pasdev_pinterest` | `pinterest_ad` | `pinterest_search_mix` | shared 6.8 | nested (dotted) | ✅ |
| TikTok | `tiktok_database_development` | *(read‑only)* | `tiktok_ads` | **separate 8.1** | **flat** | ❌ read‑only |

> ES server versions: all networks share the 6.8 cluster **except TikTok**, which is on a separate
> 8.1 cluster (config key `elastic_tiktok`). Index names resolve from
> [config.json](../../config.json) `networks.<net>.elastic.index` via
> [src/config/networks.js](../../src/config/networks.js).

---

## 4. System architecture (bird's‑eye flow)

```mermaid
flowchart TB
    subgraph Clients
        FE[Frontend / SPA]
        SCR[Scrapers / Insertion clients]
    end

    subgraph API["Node API (Express, optional cluster fork-per-core)"]
        MW["Middleware<br/>auth · rate-limit · insertionAuth(HMAC) · insertionEnabled"]
        REG["ServiceRegistry<br/>per-network service instances"]
        ENG["Shared InsertionEngine<br/>bounded concurrency, per-ad isolation"]
        SVC["src/services/&lt;net&gt;/<br/>controllers · builders · insertion · landers · ocr"]
        JOBS["Cron jobs<br/>snapshots · keyword audit · NAS retry · notifications"]
        ADMIN["Admin panel · SDUI · metrics"]
    end

    subgraph Stores
        SQL[("MySQL<br/>pasdev_&lt;net&gt;")]
        ES[("Elasticsearch 6.8<br/>&lt;net&gt;_search_mix")]
        ESTT[("Elasticsearch 8.1<br/>tiktok_ads")]
        MONGO[("MongoDB<br/>keyword_searches · sdui_config · notifications")]
        REDIS[("Redis / SQLite<br/>cache")]
        NAS[["NAS / CDN<br/>media.globussoft.com"]]
    end

    FE -->|"search / detail / landers"| MW
    SCR -->|"POST insertion / delete"| MW
    MW --> REG --> SVC
    SVC -->|insert/update| ENG

    ENG -->|1 normalized write| SQL
    ENG -->|2 denormalized doc| ES
    ENG -->|media after commit| NAS
    SVC -->|read/search| ES
    SVC -->|tiktok read| ESTT
    SVC --> MONGO
    SVC --> REDIS
    JOBS --> SQL
    JOBS --> ES
    JOBS --> MONGO
    DBM["DatabaseManager<br/>per-network connection pools"] --- SQL
    DBM --- ES
    DBM --- MONGO
    REG -.injects.-> DBM
```

**Insertion path (per ad):** validate → normalize → `withTransaction` (insert/update the `<net>_ad`
graph) → commit → build denormalized ES doc (`getJoinedAd` → `esDocBuilder`) → index to ES → upload
media to NAS (fire‑and‑forget with a durable retry queue). External calls (translation, impression,
popularity) run in parallel; media moves out of the DB transaction.

**Read path:** controller → `SearchMixQueryBuilder` builds an ES query against `<net>_search_mix`
→ results hydrated → optional MySQL/Mongo enrichment → response.

---

## 5. The canonical SQL model (shared shape)

Every "full" network follows the **same relational pattern** — only the `<net>_` prefix and a few
per‑network tables differ. The generic shape:

```mermaid
erDiagram
    net_ad ||--o{ net_ad_variants : "1..N creatives"
    net_ad ||--o| net_ad_meta_data : "1..1 lander/meta"
    net_ad ||--o{ net_ad_analytics : "daily metrics"
    net_ad ||--o{ net_ad_countries : "geo pivot"
    net_ad ||--o{ net_ad_countries_only : "geo pivot"
    net_ad ||--o| net_ad_translation : "1..1 translated text"
    net_ad ||--o{ net_ad_url : "display/redirect URLs"
    net_ad ||--o{ net_ad_outgoing_links : "redirect chain"
    net_ad ||--o| net_ad_image_video : "carousel/media"
    net_ad ||--o{ net_ad_users : "discovery pivot"
    net_ad }o--|| net_ad_post_owners : "advertiser"
    net_ad }o--|| net_ad_domains : "landing domain"
    net_ad }o--|| net_call_to_actions : "CTA (dedup)"
    net_ad }o--|| net_category : "category (dedup)"
    net_ad }o--|| net_country : "primary geo"
    net_ad }o--|| languages : "ad language"
    net_country }o--|| net_country_only : "rolls up to"
    net_ad_countries }o--|| net_country_only : "geo"

    net_ad {
        int id PK
        string ad_id "platform id (unique)"
        int post_owner_id FK
        int domain_id FK
        int country_id FK
        int call_to_action_id FK
        int category_id FK
        int language_id FK
        datetime post_date
        datetime first_seen
        datetime last_seen
        int days_running
        string type
    }
    net_ad_post_owners {
        int id PK
        string post_owner_name
        string post_owner_lower "dedup key"
        string post_owner_image
        int ads_count
    }
    net_ad_variants {
        int id PK
        int net_ad_id FK
        string title
        string text
        string newsfeed_description
        string image_url
        string image_ocr
    }
    net_ad_meta_data {
        int net_ad_id FK "PK in many nets"
        string destination_url
        string built_with
        string affiliate_data
        string screenshot_url
    }
    net_ad_translation {
        int net_ad_id FK
        string ad_title
        string ad_text
        string news_feed_description
    }
    net_country_only {
        int id PK
        string country "dedup key"
    }
    languages {
        int id PK
        string iso
        string name
    }
```

**Shared / cross‑network lookup tables** (not prefixed): `languages`, `country_data`
(ISO ↔ name), and for placement‑based networks `target_site` and `networks` (ad‑network
registry used by Native/GDN).

**Per‑network deltas** (why each file is still worth reading):
- **Facebook/Instagram** add `*_meta_ad_budget`, `*_lib_page_details`/`*_page_details`,
  `*_comments`, `*_accounts_activities`, `country` + `country_only`.
- **GDN/Native** add `*_target_site` / `*_ad_target_site`, `*_placement_url`, `networks`,
  and a `phash` near‑duplicate column on the main ad table.
- **YouTube** swaps image for **video** (`video_url`, `thumbnail_url`, `channal_url`, `*_ad_ocb`)
  and uses likes/dislikes/views analytics.
- **Google (GT)** uses `google_text_*` names, `target_keyword`/`target_page` on variants.
- **LinkedIn** splits meta into `*_built_with`, `*_ad_lander`, `*_ocr_ocb_details`, and stores
  `followers` in analytics; **dates are UNIX epoch integers** in ES.
- **Reddit/Quora/Pinterest** carry `*_user`/discoverer columns, `tags`, and Pinterest adds
  platform‑15 targeting (interests, keywords, reach by country).

---

## 6. The Elasticsearch model (shared shape)

Each ad becomes **one denormalized document**. Two flavors exist:

- **Nested‑dotted** (facebook, instagram, gdn, native, reddit, quora, pinterest): keys keep their
  SQL origin as dotted paths, e.g. `facebook_ad_variants.title`, `facebook_ad_post_owners.post_owner_name`.
- **Flat** (youtube, google, linkedin, tiktok): friendly top‑level keys, e.g. `ad_title`, `post_owner`,
  `destination_url`.

```mermaid
flowchart LR
    DOC["ES doc = 1 ad"] --> CORE["core: id, ad_id, post_date,<br/>first_seen, last_seen, days_running, type"]
    DOC --> CREATIVE["creative: title / text /<br/>newsfeed_description (+ _ru _fr _sp _ge _exactly)"]
    DOC --> OWNER["advertiser: post_owner_name(+lang),<br/>post_owner_lower, post_owner_image, verified"]
    DOC --> IMG["image AI: image_ocr, image_object,<br/>image_celebrity, image_brand_logo"]
    DOC --> META["lander: destination_url, built_with,<br/>affiliate_data, redirect/url chains"]
    DOC --> GEO["geo: country, states, city"]
    DOC --> TRANS["translation: ad_text/ad_title +<br/>&lt;net&gt;_translations.&lt;lang&gt;"]
    DOC --> SYN["synthetic: html, mixdata, lang_detect,<br/>new_nas_image_url, nas_video_url"]
    DOC --> SCORE["AI scores: creative_predicted_ctr,<br/>creative_hook/hold_score, creative_total_score"]
    DOC --> CAT["taxonomy: &lt;net&gt;.category, &lt;net&gt;.subCategory"]
```

**Language fan‑out:** searchable text fields are duplicated with suffixes
`_ru _fr _sp _ge _exactly` (the `_exactly` variant is a non‑analyzed/keyword copy for exact match).
**Synthetic fields:** `html`/`mixdata` (concatenated text for full‑text), `lang_detect`,
`<net>_user_countries`. **AI creative scores** are written later by `creativeScoreController`.
**Category** (`<net>.category` / `<net>.subCategory`) is written by the shared
`addCategoryController` (`newCatInsertion`) — see [../../src/services/common/controllers/addCategoryController.js](../../src/services/common/controllers/addCategoryController.js).

---

## 7. Per‑network ERDs

Each file contains the **full table‑level SQL `erDiagram`** + the **ES field reference** for that network:

| Network | File |
|---|---|
| Facebook | [facebook.md](facebook.md) |
| Instagram | [instagram.md](instagram.md) |
| GDN | [gdn.md](gdn.md) |
| YouTube | [youtube.md](youtube.md) |
| Google (GT) | [google.md](google.md) |
| Native | [native.md](native.md) |
| LinkedIn | [linkedin.md](linkedin.md) |
| Reddit | [reddit.md](reddit.md) |
| Quora | [quora.md](quora.md) |
| Pinterest | [pinterest.md](pinterest.md) |
| TikTok | [tiktok.md](tiktok.md) |

---

## 8. How to read the ERDs

- **PK** = primary key, **FK** = foreign key. `<table>.<col> → <table>.<col>` calls out the reference.
- Relationship crow's‑feet: `||--o{` = one‑to‑many, `||--o|` = one‑to‑one(optional),
  `}o--||` = many‑to‑one.
- Column lists favor **keys + identifying/searchable columns**; exhaustive nullable detail
  lives in the code (`insertion/repository.js` per network is the source of truth for SQL,
  `insertion/esColumns.js` + `esDocBuilder.js` for ES).
- Diagrams render natively on GitHub and in VS Code's Markdown preview (Mermaid).

> **Source of truth:** these diagrams are derived from each network's
> `insertion/repository.js`, `esColumns.js`, `esDocBuilder.js`, `deletePipeline.js`, and read
> controllers. If code and diagram disagree, the code wins — please update the diagram.
