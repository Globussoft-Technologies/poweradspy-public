-- ChatGPT Ads (platform 21) — brand-new, self-contained network schema.
-- Run against the `pasdev_chat_ads` database (config.json: networks.chatgptads.sql.database).
--
-- Design notes (why this is NOT a copy-paste of facebook_*):
--   - This network has no legacy PHP system, so there is nothing to stay byte-compatible
--     with. The TABLE SPLIT (main ad / variants / post_owners / countries / translation /
--     carousel) mirrors facebook's/instagram's proven relational shape (see
--     docs/insertion/KT-INSERTION-PROCESS.md), because that split itself is sound — but every
--     column here uses MODERN types, matching scripts/google_transparency_schema.sql (the
--     most recent network built fresh in this codebase), not facebook's legacy ones:
--       * utf8mb4 / utf8mb4_unicode_ci everywhere (NOT latin1 / 3-byte utf8) — a 4-byte
--         charset is required for emoji and many non-Latin scripts in ad copy; this is the
--         "latin conversion" class of bug the legacy tables are known to have.
--       * TEXT (not VARCHAR(255)) for anything that can be long free text or a long signed
--         CDN URL — `image_url_original` in particular is routinely 300-800+ characters on
--         facebook/instagram's own data (signed CDN query strings) and a VARCHAR(255) there
--         would silently truncate it.
--       * INT/BIGINT UNSIGNED for all ids and counts (no negative ids/counts are possible).
--       * JSON (not a string-serialized array) for the carousel path list.
--       * Explicit FOREIGN KEY ... ON DELETE actions (facebook/instagram's FK behavior had to
--         be reverse-engineered from information_schema per-network; this schema states it
--         up front instead).
--   - Tables NOT created, because the real payload has no data for them (see the sample
--     payload in docs/insertion/chatgptads/MANIFEST.md): no call-to-action table (no `call_to_action`
--     field), no category table (no `page_category`/category field), no per-day
--     likes/comments/shares analytics columns (ChatGPT's conversational ad surface has no
--     like/comment/share concept at all — there is nothing to store). `chatgptads_ad_analytics`
--     is kept deliberately thin (impression + hits only) for the same reason: don't build
--     columns for data that can't exist, matching the user's explicit "optimized, not bloated"
--     instruction.
--   - `destination_url` lives directly on `chatgptads_ad` rather than in its own `_meta_data`
--     table (facebook/instagram's `_meta_data` table holds half a dozen fields; here it would
--     hold exactly one column, which is a needless extra JOIN for no benefit on a schema with
--     no legacy-compatibility constraint).
--   - `platform` is fixed at 21 per product confirmation — kept as a real column (not
--     hardcoded only in application code) for consistency with every other network's schema
--     and in case a sub-variant is ever introduced.
--
-- Apply manually:  mysql -u <user> -p pasdev_chat_ads < chatgptads_schema.sql
-- (Written to run once, with IF NOT EXISTS everywhere — safe to re-run.)

-- ───────────────────────── Dimension tables ─────────────────────────

CREATE TABLE IF NOT EXISTS chatgptads_ad_post_owners (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_owner_name    VARCHAR(255) NOT NULL,
  -- Case-insensitive dedup key, same pattern as facebook_ad_post_owners.post_owner_lower —
  -- a GENERATED column so callers never insert it directly (matches MANIFEST §9.3's gotcha).
  post_owner_lower   VARCHAR(255) GENERATED ALWAYS AS (LOWER(post_owner_name)) STORED,
  post_owner_image   VARCHAR(512) NULL COMMENT 'NAS path, e.g. /pas-prod/stream/chatgpt/postowner/202610/<id>.jpg',
  ads_count          INT UNSIGNED NOT NULL DEFAULT 0,
  verified           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_owner_lower (post_owner_lower)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatgptads_ad_domains (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  domain                 VARCHAR(255) NOT NULL,
  -- Filled by the lander worker (insertHtmlRedirectCountry payload domain_registered_date).
  -- NULL until a crawl resolves it; a blank value never overwrites a known date.
  domain_registered_date DATE NULL DEFAULT NULL COMMENT 'domain registration date, from the lander scraper',
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatgptads_country_only (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- The payload sends a resolved country NAME (geolocation lookup), not an ISO code — no
  -- ISO-to-name translation step is needed here, unlike facebook/instagram's adsLibrary.
  country    VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_country (country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Main ad table ─────────────────────────

CREATE TABLE IF NOT EXISTS chatgptads_ad (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ad_id                VARCHAR(32) NOT NULL COMMENT 'the generated 12-digit id from the payload; VARCHAR (not INT) in case the format ever grows a non-numeric char',
  -- "extension record ID" from the crawler — kept for traceability/debugging only; the
  -- insert/update branch decision is still made on ad_id, matching every other network.
  uid                  VARCHAR(128) NULL,
  type                 VARCHAR(16) NOT NULL COMMENT 'IMAGE | VIDEO (carousel is a modifier via chatgptads_ad_image_video, same as facebook/instagram — not a distinct type value)',
  platform             SMALLINT UNSIGNED NOT NULL DEFAULT 21,
  network              VARCHAR(32) NOT NULL DEFAULT 'chatgpt',
  post_owner_id        INT UNSIGNED NOT NULL DEFAULT 0,
  -- NULLable (not NOT NULL DEFAULT 0 like post_owner_id) — unlike post_owner, both
  -- destination_url and country are legitimately optional in validate.js
  -- ('nullable'/'present|nullable'), so there is no always-valid non-zero id to fall back
  -- to. A literal 0 here would violate the FK below (no row with id=0 exists in either
  -- referenced table) the moment an ad arrives without a destination_url/country — found by
  -- testing an assumed VIDEO/carousel payload that omitted destination_url (2026-10-01).
  domain_id            INT UNSIGNED NULL DEFAULT NULL,
  country_only_id      INT UNSIGNED NULL DEFAULT NULL,
  default_variant_id   INT UNSIGNED NOT NULL DEFAULT 0,
  default_analytics_id INT UNSIGNED NOT NULL DEFAULT 0,
  destination_url      TEXT NULL,
  -- ChatGPT-native placement taxonomy (e.g. "conversational_bottom") — VARCHAR, not ENUM,
  -- because this is a new and still-evolving set of values, unlike facebook's fixed
  -- ad_position list.
  ad_position          VARCHAR(64) NULL,
  version              VARCHAR(16) NULL COMMENT 'crawler/extension version that sent this payload, e.g. "1.0.0"',
  post_date            DATETIME NULL,
  first_seen           DATETIME NOT NULL,
  last_seen            DATETIME NOT NULL,
  days_running         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  hits                 INT UNSIGNED NOT NULL DEFAULT 1,
  status               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  built_with_status    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'built-with scrape status: 0 = pending, 1 = done, 2 = processing, 3 = failed or no data found',
  lander_status        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'lander scrape status: 0 = pending, 2 = processing, 4 = success, 5 = failed or no data found',
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad_id (ad_id),
  KEY idx_post_owner (post_owner_id),
  KEY idx_domain (domain_id),
  KEY idx_country_only (country_only_id),
  KEY idx_last_seen (last_seen),
  KEY idx_uid (uid),
  CONSTRAINT fk_chatgptads_ad_post_owner FOREIGN KEY (post_owner_id)
    REFERENCES chatgptads_ad_post_owners(id) ON DELETE RESTRICT,
  CONSTRAINT fk_chatgptads_ad_domain FOREIGN KEY (domain_id)
    REFERENCES chatgptads_ad_domains(id) ON DELETE RESTRICT,
  CONSTRAINT fk_chatgptads_ad_country FOREIGN KEY (country_only_id)
    REFERENCES chatgptads_country_only(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Child tables (1:1 / 1:N on chatgptads_ad) ─────────────────────────

CREATE TABLE IF NOT EXISTS chatgptads_ad_variants (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id     BIGINT UNSIGNED NOT NULL,
  title                TEXT NULL,
  text                 TEXT NULL COMMENT 'ad_text',
  newsfeed_description TEXT NULL COMMENT 'canonical value — normalize.js collapses the payload''s news_feed_description/newsfeed_description alias pair into this one column',
  image_url            VARCHAR(512) NULL COMMENT 'NAS path (image, or video thumbnail) — same dual use as facebook_ad_variants.image_url',
  image_url_original   TEXT NULL COMMENT 'original source URL from the payload (image_url_original / image_video_url, whichever was present)',
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_ad (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_variants_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deliberately thin: no likes/comments/shares/popularity/engagement_rate columns — the
-- ChatGPT conversational ad surface has no such engagement data to store. impression is kept
-- for when/if the crawler starts sending it; hits mirrors chatgptads_ad.hits as a same-day
-- bucket, identical in spirit to facebook_ad_analytics' daily row.
CREATE TABLE IF NOT EXISTS chatgptads_ad_analytics (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  impression       INT UNSIGNED NOT NULL DEFAULT 0,
  hits             INT UNSIGNED NOT NULL DEFAULT 1,
  date             DATE NOT NULL,
  PRIMARY KEY (id),
  KEY idx_chatgptads_ad_date (chatgptads_ad_id, date),
  CONSTRAINT fk_chatgptads_analytics_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatgptads_ad_countries (
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  country_only_id  INT UNSIGNED NOT NULL,
  count            INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (chatgptads_ad_id, country_only_id),
  KEY idx_country_only (country_only_id),
  CONSTRAINT fk_chatgptads_countries_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE,
  CONSTRAINT fk_chatgptads_countries_country FOREIGN KEY (country_only_id)
    REFERENCES chatgptads_country_only(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Carousel / other_multimedia — same shape as facebook_ad_image_video, JSON (not a
-- string-serialized array) for the NAS path list. One row per ad (upserted), matching
-- the shared mediaUpload.uploadMultimedia() return shape.
CREATE TABLE IF NOT EXISTS chatgptads_ad_image_video (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  ad_type          ENUM('IMAGE','VIDEO') NOT NULL,
  ad_image_video   JSON NOT NULL COMMENT 'JSON array of NAS paths, one per carousel item, in payload order',
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_ad (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_imagevideo_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatgptads_translation (
  chatgptads_ad_id   BIGINT UNSIGNED NOT NULL,
  ad_title           TEXT NULL,
  ad_text            TEXT NULL,
  newsfeed_description TEXT NULL,
  -- Plain ISO code string, not a shared language_id FK — there is no evidence a
  -- cross-network `language` dimension table exists that this self-contained network
  -- could safely depend on; a shared table is exactly the kind of cross-network coupling
  -- the architecture rule in MANIFEST.md §7 forbids ("do NOT try to parameterize one
  -- network from another").
  detected_language  VARCHAR(8) NULL,
  -- Full English language name (e.g. 'English'), not just the ISO code — ES's lang_detect
  -- field stores ONLY this (the code is not useful for display/filtering there), while SQL
  -- keeps both (code for programmatic matching, name for anything that reads this table
  -- directly). Added 2026-10-01 per explicit instruction — the translation API already
  -- returns language_name, it just wasn't being captured before this.
  language_name      VARCHAR(64) NULL,
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_translation_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── chatgptads_hidden_ads (per-user save / hide — added 2026-10-05) ──
-- Same contract as facebook's hidden_ads, which the dashboard's
-- /ads/hide_ads, /ads/un-hide and /ads/getHiddenPostOwners endpoints read and write:
--   type 1 = hidden advertiser (post_owner_id), 2 = hidden ad (ad_id), 3 = saved ad (ad_id).
-- `ad_id` is the EXTERNAL ad id (chatgptads_ad.ad_id — what the dashboard card carries), not
-- the internal numeric id. `target_key` ('owner:<id>' for type 1, 'ad:<ad_id>' otherwise) makes
-- the UNIQUE key dedupe double-clicks even though one of post_owner_id / ad_id is NULL per row.
-- FKs cascade, so deleting an ad (or advertiser) also removes it from everyone's Saved/Hidden.
CREATE TABLE IF NOT EXISTS chatgptads_hidden_ads (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        VARCHAR(64) NOT NULL,
  type           TINYINT UNSIGNED NOT NULL COMMENT '1 = hidden advertiser, 2 = hidden ad, 3 = saved ad',
  post_owner_id  INT UNSIGNED NULL,
  ad_id          VARCHAR(32) NULL,
  target_key     VARCHAR(48) NOT NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_hidden_user_type_target (user_id, type, target_key),
  KEY idx_chatgptads_hidden_user (user_id),
  CONSTRAINT fk_chatgptads_hidden_ad FOREIGN KEY (ad_id)
    REFERENCES chatgptads_ad(ad_id) ON DELETE CASCADE,
  CONSTRAINT fk_chatgptads_hidden_post_owner FOREIGN KEY (post_owner_id)
    REFERENCES chatgptads_ad_post_owners(id) ON DELETE CASCADE
-- ── Lander + built-with enrichment (added 2026-10-05) ──
-- Filled by the lander / built-with workers, not by the insertion pipeline. Progress for each
-- ad is tracked on chatgptads_ad.lander_status / chatgptads_ad.built_with_status. Both tables
-- hold ONE row per ad (UNIQUE chatgptads_ad_id) — a re-crawl upserts the row, so storage does
-- not grow with every crawl. `chatgptads_ad_id` is the INTERNAL chatgptads_ad.id — the `ad_id`
-- / `id` the workers receive in their payloads — not the extension's 12-digit ad_id string.

-- Lander page captured from the ad's destination_url. Payload keys → columns:
--   html_path → html_path, html_content → html_content, screen_shot → screenshot_url,
--   outgoing_url → out_going_url, redirects → redirect_url, crawled_by → scrapper_name.
CREATE TABLE IF NOT EXISTS chatgptads_ad_landers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  html_path        VARCHAR(512) NULL COMMENT 'NAS path of the zipped lander HTML, e.g. /pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138_zip.zip',
  -- html_content (the page text) lives in chatgptads_ad_html_lander_content, not here.
  screenshot_url   VARCHAR(512) NULL COMMENT 'NAS path of the lander screenshot',
  out_going_url    JSON NULL COMMENT 'outgoing links on the lander: [{start_url, destination_url, redirect_urls[]}]',
  redirect_url     JSON NULL COMMENT 'redirect hops from the ad click to the lander: [url, ...]',
  scrapper_name    VARCHAR(64) NULL COMMENT 'crawler that captured the lander (payload crawled_by), e.g. python, .net',
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_ad (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_landers_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Visible text of the lander page — kept in its own table (like facebook_ad_html_lander_content)
-- so the large text stays out of chatgptads_ad_landers. ONE row per ad, upserted on re-crawl.
-- Payload key: html_content.
CREATE TABLE IF NOT EXISTS chatgptads_ad_html_lander_content (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  -- MEDIUMTEXT (up to 16 MB), not TEXT: TEXT caps at 64 KB and full lander page text can exceed it.
  html_content     MEDIUMTEXT NULL COMMENT 'visible text of the lander page',
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_ad (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_html_lander_content_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technologies detected on the lander. Same columns and status codes as the other networks'
-- built-with data (e.g. reddit_ad_meta_data, see reddit/controllers/built-withController.js),
-- in its own table here because this network has no _meta_data table.
-- Example payload: {"id":"43434","built_with":"","built_with_cms":"",
--                   "built_with_analytics_tracking":"Webflow","affiliate_data":"","status":"1"}
CREATE TABLE IF NOT EXISTS chatgptads_ad_built_with (
  id                            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id              BIGINT UNSIGNED NOT NULL,
  built_with                    TEXT NULL COMMENT 'detected technologies, "|"-separated',
  built_with_analytics_tracking TEXT NULL COMMENT 'detected analytics / tracking tools, "|"-separated, e.g. Webflow',
  built_with_cms                TEXT NULL COMMENT 'detected CMS, "|"-separated',
  affiliate_data                TEXT NULL COMMENT 'detected affiliate network(s); NULL when none',
  affiliate_status              TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'affiliate detection status: 0 = pending, 1 = found, 2 = processing, 3 = none found',
  created_at                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_ad (chatgptads_ad_id),
  CONSTRAINT fk_chatgptads_built_with_ad FOREIGN KEY (chatgptads_ad_id)
    REFERENCES chatgptads_ad(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── chatgptads_es_outbox (ES-write durability — added 2026-10-01 after live testing) ──
-- Every other network (and admob's own mob_es_outbox) only retries the INSERT/UPDATE
-- index-failure case, and even admob's outbox FK-cascades away silently on ad delete — so
-- an ES doc orphaned by a failed delete is never cleaned up anywhere in this codebase.
-- This table deliberately covers BOTH directions via `action`:
--   'index'  — chatgptads_ad row was written but the ES index/reindex call failed.
--   'delete' — the SQL row was removed but the ES delete call failed, leaving an orphan doc.
-- No FK on chatgptads_ad_id: a 'delete' action's ad row is GONE by design (that's the
-- point), so a FOREIGN KEY ... ON DELETE CASCADE would silently destroy the very row this
-- table exists to act on. The cron (chatgptadsEsOutboxJob.js) re-fetches from chatgptads_ad
-- for 'index' actions and simply searches+deletes by id for 'delete' actions.
CREATE TABLE IF NOT EXISTS chatgptads_es_outbox (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chatgptads_ad_id BIGINT UNSIGNED NOT NULL,
  action         ENUM('index','delete') NOT NULL,
  attempts       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error     TEXT NULL,
  next_retry_at  DATETIME(3) NOT NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chatgptads_es_outbox_ad_action (chatgptads_ad_id, action),
  KEY idx_chatgptads_es_outbox_retry (next_retry_at, attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── updated_at on every table, created_at on chatgptads_ad_variants, built_with_status +
--    lander_status on chatgptads_ad (added 2026-10-05) ──
-- built_with_status / lander_status default to 0 (pending), so every existing and new ad
-- starts as pending with no application-code change.
-- updated_at is set by MySQL itself (DEFAULT + ON UPDATE CURRENT_TIMESTAMP) — no application
-- code writes it, same as every other network's tables. It is in the CREATE TABLE statements
-- above for new databases. Tables created before 2026-10-05 only had it on
-- chatgptads_ad_post_owners, chatgptads_translation and chatgptads_es_outbox; because
-- CREATE TABLE IF NOT EXISTS does not alter an existing table, run the statements below ONCE
-- on such a database (they are commented out so this file stays safe to re-run — a second
-- ADD COLUMN would fail with "Duplicate column name"). Existing rows get the time the ALTER
-- runs, not their real last-update time.
--
-- ALTER TABLE chatgptads_ad             ADD COLUMN built_with_status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'built-with scrape status: 0 = pending, 1 = done, 2 = processing, 3 = failed or no data found' AFTER status,
--                                       ADD COLUMN lander_status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'lander scrape status: 0 = pending, 2 = processing, 4 = success, 5 = failed or no data found' AFTER built_with_status,
--                                       ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at;
-- ALTER TABLE chatgptads_ad_variants    ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER image_url_original,
--                                       ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at;

-- ── domain_registered_date on chatgptads_ad_domains (added 2026-10-05) ──
-- Same as above: the CREATE TABLE already has it for new databases; on a database where
-- chatgptads_ad_domains already exists, run this ONCE (commented out so the file stays re-runnable).
-- Existing rows get NULL until the lander worker resolves their date.
--
-- ALTER TABLE chatgptads_ad_domains     ADD COLUMN domain_registered_date DATE NULL DEFAULT NULL COMMENT 'domain registration date, from the lander scraper' AFTER domain;
