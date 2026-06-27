'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    google_text_ad.id,
    google_text_ad.source,
    google_text_ad.type,
    google_text_ad.ad_sub_position,
    google_text_ad.ad_id,
    google_text_ad.post_date,
    google_text_ad.first_seen,
    google_text_country.city,
    google_text_country.state,
    google_text_country.country,
    google_text_ad_domains.domain,
    google_text_ad_meta_data.built_with,
    google_text_ad_meta_data.built_with_analytics_tracking,
    google_text_ad_meta_data.affiliate_data,
    google_text_ad_meta_data.platform,
    google_text_ad_meta_data.destination_url,
    google_text_ad_meta_data.g_temp_url,
    google_text_ad_meta_data.screenshot_url,
    google_text_ad_meta_data.redirect_destination_url_source,
    google_text_ad_meta_data.version,
    google_text_ad_meta_data.destination_scraper_status,
    google_text_ad_meta_data.lastSeenOnDesktop,
    google_text_ad_meta_data.png_file,
    google_text_ad_meta_data.white_ad_screenshot,
    google_text_ad_meta_data.blackhat_path,
    google_text_ad_meta_data.white_ad_lander,
    google_text_ad_variants.title AS ad_title,
    google_text_ad_variants.text AS ad_text,
    google_text_ad_variants.newsfeed_description AS news_feed_description,
    google_text_ad_variants.target_keyword,
    google_text_ad_variants.target_page,
    google_text_ad_variants.image_url,
    google_text_ad_post_owners.post_owner_name AS post_owner,
    google_text_ad_post_owners.post_owner_image,
    google_ad_url.url AS url,
    languages.name AS language
  FROM google_text_ad
  LEFT JOIN google_text_ad_domains ON google_text_ad.domain_id = google_text_ad_domains.id
  LEFT JOIN google_text_country ON google_text_country.id = google_text_ad.country_id
  LEFT JOIN google_text_ad_meta_data ON google_text_ad.id = google_text_ad_meta_data.google_text_ad_id
  LEFT JOIN google_text_ad_post_owners ON google_text_ad.post_owner_id = google_text_ad_post_owners.id
  LEFT JOIN google_text_ad_variants ON google_text_ad.id = google_text_ad_variants.google_text_ad_id
  LEFT JOIN google_ad_url ON google_text_ad.id = google_ad_url.google_text_ad_id AND google_ad_url.url_type = 'R'
  LEFT JOIN languages ON google_text_ad.language_id = languages.id
  WHERE google_text_ad.id = ?
  LIMIT 1
`;

function computeAdStatus(lastSeen) {
  if (!lastSeen) return 'Inactive';
  const diffDays = Math.floor((new Date() - new Date(lastSeen)) / (1000 * 60 * 60 * 24));
  return diffDays > 15 ? 'Inactive' : 'Active';
}

async function getAdDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) return { code: 401, message: 'Missing parameters: ad_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL database connection not available' };

  try {
    const rows = await db.sql.query(AD_DETAIL_SQL, [p.ad_id]);
    if (!rows || rows.length === 0) return { code: 404, message: 'Ad not found', data: null };

    const adData = { ...rows[0] };

    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data',
          body: { query: { bool: { filter: { terms: { id: [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`google_translation.${lang}`]) {
            adData[`google_translation.${lang}`] = src[`google_translation.${lang}`];
          }
          if (src.image_brand) adData.imageBrand = src.image_brand;
          if (src.image_object) adData.imageObject = src.image_object;
          if (src.image_celebrity) adData.imageCeleb = src.image_celebrity;
          if (src.image_ocr) adData.imageOcr = src.image_ocr;
          if (src.source) adData.source = src.source;
          if (src.new_nas_image_url) adData.image_url = src.new_nas_image_url;
          if (src.category !== undefined) adData.category = src.category;
          if (src.subCategory !== undefined) adData.subCategory = src.subCategory;
          if (src.ad_position !== undefined) adData.ad_position = src.ad_position;
          if (src['days_running'] !== undefined) adData.days_running = src['days_running'];
          adData.last_seen = new Date(src.last_seen).toISOString().split('T')[0];
          adData.days_running = src.days_running;
          adData.domain_registered_date = src.domain_registered_date;

          // Language from ES lang_detect ISO
          if (src['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['lang_detect']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['url_destination'] || null,
            source_url:      src['source_url']      || null,
            redirect_url:    src['redirect_url']    || null,
            final_url:       src['final_url']       || null,
            url_redirects:   src['url_redirects']   || null,
            destination_url: src['destination_url'] || null,
          };
        }
      } catch (esErr) {
        logger.warn('ES overlay failed', { error: esErr.message });
      }
    }

    adData.ad_status = computeAdStatus(adData.lastSeenOnDesktop);

    return { code: 200, data: cleanAdsData([adData]), message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (google)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
