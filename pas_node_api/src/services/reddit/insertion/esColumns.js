'use strict';

/**
 * Reddit insertion — Elasticsearch column mapping.
 * Defines which DB columns to include in the search_mix index.
 */

const REDDIT_INSERT_COLUMNS = [
  // Main ad fields
  'reddit_ad.id', 'reddit_ad.ad_id', 'reddit_ad.platform', 'reddit_ad.type',
  'reddit_ad.post_date', 'reddit_ad.first_seen', 'reddit_ad.last_seen',
  'reddit_ad.created_date', 'reddit_ad.discoverer_user_id', 'reddit_ad.ad_position',
  'reddit_ad.source', 'reddit_ad.language_id', 'reddit_ad.country_id',
  'reddit_ad.domain_id', 'reddit_ad.post_owner_id', 'reddit_ad.default_variant_id',
  'reddit_ad.default_analytics_id', 'reddit_ad.call_to_action_id', 'reddit_ad.category_id',

  // Post owner fields
  'reddit_ad_post_owners.post_owner_name', 'reddit_ad_post_owners.post_owner_lower',
  'reddit_ad_post_owners.post_owner_image',

  // Variant fields
  'reddit_ad_variants.title', 'reddit_ad_variants.text', 'reddit_ad_variants.newsfeed_description',
  'reddit_ad_variants.image_url', 'reddit_ad_variants.image_url_original',
  'reddit_ad_variants.image_object',

  // Domain fields
  'reddit_ad_domain.domain', 'reddit_ad_domain.domain_registered_date',

  // CTA field
  'reddit_call_to_action.call_to_action',

  // Country fields
  'reddit_country.country', 'reddit_country.city', 'reddit_country.state',

  // User fields
  'reddit_user.Gender',

  // Meta data fields
  'reddit_ad_meta_data.destination_url', 'reddit_ad_meta_data.built_with',
  'reddit_ad_meta_data.built_with_analytics_tracking',

  // Carousel
  'reddit_ad_image_video.ad_image_video',

  // Analytics (denormalized from default)
  'reddit_ad.default_analytics_id',

  // Language
  'languages.iso',
];

const REDDIT_LIBRARY_INSERT_COLUMNS = [
  'reddit_ad.id', 'reddit_ad.ad_id', 'reddit_ad.type', 'reddit_ad.platform',
  'reddit_ad_variants.image_url', 'reddit_ad_variants.image_url_original',
  'reddit_ad_variants.title', 'reddit_ad_variants.text',
];

module.exports = { REDDIT_INSERT_COLUMNS, REDDIT_LIBRARY_INSERT_COLUMNS };
