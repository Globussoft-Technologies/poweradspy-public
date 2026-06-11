'use strict';

/**
 * LinkedIn Elasticsearch column template — the FLAT key list the insert path uses.
 *
 * Unlike GDN/Facebook (joined query with `<net>_ad.*` prefixed keys), the LinkedIn
 * path (adsDataController::setInsertParamsForES, api_linkedin lines 2809-2911) builds
 * the doc IN-MEMORY with FLAT keys and indexes into `linkedin_ads_data`, using the
 * INTERNAL linkedin_ad.id as the ES _id (and as the `ad_id` body field).
 *
 * Date fields (first_seen/last_seen/post_date/domain_registration_date) are stored as
 * UNIX EPOCH INTEGERS (PHP strtotime) — NOT 'YYYY-MM-DD HH:MM:SS'. See esDocBuilder.
 */

const ES_INDEX = 'linkedin_ads_data';

// Flat keys, in PHP getInsertDataForES order. esDocBuilder maps each from the data object.
const META_INSERT_COLUMNS = [
  'ad_id',                    // = internal linkedin_ad.id (also the ES _id)
  'post_owner', 'post_owner_id', 'post_owner_image', 'verified',
  'ad_title', 'ad_text', 'newsfeed_description', 'call_to_action',
  'ad_url', 'ad_video', 'image_url_original', 'ad_image',
  'first_seen', 'last_seen', 'post_date',
  'reactions', 'comments', 'impression', 'popularity',
  'destination_url', 'platform',
  'redirect_urls', 'html_text',
  'image_ocr', 'image_object', 'image_brand', 'image_celebrity',
  'countries', 'ad_type', 'ad_position', 'ad_language',
  'affiliate_networks', 'ecommerce_platform', 'funnel',
  'source', 'domain_registration_date',
];

module.exports = { META_INSERT_COLUMNS, ES_INDEX };
