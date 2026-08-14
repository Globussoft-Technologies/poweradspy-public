-- Deduplicated rollup for the Keywords Explorer browse/count/stats path ONLY.
--
-- Why this exists (2026-08-13 incident): `keyword_stats` has one row per
-- google_text_keywords.id — a keyword TEXT tracked in N countries gets N
-- identical rows. keywordsExplorerController.js has to GROUP BY gtk.keyword
-- on every request to dedupe them, which forces MySQL to materialize +
-- filesort the whole joined table (measured: 1,066,833 rows scanned per
-- query, ~20-38s EACH, "Using temporary; Using filesort" even with an index
-- on the ORDER BY column — confirmed via scripts/diagnose-keywords-explorer.js).
--
-- This is now the ONLY google keyword-stats table — keywordImportController.js,
-- keywordListsController.js, keywordIdeasController.js and
-- keywordsExplorerController.js all read from here (joined by keyword TEXT, not
-- keyword_id). The old per-keyword_id `keyword_stats` table is retired; once this
-- table is confirmed populated and correct, `keyword_stats` can be dropped.
--
-- One row per keyword TEXT (deduplicated), so the Explorer's count/stats/sort/
-- filter queries are plain indexed reads with no GROUP BY at all — MySQL can walk
-- an index in ORDER BY order and stop after `page_size` rows instead of scanning
-- + sorting the entire table.
--
-- Populated by src/services/google/jobs/refreshKeywordStats.js and
-- scripts/refresh-keyword-stats-safe.js (the live production job).

CREATE TABLE IF NOT EXISTS keyword_stats_unique (
  keyword             VARCHAR(500) NOT NULL PRIMARY KEY,
  sample_keyword_id   INT UNSIGNED NOT NULL,
  -- Countries this keyword is tracked in (was previously expressed by having
  -- one keyword_stats row per country-variant keyword_id). JSON array of ISO
  -- country codes, e.g. ["US","IN","GB"]. Not indexed — the country filter on
  -- Explorer is a narrow, infrequently-used param; JSON_CONTAINS over an
  -- already-filtered/sorted small page is cheap enough without one.
  countries           JSON NULL,
  ads_total           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  advertisers_total   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  domains_total       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ads_30d             BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ads_prior_30d       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  growth_pct          DECIMAL(10,2) NULL,
  competition_score   TINYINT UNSIGNED NULL,
  category            VARCHAR(191) NULL,
  sub_category        VARCHAR(191) NULL,
  top_country         VARCHAR(8) NULL,
  type_mix            JSON NULL,
  position_top_pct    DECIMAL(5,2) NULL,
  first_seen          DATE NULL,
  last_seen           DATE NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_keyword_stats_unique_sample FOREIGN KEY (sample_keyword_id) REFERENCES google_text_keywords (id),
  INDEX idx_ksu_ads_total (ads_total),
  INDEX idx_ksu_advertisers_total (advertisers_total),
  INDEX idx_ksu_competition_score (competition_score),
  INDEX idx_ksu_growth_pct (growth_pct),
  INDEX idx_ksu_category (category),
  INDEX idx_ksu_last_seen (last_seen),
  INDEX idx_ksu_first_seen (first_seen),
  -- Lets the competition_score percentile pass (refreshKeywordStats.js) use a
  -- single index-ordered window-function UPDATE instead of chunked JS batches.
  INDEX idx_ksu_competition_order (advertisers_total, keyword)
);
