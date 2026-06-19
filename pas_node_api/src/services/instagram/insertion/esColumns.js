'use strict';

/**
 * ES `instagram_search_mix` column templates — VERBATIM from PHP InstagramUserController:
 *   INSTA_INSERT_COLUMNS  = instaAdsData lines 1342-1352
 *   LIBRARY_INSERT_COLUMNS = adsLibraryInsert lines 7591-7601
 * `|langs` fans out into per-language sub-fields in esDocBuilder. The leaf field name
 * (after the last `.`) is what the join row must expose.
 */

const ES_INDEX = 'instagram_search_mix';

// instaAdsData (POST gramAdsData)
const INSTA_INSERT_COLUMNS = [
  'instagram_ad.id', 'instagram_ad.status', 'instagram_ad.post_date', 'instagram_ad.last_seen', 'instagram_ad.lower_age_seen',
  'instagram_ad.days_running', 'instagram_ad.likes', 'instagram_ad.comments', 'instagram_ad.shares', 'instagram_ad.created_date',
  'instagram_ad.ad_position', 'instagram_ad.type', 'instagram_user.gender', 'instagram_country_only.country', 'instagram_call_to_action.call_to_action',
  'instagram_ad_variants.title|ru,fr,sp,ge,exactly', 'instagram_ad_variants.text|ru,fr,sp,ge,exactly', 'instagram_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly', 'instagram_ad_url.url',
  'instagram_ad_variants.image_object|ru,fr,sp,exactly', 'instagram_ad_variants.image_celebrity|ru,fr,sp,exactly', 'instagram_ad_variants.image_brand_logo|ru,fr,sp,exactly', 'instagram_ad_variants.image_ocr|ru,fr,sp,exactly',
  'instagram_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly', 'instagram_ad_post_owners.post_owner_lower', 'instagram_ad_meta_data.destination_url', 'instagram_ad_meta_data.initial_url',
  'instagram_ad_meta_data.firstSeenOnDesktop', 'instagram_ad_meta_data.built_with', 'instagram_ad_meta_data.built_with_analytics_tracking', 'instagram_ad_meta_data.affiliate_data',
  'instagram_ad_meta_data.firstSeenOnAndroid', 'instagram_ad_meta_data.firstSeenOnIos', 'instagram_ad_domain.domain_registered_date',
  'instagram_ad_translation.ad_text', 'instagram_ad_translation.news_feed_description', 'instagram_ad_translation.ad_title', 'instagram_ad_meta_data.platform',
];

// adsLibraryInsert
const LIBRARY_INSERT_COLUMNS = [
  'instagram_ad.id', 'instagram_ad_meta_data.platform', 'instagram_ad.collation_id', 'instagram_ad.hits', 'instagram_ad.post_date', 'instagram_ad.last_seen', 'instagram_ad.lower_age_seen',
  'instagram_ad.days_running', 'instagram_ad.created_date',
  'instagram_ad.ad_position', 'instagram_ad.type', 'instagram_country_only.country', 'instagram_call_to_action.call_to_action', 'instagram_ad.first_seen',
  'instagram_ad_variants.title|ru,fr,sp,ge,exactly', 'instagram_ad_variants.text|ru,fr,sp,ge,exactly', 'instagram_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly', 'instagram_ad_url.url', 'instagram_ad_cost_usage_benefit_analysis.est_audience_size_low',
  'instagram_ad_variants.image_object|ru,fr,sp,exactly', 'instagram_ad_variants.image_celebrity|ru,fr,sp,exactly', 'instagram_ad_variants.image_brand_logo|ru,fr,sp,exactly', 'instagram_ad_variants.image_ocr|ru,fr,sp,exactly',
  'instagram_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly', 'instagram_ad_post_owners.post_owner_lower', 'instagram_ad_post_owners.verified', 'instagram_ad_post_owners.page_created_date', 'instagram_ad_meta_data.destination_url', 'instagram_ad_meta_data.initial_url', 'instagram_ad_cost_usage_benefit_analysis.EUT', 'instagram_ad_cost_usage_benefit_analysis.meta_ad_url',
  'instagram_ad_meta_data.firstSeenOnDesktop', 'instagram_ad_meta_data.built_with', 'instagram_ad_meta_data.built_with_analytics_tracking', 'instagram_ad_meta_data.affiliate_data', 'instagram_ad_cost_usage_benefit_analysis.est_audience_size_high', 'instagram_ad_cost_usage_benefit_analysis.ad_run_platforms',
  'instagram_ad_meta_data.firstSeenOnAndroid', 'instagram_ad_meta_data.firstSeenOnIos', 'instagram_comments.comment_data', 'html', 'mixdata', 'instagram_user_countries', 'instagram_ad_html_lander_content.html_whitehat_lander_text', 'instagram_ad_html_lander_content.html_res_blackhat_lander_text', 'instagram_ad_html_lander_content.html_dc_blackhat_lander_text', 'instagram_ad_domain.domain_registered_date',
  'instagram_ad_translation.ad_text', 'instagram_ad_translation.news_feed_description', 'instagram_ad_translation.ad_title', 'instagram_ad_meta_data.platform',
];

module.exports = { ES_INDEX, INSTA_INSERT_COLUMNS, LIBRARY_INSERT_COLUMNS };
