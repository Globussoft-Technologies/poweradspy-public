-- Google Ads Transparency (platform 18) additive storage.
-- Apply to the configured Google/GText schema. Existing google_text_* tables
-- remain canonical for shared ad, owner, country, creative, and metadata fields.

CREATE TABLE IF NOT EXISTS google_transparency_ad_payload (
  google_text_ad_id      INT UNSIGNED NOT NULL,
  advertiser_id          VARCHAR(64) NOT NULL,
  ad_url                 VARCHAR(2048) NOT NULL,
  subnetwork             VARCHAR(16) NULL,
  region_code            CHAR(2) NOT NULL,
  impressions_min        BIGINT UNSIGNED NULL,
  impressions_max        BIGINT UNSIGNED NULL,
  impressions_operator   ENUM('range','over','under') NULL,
  video_url_original     TEXT NULL,
  redirect_url           TEXT NULL,
  othermultimedia        JSON NOT NULL,
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  received_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                      ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (google_text_ad_id),
  KEY idx_gtp_advertiser (advertiser_id, google_text_ad_id),
  KEY idx_gtp_region_subnetwork (region_code, subnetwork),
  CONSTRAINT fk_gtp_ad FOREIGN KEY (google_text_ad_id)
    REFERENCES google_text_ad(id) ON DELETE CASCADE,
  CONSTRAINT chk_gtp_range CHECK (
    impressions_min IS NULL OR impressions_max IS NULL OR impressions_min <= impressions_max
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS google_transparency_country_delivery (
  google_text_ad_id      INT UNSIGNED NOT NULL,
  country_only_id       INT UNSIGNED NOT NULL,
  ordinal               SMALLINT UNSIGNED NOT NULL,
  country_code          CHAR(2) NULL,
  first_seen            DATETIME NULL,
  last_seen             DATETIME NULL,
  impressions_min       BIGINT UNSIGNED NULL,
  impressions_max       BIGINT UNSIGNED NULL,
  impressions_operator  ENUM('range','over','under') NULL,
  PRIMARY KEY (google_text_ad_id, country_only_id),
  KEY idx_gtcd_country_date (country_code, last_seen),
  KEY idx_gtcd_country_only (country_only_id, google_text_ad_id),
  CONSTRAINT fk_gtcd_ad FOREIGN KEY (google_text_ad_id)
    REFERENCES google_text_ad(id) ON DELETE CASCADE,
  CONSTRAINT fk_gtcd_country FOREIGN KEY (country_only_id)
    REFERENCES google_text_country_only(id) ON DELETE RESTRICT,
  CONSTRAINT chk_gtcd_range CHECK (
    impressions_min IS NULL OR impressions_max IS NULL OR impressions_min <= impressions_max
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
