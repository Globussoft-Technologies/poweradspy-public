'use strict';

// PHP $this->currentTableColumns from adsController::insertAdToElasticSearch()
const PINTEREST_INSERT_COLUMNS = [
  'pinterest_ad.id',
  'pinterest_ad.post_date',
  'pinterest_ad.last_seen',
  'pinterest_ad.first_seen',
  'pinterest_ad.days_running',
  'pinterest_ad.ad_position',
  'pinterest_ad.ad_sub_position',
  'pinterest_ad.type',
  'pinterest_country_only.country',
  'pinterest_ad_variants.title|ru,fr,sp,ge,exactly',
  'pinterest_ad_variants.text|ru,fr,sp,ge,exactly',
  'pinterest_ad_variants.newsfeed_description|ru,fr,sp,ge,exactly',
  'pinterest_ad_variants.target_keyword',
  'pinterest_ad_variants.image_object|ru,fr,sp,exactly',
  'pinterest_ad_variants.image_celebrity|ru,fr,sp,exactly',
  'pinterest_ad_variants.image_brand_logo|ru,fr,sp,exactly',
  'pinterest_ad_variants.image_ocr|ru,fr,sp,exactly',
  'pinterest_ad_url.url',
  'pinterest_ad_post_owners.post_owner_name|ru,fr,sp,ge,exactly',
  'pinterest_ad_post_owners.post_owner_lower',
  'pinterest_ad_meta_data.destination_url',
  'pinterest_ad_meta_data.firstSeenOnDesktop',
  'pinterest_ad_meta_data.built_with',
  'pinterest_ad_meta_data.affiliate_data',
  'pinterest_ad_meta_data.built_with_analytics_tracking',
  'pinterest_ad_domains.domain_registered_date',
  'pinterest_ad_domains.domain',
];

module.exports = { PINTEREST_INSERT_COLUMNS };
