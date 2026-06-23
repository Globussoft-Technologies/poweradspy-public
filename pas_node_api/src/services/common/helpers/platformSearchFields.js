'use strict';

/**
 * Per-network Elasticsearch field map for keyword / advertiser / domain searches.
 *
 * Owned by the keyword-ad-notification feature so the scan has a self-contained
 * source of truth and does not depend on the admin search-intelligence controller.
 * `keyword`/`advertiser` are field lists for a `multi_match` phrase query; `domain`
 * is the single field used for a `wildcard` domain match.
 */
const PLATFORM_FIELD_MAPPINGS = {
  facebook: {
    keyword: [
      'facebook_ad_variants.title',
      'facebook_ad_variants.text',
      'facebook_ad_variants.newsfeed_description',
      'facebook_ad_variants.title_exactly',
      'facebook_ad_variants.text_exactly',
      'facebook_ad_variants.newsfeed_description_exactly',
      'facebook_translation.ad_text',
      'facebook_translation.news_feed_description',
      'facebook_translation.ad_title',
      'facebook_translations.ar.title',
      'facebook_translations.ar.text',
      'facebook_translations.ar.newsfeed_description',
    ],
    advertiser: [
      'facebook_ad_post_owners.post_owner_name',
      'facebook_ad_post_owners.post_owner_name_ru',
      'facebook_ad_post_owners.post_owner_name_fr',
      'facebook_ad_post_owners.post_owner_name_sp',
      'facebook_ad_post_owners.post_owner_name_ge',
      'facebook_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'facebook_ad_meta_data.destination_url',
  },
  instagram: {
    keyword: [
      'instagram_ad_variants.title',
      'instagram_ad_variants.text',
      'instagram_ad_variants.newsfeed_description',
      'instagram_ad_variants.title_exactly',
      'instagram_ad_variants.text_exactly',
      'instagram_ad_variants.newsfeed_description_exactly',
      'instagram_translation.ad_text',
      'instagram_translation.news_feed_description',
      'instagram_translation.ad_title',
      'instagram_translations.ar.title',
      'instagram_translations.ar.text',
      'instagram_translations.ar.newsfeed_description',
    ],
    advertiser: [
      'instagram_ad_post_owners.post_owner_name',
      'instagram_ad_post_owners.post_owner_name_ru',
      'instagram_ad_post_owners.post_owner_name_fr',
      'instagram_ad_post_owners.post_owner_name_sp',
      'instagram_ad_post_owners.post_owner_name_ge',
      'instagram_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'instagram_ad_meta_data.destination_url',
  },
  google: {
    keyword: [
      'google_ad_variants.title',
      'google_ad_variants.text',
      'google_ad_variants.newsfeed_description',
      'google_ad_variants.title_exactly',
      'google_ad_variants.text_exactly',
      'google_ad_variants.newsfeed_description_exactly',
    ],
    advertiser: [
      'google_ad_post_owners.post_owner_name',
      'google_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'google_ad_meta_data.destination_url',
  },
  gdn: {
    keyword: [
      'gdn_ad_variants.title',
      'gdn_ad_variants.text',
      'gdn_ad_variants.newsfeed_description',
      'gdn_ad_variants.title_exactly',
      'gdn_ad_variants.text_exactly',
      'gdn_ad_variants.newsfeed_description_exactly',
    ],
    advertiser: [
      'gdn_ad_post_owners.post_owner_name',
      'gdn_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'gdn_ad_meta_data.destination_url',
  },
  youtube: {
    keyword: [
      'youtube_ad_variants.title',
      'youtube_ad_variants.text',
      'youtube_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'youtube_ad_post_owners.post_owner_name',
    ],
    domain: 'youtube_ad_meta_data.destination_url',
  },
  linkedin: {
    keyword: [
      'ad_title',
      'ad_text',
      'newsfeed_description',
    ],
    advertiser: [
      'linkedin_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'destination_url',
  },
  reddit: {
    keyword: [
      'reddit_ad_variants.title',
      'reddit_ad_variants.text',
      'reddit_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'reddit_ad_post_owners.post_owner_name',
      'reddit_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'reddit_ad_meta_data.destination_url',
  },
  pinterest: {
    keyword: [
      'pinterest_ad_variants.title',
      'pinterest_ad_variants.text',
      'pinterest_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'pinterest_ad_post_owners.post_owner_name',
      'pinterest_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'pinterest_ad_meta_data.destination_url',
  },
  quora: {
    keyword: [
      'quora_ad_variants.title',
      'quora_ad_variants.text',
      'quora_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'quora_ad_post_owners.post_owner_name',
      'quora_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'quora_ad_meta_data.destination_url',
  },
  native: {
    keyword: [
      'native_ad_variants.title',
      'native_ad_variants.text',
      'native_ad_variants.newsfeed_description',
    ],
    advertiser: [
      'native_ad_post_owners.post_owner_name',
      'native_ad_post_owners.post_owner_name_exactly',
    ],
    domain: 'native_ad_meta_data.destination_url',
  },
  tiktok: {
    keyword: [
      'ad_title',
      'industry',
      'post_owner',
      'target_keywords',
    ],
    advertiser: [
      'post_owner',
    ],
    domain: 'destination_url',
  },
};

module.exports = { PLATFORM_FIELD_MAPPINGS };
