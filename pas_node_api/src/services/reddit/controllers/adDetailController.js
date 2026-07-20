'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    reddit_ad.id,
    reddit_ad.likes,
    reddit_ad.source,
    reddit_ad.type,
    reddit_ad.ad_position,
    reddit_ad.ad_id,
    reddit_ad.post_date,
    reddit_ad.first_seen,
    reddit_ad.last_seen,
    reddit_ad.days_running,
    reddit_country.city,
    reddit_country.state,
    reddit_country.country,
    reddit_ad_domain.domain,
    reddit_ad_domain.domain_registered_date,
    reddit_ad_meta_data.built_with,
    reddit_ad_meta_data.built_with_analytics_tracking,
    reddit_ad_meta_data.affiliate_data,
    reddit_ad_meta_data.ad_url,
    reddit_ad_meta_data.platform,
    reddit_ad_meta_data.destination_url,
    reddit_ad_meta_data.screenshot_url,
    reddit_ad_meta_data.redirect_destination_url_source,
    reddit_ad_meta_data.version,
    reddit_ad_meta_data.destination_scraper_status,
    reddit_ad_meta_data.firstSeenOnDesktop,
    reddit_ad_meta_data.lastSeenOnDesktop,
    reddit_ad_meta_data.png_file,
    reddit_ad_meta_data.white_ad_screenshot,
    reddit_ad_meta_data.blackhat_path,
    reddit_ad_meta_data.white_ad_lander,
    reddit_ad_image_video.ad_image_video AS ad_image_video,
    reddit_call_to_action.call_to_action,
    reddit_ad_variants.title AS ad_title,
    reddit_ad_variants.text AS ad_text,
    reddit_ad_variants.newsfeed_description AS news_feed_description,
    reddit_ad_variants.image_url,
    reddit_ad_variants.image_url_original,
    reddit_ad_post_owners.post_owner_name AS post_owner,
    reddit_ad_post_owners.post_owner_image,
    reddit_ad_url.url_type,
    reddit_ad_url.url,
    reddit_ad_url.country_code,
    reddit_ad_outgoing_links.source_url,
    reddit_ad_outgoing_links.redirect_url,
    reddit_ad_outgoing_links.final_url,
    languages.name AS language
  FROM reddit_ad
  LEFT JOIN reddit_ad_image_video ON reddit_ad.id = reddit_ad_image_video.reddit_ad_id
  LEFT JOIN reddit_ad_domain ON reddit_ad.domain_id = reddit_ad_domain.id
  LEFT JOIN reddit_call_to_action ON reddit_ad.call_to_action_id = reddit_call_to_action.id
  LEFT JOIN reddit_country ON reddit_country.id = reddit_ad.country_id
  LEFT JOIN reddit_ad_meta_data ON reddit_ad.id = reddit_ad_meta_data.reddit_ad_id
  LEFT JOIN reddit_ad_url ON reddit_ad.id = reddit_ad_url.reddit_ad_id
  LEFT JOIN reddit_ad_post_owners ON reddit_ad.post_owner_id = reddit_ad_post_owners.id
  LEFT JOIN reddit_ad_variants ON reddit_ad.id = reddit_ad_variants.reddit_ad_id
  LEFT JOIN reddit_ad_outgoing_links ON reddit_ad.id = reddit_ad_outgoing_links.reddit_ad_id
  LEFT JOIN languages ON reddit_ad.language_id = languages.id
  WHERE reddit_ad.id = ?
  LIMIT 1
`;

const COUNTRY_NAME_SQL = `SELECT name FROM country_data WHERE iso = ?`;

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
          index: 'reddit_search_mix',
          body: { query: { bool: { filter: { terms: { 'reddit_ad.id': [Number(p.ad_id)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`reddit_translations.${lang}`]) {
            adData[`reddit_translations.${lang}`] = src[`reddit_translations.${lang}`];
          }
          if (src['reddit_ad_variants.image_brand_logo']) adData.image_brand = src['reddit_ad_variants.image_brand_logo'];
          if (src['reddit_ad_variants.image_object']) adData.image_object = src['reddit_ad_variants.image_object'];
          if (src['reddit_ad_variants.image_celebrity']) adData.image_celeb = src['reddit_ad_variants.image_celebrity'];
          if (src['reddit_ad_variants.image_ocr']) adData.image_ocr = src['reddit_ad_variants.image_ocr'];
          if (src['reddit_ad_meta_data.built_with']) adData.built_with = src['reddit_ad_meta_data.built_with'];
          if (src['reddit_ad_meta_data.built_with_analytics_tracking']) adData.built_with_analytics_tracking = src['reddit_ad_meta_data.built_with_analytics_tracking'];
          if (src.new_nas_image_url) adData.image_url = src.new_nas_image_url;
          if (src['reddit.category']) adData.category = src['reddit.category'];
          if (src['reddit.subCategory'] !== undefined) adData.subCategory = src['reddit.subCategory'];
          if (src['reddit_ad_domain.domain_registered_date'] !== undefined) adData.domain_registered_date = src['reddit_ad_domain.domain_registered_date'];
          if (src['reddit_ad.days_running'] !== undefined) adData.days_running = src['reddit_ad.days_running'];

          // Language from ES lang_detect ISO
          if (src['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['lang_detect']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['reddit_ad_url.url_destination']         || null,
            source_url:      src['reddit_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['reddit_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['reddit_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['reddit_ad_url.url_redirects']           || null,
            destination_url: src['reddit_ad_meta_data.destination_url']   || null,
          };
        }
      } catch (esErr) {
        logger.warn('ES overlay failed', { error: esErr.message });
      }
    }

    adData.ad_status = computeAdStatus(adData.last_seen);

    // Resolve country codes
    const countryNames = [];
    if (adData.country_code) {
      const separator = adData.country_code.includes('||') ? '||' : '|';
      const codes = adData.country_code.split(separator).filter(Boolean);
      for (const code of codes) {
        try {
          const nameRows = await db.sql.query(COUNTRY_NAME_SQL, [code.trim()]);
          if (nameRows?.[0]?.name && !countryNames.includes(nameRows[0].name)) {
            countryNames.push(nameRows[0].name);
          }
        } catch { /* skip */ }
      }
    }

    return { code: 200, data: cleanAdsData([adData]), country: countryNames, message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (reddit)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
