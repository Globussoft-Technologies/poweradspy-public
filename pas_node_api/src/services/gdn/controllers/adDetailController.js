'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

// SQL to fetch full GDN ad details (mirrors PHP getJoindGdnAds + select list from getAdDetails)
const AD_DETAIL_SQL = `
  SELECT
    gdn_ad.id,
    gdn_ad.source,
    gdn_ad.type,
    gdn_ad.ad_position,
    gdn_ad.ad_sub_position,
    gdn_ad.ad_id,
    DATE(gdn_ad.post_date)          AS post_date,
    gdn_ad.first_seen,
    gdn_ad.last_seen,
    gdn_ad.days_running,
    gdn_country.city,
    gdn_country.state,
    gdn_country.country,
    gdn_ad_domains.domain,
    gdn_ad_domains.domain_registered_date,
    gdn_ad_meta_data.built_with,
    gdn_ad_meta_data.affiliate_data,
    gdn_ad_meta_data.platform,
    gdn_ad_meta_data.destination_url,
    gdn_ad_meta_data.screenshot_url,
    gdn_ad_meta_data.png_file,
    gdn_ad_meta_data.white_ad_screenshot,
    gdn_ad_meta_data.blackhat_path,
    gdn_ad_meta_data.white_ad_lander,
    gdn_ad_meta_data.built_with_analytics_tracking,
    gdn_ad_meta_data.version,
    gdn_ad_meta_data.redirect_url,
    gdn_ad_meta_data.ad_url,
    gdn_ad_meta_data.firstSeenOnDesktop,
    gdn_ad_meta_data.lastSeenOnDesktop,
    gdn_ad_variants.title           AS ad_title,
    gdn_ad_variants.text            AS ad_text,
    gdn_ad_variants.newsfeed_description AS news_feed_description,
    gdn_ad_variants.image_url,
    gdn_ad_post_owners.post_owner_name  AS post_owner,
    gdn_ad_post_owners.post_owner_image,
    languages.name                  AS language,
    gdn_ad_url.url                  AS url
  FROM gdn_ad
  LEFT JOIN gdn_ad_domains     ON gdn_ad.domain_id         = gdn_ad_domains.id
  LEFT JOIN gdn_country        ON gdn_country.id           = gdn_ad.country_id
  LEFT JOIN gdn_ad_meta_data   ON gdn_ad.id                = gdn_ad_meta_data.gdn_ad_id
  LEFT JOIN gdn_ad_url         ON gdn_ad.id                = gdn_ad_url.gdn_ad_id AND gdn_ad_url.url_type = 'R'
  LEFT JOIN gdn_ad_post_owners ON gdn_ad.post_owner_id     = gdn_ad_post_owners.id
  LEFT JOIN gdn_ad_variants    ON gdn_ad.id                = gdn_ad_variants.gdn_ad_id
  LEFT JOIN languages          ON gdn_ad.language_id       = languages.id
  WHERE gdn_ad.id = ?
  LIMIT 1
`;

// Ad URL array (mirrors PHP $value->urlArray)
const AD_URL_SQL = `SELECT url FROM gdn_ad_url WHERE gdn_ad_id = ?`;

function computeAdStatus(lastSeen) {
  if (!lastSeen) return 'Inactive';
  const diffDays = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000);
  return diffDays > 15 ? 'Inactive' : 'Active';
}

/**
 * Get GDN ad details by ID.
 * Mirrors PHP AdDetailsController@getAdDetails
 */
async function getAdDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) {
    return { code: 401, message: 'Missing parameters: ad_id is required' };
  }
  if (!db.sql) {
    return { code: 503, message: 'SQL database connection not available' };
  }

  try {
    const rows = await db.sql.query(AD_DETAIL_SQL, [p.ad_id]);
    if (!rows || rows.length === 0) {
      return { code: 404, message: 'Ad not found', data: null };
    }

    const adData = { ...rows[0] };

    // Fetch URL array
    try {
      const urlRows = await db.sql.query(AD_URL_SQL, [p.ad_id]);
      adData.urlArray = (urlRows || []).map(r => r.url);
    } catch { adData.urlArray = []; }

    // ES overlay (translations, image analysis, NAS image, category)
    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: db.elastic.indexName || 'gdn_search_mix',
          body: {
            query: {
              bool: {
                filter: { terms: { 'gdn_ad.id': [parseInt(p.ad_id, 10)] } },
              },
            },
          },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;

          // Translation overlay
          const lang = p.language || 'en';
          if (lang !== 'en') {
            const translationKey = `gdn_ad_translation.${lang}`;
            if (src[translationKey]) adData[translationKey] = src[translationKey];
          }

          // Image analysis
          if (src['gdn_ad_variants.image_brand_logo'])     adData.image_brand  = src['gdn_ad_variants.image_brand_logo'];
          if (src['gdn_ad_variants.image_object'])         adData.image_object = src['gdn_ad_variants.image_object'];
          if (src['gdn_ad_variants.image_celebrity'])      adData.image_celeb  = src['gdn_ad_variants.image_celebrity'];
          if (src['gdn_ad_variants.image_ocr'])            adData.image_ocr    = src['gdn_ad_variants.image_ocr'];

          // NAS image override
          if (src['new_nas_image_url']) adData.image_url = src['new_nas_image_url'];
          if (src['gdn_ad_domains.domain_registered_date'] !== undefined) adData.domain_registered_date = src['gdn_ad_domains.domain_registered_date'];
          if (src['gdn_ad.days_running'] !== undefined) adData.days_running = src['gdn_ad.days_running'];

          // Category
          if (src['gdn.category']) adData.category = src['gdn.category'];
          if (src['gdn.subCategory'] !== undefined) adData.subCategory = src['gdn.subCategory'];

          // Language from ES lang_detect ISO
          if (src['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['lang_detect']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['gdn_ad_url.url_destination']         || null,
            source_url:      src['gdn_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['gdn_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['gdn_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['gdn_ad_url.url_redirects']           || null,
            destination_url: src['gdn_ad_meta_data.destination_url']   || null,
          };

          // AI creative-quality scores (flat top-level ES keys written by creativeScoreController)
          const CREATIVE_FIELDS = ['creative_predicted_ctr','creative_hook_score','creative_hold_score','creative_hook_total','creative_hold_total','creative_total_score','creative_score_rationale','creative_scored_at','creative_scored_by'];
          for (const f of CREATIVE_FIELDS) { if (src[f] !== undefined) adData[f] = src[f]; }
        }
      } catch (esErr) {
        logger.warn('ES overlay failed in GDN getAdDetails', { error: esErr.message });
      }
    }

    // Ad status
    adData.ad_status = computeAdStatus(adData.last_seen);

    // Built-with technology status
    let builtwithStatusCode = 501;
    if (adData.domain && adData.domain !== 'null') {
      try {
        const builtWithUrl = process.env.API_URL_BUILTWITH;
        if (builtWithUrl) {
          const response = await fetch(`${builtWithUrl}/get-technology-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain_name: adData.domain }),
          });
          const result = await response.json();
          builtwithStatusCode = result.code || 501;
        }
      } catch (bwErr) {
        logger.warn('Built-with API call failed (gdn)', { error: bwErr.message });
      }
    }

    return {
      code: 200,
      data: cleanAdsData([adData]),
      builtwithStatusCode,
      message: 'Ad details fetched successfully',
    };
  } catch (err) {
    logger.error('Error in GDN getAdDetails', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in GDN getAdDetails', error: err.message };
  }
}

module.exports = { getAdDetails };
