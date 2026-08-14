-- The database is provisioned by the DBA; this migration only creates AdMob tables.
USE `pasdev_admob`;

CREATE TABLE IF NOT EXISTS `mob_post_owners` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `name_key` VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(`name`))) STORED,
  `image_url` VARCHAR(2048) NULL,
  `ads_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_post_owners_name_key` (`name_key`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ad_id` VARCHAR(191) NOT NULL,
  `post_owner_id` BIGINT UNSIGNED NULL,
  `type` VARCHAR(40) NOT NULL,
  `platform` SMALLINT UNSIGNED NOT NULL DEFAULT 19,
  `network` VARCHAR(80) NOT NULL DEFAULT 'mob-network',
  `source` VARCHAR(30) NOT NULL,
  `ad_title` TEXT NULL,
  `ad_text` MEDIUMTEXT NULL,
  `newsfeed_description` TEXT NULL,
  `ad_image_size` VARCHAR(40) NULL,
  `ad_number_position` SMALLINT UNSIGNED NULL,
  `ad_position` VARCHAR(80) NULL,
  `ad_sub_position` VARCHAR(80) NULL,
  `city` VARCHAR(160) NULL,
  `ip_address` VARCHAR(45) NULL,
  `first_seen` DATETIME(3) NULL,
  `last_seen` DATETIME(3) NOT NULL,
  `post_date` DATETIME(3) NULL,
  `system_id` VARCHAR(191) NOT NULL,
  `version` VARCHAR(40) NULL,
  `status` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_ads_ad_id` (`ad_id`),
  KEY `idx_mob_ads_type_last_seen` (`type`, `last_seen`, `id`),
  KEY `idx_mob_ads_last_seen` (`last_seen`, `id`),
  KEY `idx_mob_ads_owner` (`post_owner_id`, `last_seen`),
  CONSTRAINT `fk_mob_ads_owner` FOREIGN KEY (`post_owner_id`) REFERENCES `mob_post_owners` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_urls` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `ad_url` TEXT NULL,
  `destination_url` TEXT NULL,
  `redirect_url` MEDIUMTEXT NULL,
  `placement_url` TEXT NULL,
  `target_site` TEXT NULL,
  `destination_host` VARCHAR(255) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ad_id`),
  KEY `idx_mob_ad_urls_destination_host` (`destination_host`),
  CONSTRAINT `fk_mob_ad_urls_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_media` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `media_kind` ENUM('IMAGE', 'VIDEO', 'THUMBNAIL') NOT NULL,
  `ordinal` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `original_url` TEXT NULL,
  `nas_path` VARCHAR(2048) NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_ad_media_slot` (`ad_id`, `media_kind`, `ordinal`),
  CONSTRAINT `fk_mob_ad_media_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_countries` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `country` VARCHAR(120) NOT NULL,
  `country_key` VARCHAR(120) GENERATED ALWAYS AS (LOWER(TRIM(`country`))) STORED,
  `appearance_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen` DATETIME(3) NOT NULL,
  `last_seen` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ad_id`, `country_key`),
  KEY `idx_mob_country_lookup` (`country_key`, `last_seen`, `ad_id`),
  CONSTRAINT `fk_mob_ad_countries_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_states` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `state` VARCHAR(160) NOT NULL,
  `state_key` VARCHAR(160) GENERATED ALWAYS AS (LOWER(TRIM(`state`))) STORED,
  `appearance_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen` DATETIME(3) NOT NULL,
  `last_seen` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ad_id`, `state_key`),
  KEY `idx_mob_state_lookup` (`state_key`, `last_seen`, `ad_id`),
  CONSTRAINT `fk_mob_ad_states_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_sub_networks` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `sub_network` VARCHAR(160) NOT NULL,
  `sub_network_key` VARCHAR(160) GENERATED ALWAYS AS (LOWER(TRIM(`sub_network`))) STORED,
  `appearance_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen` DATETIME(3) NOT NULL,
  `last_seen` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ad_id`, `sub_network_key`),
  KEY `idx_mob_sub_network_lookup` (`sub_network_key`, `last_seen`, `ad_id`),
  CONSTRAINT `fk_mob_ad_sub_networks_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_source_apps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_app` VARCHAR(255) NOT NULL,
  `source_app_key` VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(`source_app`))) STORED,
  `source_app_pkg` VARCHAR(255) NOT NULL DEFAULT '',
  `appearance_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen` DATETIME(3) NOT NULL,
  `last_seen` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_source_apps_identity` (`source_app_key`, `source_app_pkg`),
  KEY `idx_mob_source_apps_last_seen` (`last_seen`, `id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_source_apps` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `source_app_id` BIGINT UNSIGNED NOT NULL,
  `appearance_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen` DATETIME(3) NOT NULL,
  `last_seen` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ad_id`, `source_app_id`),
  KEY `idx_mob_ad_source_apps_app` (`source_app_id`, `last_seen`, `ad_id`),
  CONSTRAINT `fk_mob_ad_source_apps_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mob_ad_source_apps_app` FOREIGN KEY (`source_app_id`) REFERENCES `mob_source_apps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_hidden_ads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `post_owner_id` BIGINT UNSIGNED NULL,
  `ad_id` VARCHAR(191) NULL,
  `ad_id_key` VARCHAR(191) GENERATED ALWAYS AS (
    CASE
      WHEN `ad_id` IS NULL OR TRIM(`ad_id`) = '' THEN NULL
      ELSE LOWER(TRIM(`ad_id`))
    END
  ) STORED,
  `type` TINYINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_hidden_ads_user_ad_type` (`user_id`, `ad_id_key`, `type`),
  UNIQUE KEY `uq_mob_hidden_ads_user_owner_type` (`user_id`, `post_owner_id`, `type`),
  KEY `idx_mob_hidden_ads_user_type` (`user_id`, `type`, `id`),
  KEY `idx_mob_hidden_ads_owner` (`post_owner_id`, `type`, `id`),
  KEY `idx_mob_hidden_ads_ad` (`ad_id_key`, `type`, `id`),
  CONSTRAINT `fk_mob_hidden_ads_owner` FOREIGN KEY (`post_owner_id`) REFERENCES `mob_post_owners` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mob_hidden_ads_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`ad_id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_ad_observations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `system_id` VARCHAR(191) NOT NULL,
  `payload_hash` BINARY(32) NOT NULL,
  `observed_at` DATETIME(3) NOT NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mob_observation_session` (`ad_id`, `session_id`),
  KEY `idx_mob_observations_session` (`session_id`, `observed_at`, `ad_id`),
  KEY `idx_mob_observations_observed` (`observed_at`, `ad_id`),
  CONSTRAINT `fk_mob_observations_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `mob_es_outbox` (
  `ad_id` BIGINT UNSIGNED NOT NULL,
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `last_error` TEXT NULL,
  `next_retry_at` DATETIME(3) NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`ad_id`),
  KEY `idx_mob_es_outbox_retry` (`next_retry_at`, `attempts`),
  CONSTRAINT `fk_mob_es_outbox_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
