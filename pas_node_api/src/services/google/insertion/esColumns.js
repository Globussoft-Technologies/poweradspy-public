'use strict';

/**
 * GTEXT (Google Text) Elasticsearch column template — the FLAT key list the
 * "O" path uses (GoogleTextAdController::insertAdToMySqlDatabaseO, lines 1384-1438).
 *
 * Unlike GDN/Facebook (joined query with `<net>_ad.*` prefixed keys), the gtext "O" path
 * builds the doc IN-MEMORY with FLAT keys and indexes into `google_ads_data`.
 * `target_keyword` is fanned into an array (split on `|`) by esDocBuilder.
 */

const ES_INDEX = 'google_ads_data';

// Flat keys, in PHP order. esDocBuilder maps each from the in-memory data object.
const META_INSERT_COLUMNS = [
  'id', 'ad_id', 'post_date', 'first_seen', 'last_seen', 'source', 'status', 'days_running',
  'ad_ranking', 'ad_position', 'ad_sub_position', 'type', 'domain_registered_date', 'domain',
  'title', 'text', 'newsfeed_description', 'target_keyword', 'target_page', 'image_url', 'url',
  'post_owner_name', 'post_owner_image', 'post_owner_lower', 'destination_url',
  'firstSeenOnDesktop', 'built_with', 'built_with_analytics_tracking', 'firstSeenOnAndroid',
  'firstSeenOnIos', 'affiliate_data', 'g_temp_url', 'blackhat_path', 'destination_scraper_status',
  'platform', 'version', 'png_file', 'redirect_destination_url_source', 'screenshot_url',
  'clickbank_processed_date', 'ad_text', 'news_feed_description', 'ad_title', 'redirect_url',
  'source_url', 'country', 'state', 'city',
  'html_whitehat_lander_text', 'html_res_blackhat_lander_text', 'html_dc_blackhat_lander_text',
];

module.exports = { META_INSERT_COLUMNS, ES_INDEX };
