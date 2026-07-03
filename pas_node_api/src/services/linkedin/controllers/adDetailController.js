'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    linkedin_ad.id,
    linkedin_ad.type,
    linkedin_ad.ad_position,
    linkedin_ad.ad_id,
    linkedin_ad.post_date,
    linkedin_ad.first_seen,
    linkedin_ad.last_seen,
    linkedin_ad.days_running,
    linkedin_ad_analytics.likes,
    linkedin_ad_analytics.followers,
    linkedin_ad_analytics.comments,
    linkedin_country.city,
    linkedin_country.state,
    linkedin_country.country,
    linkedin_ad_domains.domain,
    linkedin_ad_domains.domain_registered_date,
    linkedin_ad_meta_data.platform,
    linkedin_ad_meta_data.destination_url,
    linkedin_ad_meta_data.screenshot_url,
    linkedin_ad_meta_data.ad_url,
    linkedin_ad_image_video.ad_image_video AS ad_image_video,
    linkedin_call_to_actions.action AS call_to_action,
    linkedin_ad_variants.title AS ad_title,
    linkedin_ad_variants.text AS ad_text,
    linkedin_ad_variants.newsfeed_description AS news_feed_description,
    linkedin_ad_variants.image_url AS image_video_url,
    linkedin_ad_variants.image_url_original,
    linkedin_ad_post_owners.post_owner_name AS post_owner,
    linkedin_ad_post_owners.post_owner_image,
    linkedin_ad_lander.png_file,
    linkedin_ad_lander.blackhat_path,
    linkedin_ad_lander.white_ad_screenshot,
    linkedin_ad_lander.white_ad_lander,
    linkedin_ad_outgoing_links.proxy_lander_status,
    linkedin_ad_built_with.built_with_analytics_tracking,
    linkedin_ad_built_with.affiliate_data,
    languages.name AS language,
    linkedin_ad_url.url AS url
  FROM linkedin_ad
  LEFT JOIN linkedin_ad_domains ON linkedin_ad.domain_id = linkedin_ad_domains.id
  LEFT JOIN linkedin_call_to_actions ON linkedin_ad.call_to_action_id = linkedin_call_to_actions.id
  LEFT JOIN linkedin_ad_image_video ON linkedin_ad.id = linkedin_ad_image_video.linkedin_ad_id
  LEFT JOIN linkedin_country ON linkedin_country.id = linkedin_ad.country_id
  LEFT JOIN linkedin_ad_meta_data ON linkedin_ad.id = linkedin_ad_meta_data.linkedin_ad_id
  LEFT JOIN linkedin_ad_url ON linkedin_ad.id = linkedin_ad_url.linkedin_ad_id
  LEFT JOIN linkedin_ad_post_owners ON linkedin_ad.post_owner_id = linkedin_ad_post_owners.id
  LEFT JOIN linkedin_ad_variants ON linkedin_ad.id = linkedin_ad_variants.linkedin_ad_id
  LEFT JOIN linkedin_ad_lander ON linkedin_ad.id = linkedin_ad_lander.linkedin_ad_id
  LEFT JOIN linkedin_ad_outgoing_links ON linkedin_ad.id = linkedin_ad_outgoing_links.linkedin_ad_id
  LEFT JOIN linkedin_ad_built_with ON linkedin_ad.id = linkedin_ad_built_with.linkedin_ad_id
  LEFT JOIN linkedin_ad_analytics ON linkedin_ad.id = linkedin_ad_analytics.linkedin_ad_id
  LEFT JOIN languages ON linkedin_ad.language_id = languages.id
  WHERE linkedin_ad.id = ?
  ORDER BY linkedin_ad_analytics.created DESC
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
          index: 'linkedin_ads_data',
          body: { query: { bool: { filter: { terms: { ad_id: [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`linkedin_translation.${lang}`]) {
            adData[`linkedin_translation.${lang}`] = src[`linkedin_translation.${lang}`];
          }
          if (src.image_brand) adData.image_brand = src.image_brand;
          if (src.image_object) adData.image_object = src.image_object;
          if (src.image_celebrity) adData.image_celeb = src.image_celebrity;
          if (src.image_ocr) adData.image_ocr = src.image_ocr;
          if (src.source) adData.source = src.source;
          if (src.new_nas_image_url) adData.image_video_url = src.new_nas_image_url;
          if (src['linkedin.category']) adData.category = src['linkedin.category'];
          if (src['linkedin.subCategory'] !== undefined) adData.subCategory = src['linkedin.subCategory'];
          if (src['ecommerce_platform']) adData.built_with = src['ecommerce_platform'];
          if (src.impression !== undefined) adData.impression = src.impression;
          if (src.popularity !== undefined) adData.popularity = src.popularity;
          if (src.domain_registration_date !== undefined) {
            const ts = Number(src.domain_registration_date);
            adData.domain_registered_date = ts > 0 ? new Date(ts * 1000).toISOString().split('T')[0] : src.domain_registration_date;
          }
          if (src.duration !== undefined) adData.days_running = src.duration;

          // Language from ES ad_language ISO
          if (src['ad_language']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['ad_language']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            redirect_urls: src['redirect_urls'] || null,
          };
        }
      } catch (esErr) {
        logger.warn('ES overlay failed', { error: esErr.message });
      }
    }

    adData.ad_status = computeAdStatus(adData.last_seen);

    return { code: 200, data: cleanAdsData([adData]), message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (linkedin)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
