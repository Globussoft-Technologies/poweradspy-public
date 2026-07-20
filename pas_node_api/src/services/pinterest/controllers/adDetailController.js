'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    pinterest_ad.id,
    pinterest_ad.source,
    pinterest_ad.type,
    pinterest_ad.ad_position,
    pinterest_ad.ad_sub_position,
    pinterest_ad.ad_id,
    DATE(pinterest_ad.post_date) AS post_date,
    pinterest_ad.first_seen,
    pinterest_ad.last_seen,
    pinterest_ad.days_running,
    pinterest_country.city,
    pinterest_country.state,
    pinterest_country.country,
    pinterest_ad_domains.domain,
    pinterest_ad_domains.domain_registered_date,
    pinterest_ad_meta_data.built_with,
    pinterest_ad_meta_data.built_with_analytics_tracking,
    pinterest_ad_meta_data.affiliate_data,
    pinterest_ad_meta_data.platform,
    pinterest_ad_meta_data.destination_url,
    pinterest_ad_meta_data.screenshot_url,
    pinterest_ad_meta_data.png_file,
    pinterest_ad_meta_data.white_ad_screenshot,
    pinterest_ad_variants.title AS ad_title,
    pinterest_ad_variants.text AS ad_text,
    pinterest_ad_variants.newsfeed_description AS news_feed_description,
    pinterest_ad_variants.image_url,
    pinterest_ad_variants.image_url_original,
    pinterest_ad_post_owners.post_owner_name AS post_owner,
    pinterest_ad_post_owners.post_owner_image,
    languages.name AS language,
    pinterest_ad_url.url AS url
  FROM pinterest_ad
  LEFT JOIN pinterest_ad_meta_data ON pinterest_ad.id = pinterest_ad_meta_data.pinterest_ad_id
  LEFT JOIN pinterest_country ON pinterest_country.id = pinterest_ad.country_id
  LEFT JOIN pinterest_ad_domains ON pinterest_ad.domain_id = pinterest_ad_domains.id
  LEFT JOIN pinterest_ad_variants ON pinterest_ad.id = pinterest_ad_variants.pinterest_ad_id
  LEFT JOIN pinterest_ad_post_owners ON pinterest_ad.post_owner_id = pinterest_ad_post_owners.id
  LEFT JOIN languages ON pinterest_ad.language_id = languages.id
  LEFT JOIN pinterest_ad_url ON pinterest_ad.id = pinterest_ad_url.pinterest_ad_id AND pinterest_ad_url.url_type = 'R'
  WHERE pinterest_ad.id = ?
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
    // Language is ES-only — must agree with the language FILTER, which only
    // ever matches `lang_detect`. Discard the stale SQL `languages` join value
    // seeded above by the spread; it's re-populated below only from ES.
    adData.language = null;

    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: 'pinterest_search_mix',
          body: { query: { bool: { filter: { terms: { 'pinterest_ad.id': [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`pinterest_translations.${lang}`]) {
            adData[`pinterest_translations.${lang}`] = src[`pinterest_translations.${lang}`];
          }
          if (src['pinterest_ad_variants.image_brand_logo_exactly']) adData.imageBrand = src['pinterest_ad_variants.image_brand_logo_exactly'];
          if (src['pinterest_ad_variants.image_object']) adData.imageObject = src['pinterest_ad_variants.image_object'];
          if (src['pinterest_ad_variants.image_celebrity_exactly']) adData.imageCeleb = src['pinterest_ad_variants.image_celebrity_exactly'];
          if (src['pinterest_ad_variants.image_ocr_exactly']) adData.imageOcr = src['pinterest_ad_variants.image_ocr_exactly'];
          if (src.new_nas_image_url) adData.image_url = src.new_nas_image_url;
          // Language: ES `lang_detect` (ISO) → display name — the same field the
          // language FILTER matches on. No SQL fallback: if ES has none, stays null.
          if (src.lang_detect) {
            adData.lang_detect = src.lang_detect;
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src.lang_detect);
          }
          if (src['pinterest_ad_domains.domain_registered_date'] !== undefined) adData.domain_registered_date = src['pinterest_ad_domains.domain_registered_date'];
          if (src['pinterest_ad.days_running'] !== undefined) adData.days_running = src['pinterest_ad.days_running'];
          if (src['pinterest.category'] !== undefined) adData.category = src['pinterest.category'];
          if (src['pinterest.subCategory'] !== undefined) adData.subCategory = src['pinterest.subCategory'];

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['pinterest_ad_url.url_destination']         || null,
            source_url:      src['pinterest_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['pinterest_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['pinterest_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['pinterest_ad_url.url_redirects']           || null,
            destination_url: src['pinterest_ad_meta_data.destination_url']   || null,
          };
        }
      } catch (esErr) {
        logger.warn('ES overlay failed', { error: esErr.message });
      }
    }

    adData.ad_status = computeAdStatus(adData.last_seen);

    return { code: 200, data: cleanAdsData([adData]), message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (pinterest)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
