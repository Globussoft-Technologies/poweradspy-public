'use strict';

/**
 * Elasticsearch `search_mix` column templates (PHP $currentTableColumns).
 * Entries with `|langs` fan out into per-language sub-fields in esDocBuilder.
 * Keep these in sync with the PHP arrays referenced in the specs.
 */

// adsdata() INSERT/UPDATE — PHP adsDataController.php:1263-1272
const META_INSERT_COLUMNS = [
  'facebook_ad.id', 'facebook_ad.discoverer_user_id', 'facebook_ad.platform', 'facebook_ad.status', 'facebook_ad.hits', 'facebook_ad.post_date', 'facebook_ad.last_seen', 'facebook_ad.lower_age_seen',
  'facebook_ad.days_running', 'facebook_ad.likes', 'facebook_ad.comments', 'facebook_ad.shares', 'facebook_ad.created_date',
  'facebook_ad.ad_position', 'facebook_ad.type', 'facebook_users.Gender', 'country_only.country', 'facebook_call_to_actions.action',
  'facebook_ad_variants.title|ru,fr,sp,ge,exactly', 'facebook_ad_variants.text|ru,fr,sp,ge,exactly', 'facebook_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly', 'facebook_ad_url.url',
  'facebook_ad_variants.image_object|ru,fr,sp,exactly', 'facebook_ad_variants.image_celebrity|ru,fr,sp,exactly', 'facebook_ad_variants.image_brand_logo|ru,fr,sp,exactly', 'facebook_ad_variants.image_ocr|ru,fr,sp,exactly',
  'facebook_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly', 'facebook_ad_post_owners.post_owner_lower', 'facebook_ad_post_owners.verified', 'facebook_ad_post_owners.page_created_date', 'facebook_ad_meta_data.destination_url',
  'facebook_ad_meta_data.firstSeenOnDesktop', 'facebook_ad_meta_data.built_with', 'facebook_ad_meta_data.built_with_analytics_tracking', 'facebook_ad_meta_data.affiliate_data', 'facebook_ad_variants.image_url_original',
  'facebook_ad_meta_data.firstSeenOnAndroid', 'facebook_ad_meta_data.firstSeenOnIos', 'facebook_comments.comment_data', 'html', 'mixdata', 'facebook_user_countries', 'facebook_ad_domains.domain_registered_date',
  'facebook_translation.ad_text', 'facebook_translation.news_feed_description', 'facebook_translation.ad_title',
];

// adsLibraryInsert() INSERT — PHP adsDataController.php:5835-5844
const LIBRARY_INSERT_COLUMNS = [
  'facebook_ad.id', 'facebook_ad.platform', 'facebook_ad.collation_id', 'facebook_ad.hits', 'facebook_ad.post_date', 'facebook_ad.last_seen', 'facebook_ad.lower_age_seen',
  'facebook_ad.days_running', 'facebook_ad.created_date',
  'facebook_ad.ad_position', 'facebook_ad.type', 'country_only.country', 'facebook_call_to_actions.action', 'facebook_ad.first_seen',
  'facebook_ad_variants.title|ru,fr,sp,ge,exactly', 'facebook_ad_variants.text|ru,fr,sp,ge,exactly', 'facebook_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly', 'facebook_ad_url.url', 'facebook_ad_meta_data.est_audience_size_low',
  'facebook_ad_variants.image_object|ru,fr,sp,exactly', 'facebook_ad_variants.image_celebrity|ru,fr,sp,exactly', 'facebook_ad_variants.image_brand_logo|ru,fr,sp,exactly', 'facebook_ad_variants.image_ocr|ru,fr,sp,exactly',
  'facebook_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly', 'facebook_ad_post_owners.post_owner_lower', 'facebook_ad_post_owners.verified', 'facebook_ad_post_owners.page_created_date', 'facebook_ad_meta_data.destination_url', 'facebook_ad_meta_data.EUT', 'facebook_ad_meta_data.meta_ad_url',
  'facebook_ad_meta_data.firstSeenOnDesktop', 'facebook_ad_meta_data.built_with', 'facebook_ad_meta_data.built_with_analytics_tracking', 'facebook_ad_meta_data.affiliate_data', 'facebook_ad_meta_data.est_audience_size_high', 'facebook_ad_meta_data.ad_run_platforms', 'facebook_ad_variants.image_url_original',
  'facebook_ad_meta_data.firstSeenOnAndroid', 'facebook_ad_meta_data.firstSeenOnIos', 'facebook_comments.comment_data', 'html', 'mixdata', 'facebook_user_countries', 'facebook_ad_domains.domain_registered_date',
  'facebook_translation.ad_text', 'facebook_translation.news_feed_description', 'facebook_translation.ad_title',
];

module.exports = { META_INSERT_COLUMNS, LIBRARY_INSERT_COLUMNS };
