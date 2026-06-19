'use strict';

/**
 * YouTube Elasticsearch column template — the FLAT key list the insert path uses.
 *
 * Like gtext/LinkedIn (and unlike GDN/Facebook's prefixed search_mix), the YouTube path
 * (YoutubeAdController::setInsertParamsForES, api_youtube ~2356-2399) builds the doc
 * IN-MEMORY with FLAT keys and indexes into `youtube_ads_data`, using the INTERNAL
 * youtube_ad.id as the ES _id (and as the `ad_id` body field).
 *
 * Date fields (first_seen/last_seen/post_date/domain_registration_date) are stored as UNIX
 * EPOCH INTEGERS (PHP strtotime). The ONLY dotted keys are the VIDEO/DISCOVERY budget fields
 * (youtube.lowerBudget / upperBudget / averageBudget) — added separately in esDocBuilder.
 */

const ES_INDEX = 'youtube_ads_data';

// Flat keys, in PHP $ESPayloadData order. esDocBuilder maps each from the data object.
const META_INSERT_COLUMNS = [
  'ad_id',                    // = internal youtube_ad.id (also the ES _id)
  'post_owner', 'post_owner_id', 'post_owner_image',
  'ad_title', 'ad_text', 'newsfeed_description', 'call_to_action',
  'ad_url', 'ad_image_or_video', 'verified',
  'first_seen', 'last_seen', 'hastags',
  'reactions', 'comments', 'views', 'impression', 'popularity',
  'destination_url', 'redirect_urls', 'html_text',
  'image_ocr', 'image_object', 'image_brand', 'image_celebrity',
  'post_date', 'countries', 'states', 'city',
  'ad_type', 'ad_position', 'ad_language',
  'affiliate_networks', 'ecommerce_platform', 'funnel',
  'source', 'comment_data', 'domain_registration_date',
  'text_image_title', 'image_url_original', 'thumbnail_url', 'platform',
];

module.exports = { META_INSERT_COLUMNS, ES_INDEX };
