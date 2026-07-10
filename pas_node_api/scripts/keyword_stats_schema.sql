-- Data layer for the Keywords Explorer (Ahrefs/SEMrush-style browsable
-- keyword database, built on the crawled google_ads_data corpus — no
-- third-party keyword-data provider). Run manually against the `google`
-- network's MySQL DB (same DB that already holds keyword_advertiser /
-- keyword_domain / keyword_forecast / google_text_keywords).
--
-- `keyword_stats` is a per-keyword rollup populated by the Node job
-- src/services/google/jobs/refreshKeywordStats.js (mirrors how
-- keyword_advertiser/keyword_domain are populated by backfillKeywordAggregates.js).
--
-- `keyword_lists` / `keyword_list_items` are user-curated named lists of
-- keywords (the "Keyword lists" tab), independent of that rollup.

CREATE TABLE IF NOT EXISTS keyword_stats (
  keyword_id         INT UNSIGNED NOT NULL PRIMARY KEY,
  ads_total          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  advertisers_total  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  domains_total      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ads_30d            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ads_prior_30d      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  growth_pct         DECIMAL(10,2) NULL,
  competition_score  TINYINT UNSIGNED NULL,
  category           VARCHAR(191) NULL,
  sub_category       VARCHAR(191) NULL,
  top_country        VARCHAR(8) NULL,
  type_mix           JSON NULL,
  position_top_pct   DECIMAL(5,2) NULL,
  first_seen         DATE NULL,
  last_seen          DATE NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_keyword_stats_keyword FOREIGN KEY (keyword_id) REFERENCES google_text_keywords (id),
  INDEX idx_keyword_stats_ads_total (ads_total),
  INDEX idx_keyword_stats_competition_score (competition_score),
  INDEX idx_keyword_stats_growth_pct (growth_pct),
  INDEX idx_keyword_stats_category (category),
  INDEX idx_keyword_stats_last_seen (last_seen)
);

CREATE TABLE IF NOT EXISTS keyword_lists (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  country     VARCHAR(8) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_keyword_lists_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS keyword_list_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  list_id     INT UNSIGNED NOT NULL,
  keyword_id  INT UNSIGNED NOT NULL,
  added_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_keyword_list_items_list FOREIGN KEY (list_id) REFERENCES keyword_lists (id) ON DELETE CASCADE,
  CONSTRAINT fk_keyword_list_items_keyword FOREIGN KEY (keyword_id) REFERENCES google_text_keywords (id),
  UNIQUE KEY uniq_list_keyword (list_id, keyword_id)
);
