'use strict';

/**
 * Elasticsearch `gdn_search_mix` column template (PHP $currentTableColumns in
 * GdnAdController::insertAdToElasticSearch). Entries with `|langs` fan out into
 * per-language sub-fields in esDocBuilder. `height`/`width` are synthetic (derived
 * from gdn_ad_variants.ad_image_size = "width*height"). Keep in sync with the PHP array.
 */

// GdnAdController.php insertAdToElasticSearch — currentTableColumns
const META_INSERT_COLUMNS = [
  'gdn_ad.id', 'gdn_ad.source', 'gdn_ad.post_date', 'gdn_ad.last_seen', 'gdn_ad.days_running',
  'gdn_ad.ad_position', 'gdn_ad.ad_sub_position', 'gdn_ad.type', 'gdn_country_only.country',
  'gdn_ad_variants.title|ru,fr,sp,ge,exactly', 'gdn_ad_variants.text|ru,fr,sp,ge,exactly', 'gdn_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly', 'gdn_ad_variants.ad_image_size',
  'gdn_ad_variants.image_object|ru,fr,sp,exactly', 'gdn_ad_variants.image_celebrity|ru,fr,sp,exactly', 'gdn_ad_variants.image_brand_logo|ru,fr,sp,exactly', 'gdn_ad_variants.image_ocr|ru,fr,sp,exactly',
  'gdn_ad_url.url', 'gdn_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly', 'gdn_ad_post_owners.post_owner_lower', 'gdn_ad_meta_data.affiliate_data',
  'gdn_ad_meta_data.destination_url', 'gdn_ad_meta_data.redirect_url', 'gdn_ad_meta_data.firstSeenOnDesktop', 'gdn_ad_meta_data.built_with', 'target_site.target_site',
  'gdn_ad_meta_data.built_with_analytics_tracking', 'gdn_placement_url.placement_url', 'height', 'width', 'gdn_ad_domains.domain_registered_date',
  'gdn_ad_translation.ad_text', 'gdn_ad_translation.news_feed_description', 'gdn_ad_translation.ad_title',
];

module.exports = { META_INSERT_COLUMNS };
