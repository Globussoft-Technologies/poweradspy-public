'use strict';

function buildTransparencyDoc(data, internalId, nasImageUrl) {
  const impression = data.impressions || {};
  const primaryNasUrl = data.type === 'VIDEO'
    ? data.nasVideoUrl || null
    : nasImageUrl || null;
  const countryDetails = (data.countryDetailsSql || []).map((detail) => ({
    country: detail.country,
    country_code: detail.country_code,
    first_seen: detail.first_seen,
    last_seen: detail.last_seen,
    times_shown: detail.times_shown,
  }));
  return {
    id: internalId,
    ad_id: data.ad_id,
    advertiser_id: data.advertiser_id,
    ad_url: data.ad_url,
    post_owner_name: data.post_owner,
    post_owner_lower: data.post_owner ? data.post_owner.toLowerCase() : null,
    post_owner_image: data.post_owner_image,
    title: data.ad_title,
    text: data.ad_text,
    ad_title: data.translation?.title ?? null,
    ad_text: data.translation?.text ?? null,
    news_feed_description: data.translation?.newsfeed_description ?? null,
    image_url_original: data.image_url_original,
    video_url_original: data.video_url_original,
    image_url: data.type === 'VIDEO' ? null : nasImageUrl,
    image_video_url: primaryNasUrl,
    new_nas_image_url: data.type === 'VIDEO' ? null : nasImageUrl,
    // SQL keeps the scraper/source URLs. Search consumers receive only the
    // successfully stored NAS paths under the contract field name.
    othermultimedia: data.othermultimediaNasPaths || [],
    destination_url: data.destination_url,
    url: data.destination_url,
    redirect_url: data.redirect_url,
    domain: data.domain,
    country: data.country,
    country_details: countryDetails,
    region_code: data.region_code,
    language_id: data.languageId || 0,
    lang_detect: data.detectedLanguage || null,
    type: data.type,
    subnetwork: data.subnetwork,
    first_seen: data.firstSeenForSearch ?? null,
    // SQL still receives the operational `now` fallback, but search/UI must
    // not present that generated timestamp as crawler-provided ad metadata.
    last_seen: data.lastSeenForSearch ?? null,
    post_date: data.postDateEs ?? null,
    days_running: data.daysRunning,
    impressions_min: impression.min ?? null,
    impressions_max: impression.max ?? null,
    impressions_operator: impression.operator ?? null,
    source: data.source,
    platform: data.platform,
    version: data.version,
    status: 1,
    ad_position: data.adPosition || 'FEED',
    firstSeenOnDesktop: data.firstSeenSql,
    lastSeenOnDesktop: data.lastSeenSql,
  };
}

module.exports = { buildTransparencyDoc };
