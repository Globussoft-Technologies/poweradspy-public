'use strict';

/**
 * Quora — Elasticsearch `quora_search_mix` column templates.
 * Similar to Facebook/Instagram structure with quora_* prefixes.
 */

const QUORA_INSERT_COLUMNS = [
  'quora_ad.id',
  'quora_ad.discoverer_user_id',
  'quora_ad.platform',
  'quora_ad.status',
  'quora_ad.hits',
  'quora_ad.post_date',
  'quora_ad.last_seen',
  'quora_ad.lower_age',
  'quora_ad.days_running',
  'quora_ad.likes',
  'quora_ad.comments',
  'quora_ad.shares',
  'quora_ad.created_date',
  'quora_ad.ad_position',
  'quora_ad.type',
  'quora_user.Gender',
  'quora_country.country',
  'quora_call_to_action.call_to_action',
  'quora_ad_variants.title',
  'quora_ad_variants.text',
  'quora_ad_variants.newsfeed_description',
  'quora_ad_variants.image_url',
  'quora_ad_variants.image_object',
  'quora_ad_variants.image_celebrity',
  'quora_ad_variants.image_brand_logo',
  'quora_ad_variants.image_ocr',
  'quora_ad_variants.image_url_original',
  'quora_ad_image_video.ad_image_video',
  'quora_ad_post_owners.post_owner_name',
  'quora_ad_post_owners.post_owner_lower',
  'quora_ad_post_owners.post_owner_image',
  'quora_ad_meta_data.destination_url',
  'quora_ad_meta_data.built_with',
  'quora_ad_meta_data.built_with_analytics_tracking',
  'quora_ad_meta_data.affiliate_data',
  'quora_ad_domains.domain_registered_date',
  'quora_ad_translation.ad_text',
  'quora_ad_translation.news_feed_description',
  'quora_ad_translation.ad_title',
  'html',
  'mixdata',
  'quora_user_countries',
];

module.exports = { QUORA_INSERT_COLUMNS };
