# AI-Meta SQL Storage — Schema & Apply Doc

**Applies to:** `AI_META_API_PAYLOAD_SPEC.md` **v1.6** · **Companions:** `AI_META_API_IMPLEMENTATION.md`,
`AI_META_ES_MAPPING_RUNBOOK.md`
**Purpose:** define the SQL side of the AI-Meta dual-write — which table/columns to add per network and
how they connect to the existing ad tables. Verified against the **live dev DB** (MySQL 8.0.46 at the
`databases.sql` host in `config.json`; per-network schemas `pasdev_<net>` + `tiktok_database_development`).

> **Storage model:** ES stays the **query/search store** (filters, autocomplete, fuzzy, aggregations —
> see the mapping runbook). SQL is the **durable system-of-record** copy so AI-Meta survives an ES
> reindex/rebuild and is joinable by non-ES consumers. One row per ad, 1:1 with the ad table.

---

## 1. Design decision — one dedicated table per network

Add a new **`<ad-table>_ai_meta`** table in each network's schema, 1:1 with that network's main ad table
via a unique FK. Rationale:

- **Cohesive & optional** — AI-Meta is a distinct, later-arriving concern; keeping it in its own table
  avoids widening the hot `<net>_ad` / `<net>_ad_meta_data` rows, and a `LEFT JOIN` cleanly yields "no
  AI-Meta yet" as `NULL`.
- **Mirrors the existing pattern** — every network already has `<net>_ad` + satellite `<net>_ad_*`
  tables keyed by `<net>_ad_id`; this is just one more satellite.
- **Idempotent create** — `CREATE TABLE IF NOT EXISTS` means re-running the migration reuses the existing
  table (never drops/recreates).

The only connection required is the FK to the **main ad table** (`<net>_ad.id`); AI-Meta does not need to
touch any child/variant/meta tables.

### Column ↔ v1.5 field mapping

| ai_meta field | SQL column | Type | Notes |
|---|---|---|---|
| `ad_type` | `ad_type` | `VARCHAR(32)` | single enum value |
| `offering_type` | `offering_type` | `VARCHAR(16)` | `product`/`service`/`both` |
| `offering` | `offering` | `VARCHAR(255)` | ≤200 in spec; 255 headroom |
| `caption` | `caption` | `TEXT` | free-text visual description; never indexed, so `TEXT` (survives a loosened cap without `ALTER`) |
| `category` | `category` | `VARCHAR(255)` | major category name; **also** dual-written to `<net>_ad.category_id` (see note) |
| `category_id` | `category_id` | `VARCHAR(4)` | v1.6 4-char taxonomy code (from ai_meta); stored for a faithful copy — SQL linkage uses the name |
| `sub_category` | `sub_category` | `VARCHAR(255)` | may be null (major-only); AI-Meta table is its only SQL home |
| `subcategory_id` | `subcategory_id` | `VARCHAR(8)` | v1.6 8-char taxonomy code (from ai_meta) |
| `intent` | `intent` | `JSON` | array of enum strings |
| `hook` | `hook` | `JSON` | array of enum strings |
| `colors` | `colors` | `JSON` | array of hex strings |
| `offers` | `offers` | `JSON` | array of `{type,value}` objects |
| `roa` | `roa` | `JSON` | `{intent,hook,offering_type,offering}` |

**Why JSON for the multi-valued fields:** `intent`/`hook`/`colors`/`offers`/`roa` are arrays/nested.
MySQL 8 has a native `JSON` type, so we store them as-is (round-trips cleanly, no `||`-delimited
string-parsing like the legacy tables). If you prefer the legacy delimited-string convention instead,
use `TEXT` with a `||` separator for the scalar-array fields — but `offers`/`roa` are structured, so
JSON is strongly recommended there regardless. Scalars are plain columns so they filter/sort without
JSON functions and can be indexed directly (indexes on `ad_type`, `offering_type`, `category` included).

**`category` — dual-write (write to BOTH stores).** The AI-Meta table keeps its own `category` column,
**and** every write must also update the pre-existing category flow so the feed/legacy readers stay
correct. On each API hit, the category is written to:
1. **`<net>_ad_ai_meta.category`** — this table (the AI-Meta copy), and
2. **`<net>_ad.category_id`** — the existing per-ad category FK → the master **`<net>_category`** taxonomy
   table (`id` + `category_name`; resolve/insert the name to its `id`, then set `category_id` on the ad),
   mirrored to ES under `${platform}.category` — exactly the path `newCatInsertion` already uses.

Both writes happen together (same request); the category-table update is the source of truth the feed
reads, and the AI-Meta copy keeps the row self-contained.

**`sub_category`** has **no other SQL home** — the master `<net>_category` table stores only the major
category name, and the only `*subcat*` tables in the schema (`facebook_user_interest_sub_category`,
`facebook_user_interests.subcategory_id`) are audience/interest-targeting data, unrelated to ad
classification (verified live vs `pasdev_facebook`). So the **`<net>_ad_ai_meta.sub_category`** column is
its canonical SQL store; it is also mirrored to ES under `${platform}.subCategory`.

**Removed fields — do NOT add columns for:** `product_type`, `language`, `ocr`, `object`, `brand_logos`,
`status`, **`brand`**, **`celebrity`** (the last two dropped in v1.5).

---

## 2. Per-network targets (verified live)

Each `<net>_ad` has `id INT UNSIGNED PRIMARY KEY` + a unique public `ad_id`. The API looks an ad up by
`ad_id`, gets its numeric `id`, and upserts the `ai_meta` row on that FK.

| Network | Schema (DB) | Ad table | FK column → | FK type |
|---|---|---|---|---|
| facebook | `pasdev_facebook` | `facebook_ad` | `facebook_ad_id` → `facebook_ad.id` | INT UNSIGNED |
| instagram | `pasdev_instagram` | `instagram_ad` | `instagram_ad_id` → `instagram_ad.id` | INT UNSIGNED |
| gdn | `pasdev_gdn` | `gdn_ad` | `gdn_ad_id` → `gdn_ad.id` | INT UNSIGNED |
| youtube | `pasdev_youtube` | `youtube_ad` | `youtube_ad_id` → `youtube_ad.id` | INT UNSIGNED |
| google | `pasdev_gtext` | `google_text_ad` | `google_text_ad_id` → `google_text_ad.id` | INT UNSIGNED |
| native | `pasdev_native` | `native_ad` | `native_ad_id` → `native_ad.id` | INT UNSIGNED |
| linkedin | `pasdev_linkedin` | `linkedin_ad` | `linkedin_ad_id` → `linkedin_ad.id` | INT UNSIGNED |
| reddit | `pasdev_reddit` | `reddit_ad` | `reddit_ad_id` → `reddit_ad.id` | INT UNSIGNED |
| quora | `pasdev_quora` | `quora_ad` | `quora_ad_id` → `quora_ad.id` | INT UNSIGNED |
| pinterest | `pasdev_pinterest` | `pinterest_ad` | `pinterest_ad_id` → `pinterest_ad.id` | INT UNSIGNED |
| tiktok | `tiktok_database_development` | `tiktok_ads` | `ad_id` → `tiktok_ads.id` | **INT** (signed) |

⚠️ **google**'s ad table is `google_text_ad` (schema `pasdev_gtext`), not `google_ad`. ⚠️ **tiktok** uses
FK column name `ad_id` (matching its existing `tiktok_ad_meta_data` convention) and `tiktok_ads.id` is a
signed `INT`, so the FK column is `INT` (not `INT UNSIGNED`). Prod DB names/hosts differ from these dev
values — take the schema name from `networks.<net>.sql.database` in the target env's `config.json`.

---

## 3. DDL — run once per network (idempotent)

Run each block against **its own schema** (`USE <db>;` first, or connect with that DB selected). All are
`CREATE TABLE IF NOT EXISTS`, so re-running is a safe no-op that reuses the existing table.

```sql
-- facebook  (DB: pasdev_facebook)
CREATE TABLE IF NOT EXISTS facebook_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  facebook_ad_id      INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_facebook_ad_ai_meta (facebook_ad_id),
  KEY idx_facebook_ai_ad_type (ad_type),
  KEY idx_facebook_ai_offering_type (offering_type),
  KEY idx_facebook_ai_category (category),
  CONSTRAINT fk_facebook_ad_ai_meta FOREIGN KEY (facebook_ad_id) REFERENCES facebook_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- instagram  (DB: pasdev_instagram)
CREATE TABLE IF NOT EXISTS instagram_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  instagram_ad_id     INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_instagram_ad_ai_meta (instagram_ad_id),
  KEY idx_instagram_ai_ad_type (ad_type),
  KEY idx_instagram_ai_offering_type (offering_type),
  KEY idx_instagram_ai_category (category),
  CONSTRAINT fk_instagram_ad_ai_meta FOREIGN KEY (instagram_ad_id) REFERENCES instagram_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- gdn  (DB: pasdev_gdn)
CREATE TABLE IF NOT EXISTS gdn_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gdn_ad_id           INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gdn_ad_ai_meta (gdn_ad_id),
  KEY idx_gdn_ai_ad_type (ad_type),
  KEY idx_gdn_ai_offering_type (offering_type),
  KEY idx_gdn_ai_category (category),
  CONSTRAINT fk_gdn_ad_ai_meta FOREIGN KEY (gdn_ad_id) REFERENCES gdn_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- youtube  (DB: pasdev_youtube)
CREATE TABLE IF NOT EXISTS youtube_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  youtube_ad_id       INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_youtube_ad_ai_meta (youtube_ad_id),
  KEY idx_youtube_ai_ad_type (ad_type),
  KEY idx_youtube_ai_offering_type (offering_type),
  KEY idx_youtube_ai_category (category),
  CONSTRAINT fk_youtube_ad_ai_meta FOREIGN KEY (youtube_ad_id) REFERENCES youtube_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- google  (DB: pasdev_gtext) — ad table is google_text_ad
CREATE TABLE IF NOT EXISTS google_text_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_text_ad_id   INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_google_text_ad_ai_meta (google_text_ad_id),
  KEY idx_google_ai_ad_type (ad_type),
  KEY idx_google_ai_offering_type (offering_type),
  KEY idx_google_ai_category (category),
  CONSTRAINT fk_google_text_ad_ai_meta FOREIGN KEY (google_text_ad_id) REFERENCES google_text_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- native  (DB: pasdev_native)
CREATE TABLE IF NOT EXISTS native_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  native_ad_id        INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_native_ad_ai_meta (native_ad_id),
  KEY idx_native_ai_ad_type (ad_type),
  KEY idx_native_ai_offering_type (offering_type),
  KEY idx_native_ai_category (category),
  CONSTRAINT fk_native_ad_ai_meta FOREIGN KEY (native_ad_id) REFERENCES native_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- linkedin  (DB: pasdev_linkedin)
CREATE TABLE IF NOT EXISTS linkedin_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  linkedin_ad_id      INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_linkedin_ad_ai_meta (linkedin_ad_id),
  KEY idx_linkedin_ai_ad_type (ad_type),
  KEY idx_linkedin_ai_offering_type (offering_type),
  KEY idx_linkedin_ai_category (category),
  CONSTRAINT fk_linkedin_ad_ai_meta FOREIGN KEY (linkedin_ad_id) REFERENCES linkedin_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- reddit  (DB: pasdev_reddit)
CREATE TABLE IF NOT EXISTS reddit_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reddit_ad_id        INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reddit_ad_ai_meta (reddit_ad_id),
  KEY idx_reddit_ai_ad_type (ad_type),
  KEY idx_reddit_ai_offering_type (offering_type),
  KEY idx_reddit_ai_category (category),
  CONSTRAINT fk_reddit_ad_ai_meta FOREIGN KEY (reddit_ad_id) REFERENCES reddit_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- quora  (DB: pasdev_quora)
CREATE TABLE IF NOT EXISTS quora_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quora_ad_id         INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quora_ad_ai_meta (quora_ad_id),
  KEY idx_quora_ai_ad_type (ad_type),
  KEY idx_quora_ai_offering_type (offering_type),
  KEY idx_quora_ai_category (category),
  CONSTRAINT fk_quora_ad_ai_meta FOREIGN KEY (quora_ad_id) REFERENCES quora_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- pinterest  (DB: pasdev_pinterest)
CREATE TABLE IF NOT EXISTS pinterest_ad_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pinterest_ad_id     INT UNSIGNED NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pinterest_ad_ai_meta (pinterest_ad_id),
  KEY idx_pinterest_ai_ad_type (ad_type),
  KEY idx_pinterest_ai_offering_type (offering_type),
  KEY idx_pinterest_ai_category (category),
  CONSTRAINT fk_pinterest_ad_ai_meta FOREIGN KEY (pinterest_ad_id) REFERENCES pinterest_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- tiktok  (DB: tiktok_database_development) — FK col is ad_id, signed INT
CREATE TABLE IF NOT EXISTS tiktok_ads_ai_meta (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ad_id               INT NOT NULL,
  ad_type       VARCHAR(32)  NULL,
  offering_type VARCHAR(16)  NULL,
  offering      VARCHAR(255) NULL,
  caption       TEXT         NULL,
  category      VARCHAR(255) NULL,
  category_id   VARCHAR(4)   NULL,
  sub_category  VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)  NULL,
  intent        JSON NULL,
  hook          JSON NULL,
  colors        JSON NULL,
  offers        JSON NULL,
  roa           JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tiktok_ads_ai_meta (ad_id),
  KEY idx_tiktok_ai_ad_type (ad_type),
  KEY idx_tiktok_ai_offering_type (offering_type),
  KEY idx_tiktok_ai_category (category),
  CONSTRAINT fk_tiktok_ads_ai_meta FOREIGN KEY (ad_id) REFERENCES tiktok_ads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 4. How the API connects to it (write flow)

**Implemented** in `src/services/common/helpers/aiMetaSqlWriter.js` (`persistAiMeta`), invoked alongside
the ES `writeAiMeta` from **both** write paths in `addCategoryController.js`: `newCatInsertion` (Option A,
when an `ai_meta` object is present) and `POST /ai-meta` (Option B). The whole thing runs in **one
transaction** and is **non-fatal** — any failure (missing table, ad not in SQL, connection error) is caught
and returned as a status object, so an ES success is never lost. category/sub_category are sourced from the
**`ai_meta` object** (the top-level newCatInsertion category is being retired by the DS pipeline).

Per call, `persistAiMeta({ sql, network, adId, normalized, logger })`:

1. Resolve the network's SQL pool: `serviceRegistry.getService(network).db.sql` (chosen by
   `networks.<net>.sql.database`). Absent → `{ sql_status: 'skipped' }`.
2. Look the ad up by its **public** `ad_id` to get the numeric PK:
   `SELECT id FROM <net>_ad WHERE ad_id = ? LIMIT 1` → `adRowId`. No row → `{ sql_status: 'ad_not_found' }`
   (transaction rolled back).
3. **Upsert** the ai_meta row (replace-on-conflict, matching ES's whole-object replace):

```sql
INSERT INTO facebook_ad_ai_meta
  (facebook_ad_id, ad_type, offering_type, offering, caption, category, category_id, sub_category, subcategory_id,
   intent, hook, colors, offers, roa)
VALUES (?,?,?,?,?,?,?,?,?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  ad_type=VALUES(ad_type), offering_type=VALUES(offering_type), offering=VALUES(offering),
  caption=VALUES(caption), category=VALUES(category), category_id=VALUES(category_id),
  sub_category=VALUES(sub_category), subcategory_id=VALUES(subcategory_id),
  intent=VALUES(intent), hook=VALUES(hook), colors=VALUES(colors),
  offers=VALUES(offers), roa=VALUES(roa);
```

The JSON columns are bound with `JSON.stringify(value)` and assigned straight into the `JSON` column (MySQL
parses the string; no `CAST` needed — verified with mysql2 `execute` prepared statements, incl. float
values like `12.5`). Fields absent from the payload bind as SQL `NULL` (not the string `"null"`), clearing
any field the new payload omits — whole-object replace, matching ES. `ON DUPLICATE KEY` on the unique FK
gives the idempotent overwrite.

4. **Dual-write `category` to the existing category store (same transaction).** Only when a SQL category
   store exists **and** the payload carries a `category`: resolve the category **name → id** in
   `<net>_category` (SELECT-then-INSERT — `category_name` is not consistently UNIQUE across networks, so
   `ON DUPLICATE KEY` can't be relied on; timestamp columns default to `CURRENT_TIMESTAMP`), then
   `UPDATE <net>_ad SET category_id = ? WHERE id = ?`. The controller also mirrors the category to ES
   `${platform}.category` (via `mirrorCategoryToEs`) so the feed reads it. `sub_category` has no SQL
   category-table home, so it lives **only** in `<net>_ad_ai_meta.sub_category` (+ ES `${platform}.subCategory`).

   ⚠️ **Only 7 networks have a SQL category store** (facebook, instagram, youtube, native, linkedin, reddit,
   quora). **gdn, google, pinterest, tiktok have no `<net>_category` table and no `<net>_ad.category_id`
   column** (verified live) — for those, `categoryTable` is `null` in `aiMetaSqlWriter`, the category-table
   write is skipped (`category_synced: false`), and category stays ES-only as before.

**Return / status surfacing:** `persistAiMeta` returns
`{ sql_status: 'stored'|'skipped'|'ad_not_found'|'error', sql_ad_row_id?, category_synced?, sql_error? }`.
Option A attaches it to the response as `ai_meta_sql`; Option B as `sql`.

> **Prerequisite:** the DDL in §3 must be applied to each network DB before writes land — until the table
> exists, `persistAiMeta` returns `{ sql_status: 'error' }` (non-fatal; ES still succeeds).

---

## 5. Optional — querying the JSON arrays in SQL

ES is the intended query store, but if a SQL consumer needs to filter on an array field, MySQL 8 supports
**multi-valued indexes** (8.0.17+) without unpacking to child tables:

```sql
ALTER TABLE facebook_ad_ai_meta
  ADD INDEX mv_intent ( (CAST(intent AS CHAR(32) ARRAY)) );

-- then:
SELECT facebook_ad_id FROM facebook_ad_ai_meta
WHERE JSON_CONTAINS(intent, '"conversion"');
```

Scalar columns (`ad_type`, `offering_type`, `category`) are already indexed and filter directly.

---

## 6. Idempotency & safety

- **Create:** `CREATE TABLE IF NOT EXISTS` reuses an existing table — safe to re-run.
- **Later column additions:** MySQL (unlike MariaDB) has **no** `ADD COLUMN IF NOT EXISTS`, so guard
  future additions to avoid errors on re-run:
  ```sql
  SET @ddl := IF(
    (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'facebook_ad_ai_meta' AND column_name = 'new_col') = 0,
    'ALTER TABLE facebook_ad_ai_meta ADD COLUMN new_col VARCHAR(64) NULL',
    'SELECT 1');
  PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
  ```
- **FK cascade:** `ON DELETE CASCADE` means deleting an ad removes its AI-Meta row automatically — no
  orphans.
- **Rollback:** `DROP TABLE IF EXISTS <net>_ad_ai_meta;` (nothing else references it).
- **Charset:** `utf8mb4` on the new table regardless of the parent DB's default (some legacy tables are
  latin1) — captions/offerings can be multilingual. The FK is integer, so parent charset is irrelevant to it.
