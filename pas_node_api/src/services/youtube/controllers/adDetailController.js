'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

// SQL query to get ad details with all JOINs (mirrors PHP getJoindYoutubeAds)
const AD_DETAIL_SQL = `
  SELECT
    youtube_ad.id,
    youtube_ad.id AS ad_id,
    youtube_ad.type,
    youtube_ad.ad_position,
    youtube_ad.likes,
    youtube_ad.dislikes,
    youtube_ad.comments AS comment,
    youtube_ad.views AS view,
    youtube_ad.post_date,
    youtube_ad.first_seen,
    youtube_ad.last_seen,
    youtube_ad.days_running,
    youtube_ad.discoverer_user_id AS youtube_id,
    youtube_ad.lower_age_seen AS lower_age,
    youtube_ad.upper_age_seen AS upper_age,

    youtube_ad_domains.domain,
    youtube_ad_domains.domain_registered_date,

    youtube_ad_meta_data.ad_url,
    youtube_ad_meta_data.built_with,
    youtube_ad_meta_data.built_with_analytics_tracking,
    youtube_ad_meta_data.affiliate_data,
    youtube_ad_meta_data.destination_url,
    youtube_ad_meta_data.png_file,
    youtube_ad_meta_data.white_ad_screenshot,
    youtube_ad_meta_data.blackhat_path,
    youtube_ad_meta_data.white_ad_lander,
    youtube_ad_meta_data.platform,
    youtube_ad_meta_data.screenshot_url,
    youtube_ad_meta_data.redirect_destination_url_source,
    youtube_ad_meta_data.version,
    youtube_ad_meta_data.destination_scraper_status,
    youtube_ad_meta_data.firstSeenOnDesktop,
    youtube_ad_meta_data.lastSeenOnDesktop,

    youtube_ad_image_video.ad_image_video AS ad_image_video,

    youtube_call_to_actions.action AS call_to_action,

    youtube_ad_variants.title AS ad_title,
    youtube_ad_variants.text AS ad_text,
    youtube_ad_variants.newsfeed_description AS news_feed_description,
    youtube_ad_variants.thumbnail_url,
    youtube_ad_variants.video_url AS image_video_url,
    youtube_ad_variants.tags,

    youtube_ad_post_owners.post_owner_name AS post_owner,
    youtube_ad_post_owners.post_owner_image,
    youtube_ad_post_owners.id AS post_owner_id,
    youtube_ad_post_owners.verified,

    youtube_country.city,
    youtube_country.state,
    youtube_country.country,

    youtube_category.category_name AS category,

    youtube_ad_url.url_type,
    youtube_ad_url.url,
    youtube_ad_url.country_code,

    youtube_ad_outgoing_links.source_url,
    youtube_ad_outgoing_links.redirect_url,
    youtube_ad_outgoing_links.final_url

  FROM youtube_ad
  LEFT JOIN youtube_ad_image_video ON youtube_ad.id = youtube_ad_image_video.youtube_ad_id
  LEFT JOIN youtube_ad_domains ON youtube_ad.domain_id = youtube_ad_domains.id
  LEFT JOIN youtube_call_to_actions ON youtube_ad.call_to_action_id = youtube_call_to_actions.id
  LEFT JOIN youtube_country ON youtube_country.id = youtube_ad.country_id
  LEFT JOIN youtube_ad_meta_data ON youtube_ad.id = youtube_ad_meta_data.youtube_ad_id
  LEFT JOIN youtube_ad_url ON youtube_ad.id = youtube_ad_url.youtube_ad_id
  LEFT JOIN youtube_ad_post_owners ON youtube_ad.post_owner_id = youtube_ad_post_owners.id
  LEFT JOIN youtube_ad_variants ON youtube_ad.id = youtube_ad_variants.youtube_ad_id
  LEFT JOIN youtube_category ON youtube_category.id = youtube_ad.category_id
  LEFT JOIN youtube_ad_outgoing_links ON youtube_ad.id = youtube_ad_outgoing_links.youtube_ad_id
  WHERE youtube_ad.id = ?
  LIMIT 1
`;

/**
 * Compute ad status based on last_seen date.
 */
function computeAdStatus(lastSeen) {
  if (!lastSeen) return 'Inactive';
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffDays = Math.floor((now - lastSeenDate) / (1000 * 60 * 60 * 24));
  return diffDays > 15 ? 'Inactive' : 'Active';
}

async function getAdDetails(req, db, logger) {
  // console.log('getAdDetails called with params:', { query: req.query, body: req.body });
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) {
    return { code: 401, message: 'Missing parameters: ad_id is required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL database connection not available' };

  try {
    // ─── Step 1: Get base ad data from MySQL ────────────
    const rows = await db.sql.query(AD_DETAIL_SQL, [p.ad_id]);
    // console.log('SQL query executed for ad details', { rows});
    if (!rows || rows.length === 0) {
      return { code: 404, message: 'Ad not found', data: null };
    }

    const adData = { ...rows[0] };
    // Language is sourced exclusively from ES `ad_language` in the overlay below.
    // Initialise to null so ES-unavailable / doc-missing / overlay-failure paths
    // return a deterministic value instead of undefined.
    adData.language = null;

    // ─── Step 2: Overlay ES data ────────────────────────
    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: db.elastic.indexName,
          body: {
            query: {
              bool: {
                filter: { terms: { ad_id: [parseInt(p.ad_id, 10)] } },
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
            const translationKey = `youtube_translations.${lang}`;
            if (src[translationKey]) adData[translationKey] = src[translationKey];
          }

          // Image analysis
          if (src.image_brand) adData.imageBrand = src.image_brand;
          if (src.image_object) adData.imageObject = src.image_object;
          if (src.image_celebrity) adData.imageCeleb = src.image_celebrity;
          if (src.image_ocr) adData.imageOcr = src.image_ocr;

          // Source & NAS image override
          if (src.source) adData.source = src.source;
          if (src.new_nas_image_url) adData.image_video_url = src.new_nas_image_url;
          if (src.domain_registration_date !== undefined) adData.domain_registered_date = src.domain_registration_date;
          if (src['duration'] !== undefined) adData.days_running = src['duration'];

          // Category
          adData.category = src['youtube.category'] || adData.category || null;
          if (src['youtube.subCategory'] !== undefined) adData.subCategory = src['youtube.subCategory'];

          // Funnel / built_with_analytics_tracking
          if (src.funnel) adData.built_with_analytics_tracking = src.funnel;

          // Landing data
          if (src.landing_urls) adData.landing_urls = src.landing_urls;
          if (src.landing_text) adData.landing_text = src.landing_text;

          // Budget
          if (src['youtube.averageBudget'] !== undefined && src['youtube.lowerBudget'] !== undefined && src['youtube.upperBudget'] !== undefined) {
            adData.averageBudget = src['youtube.averageBudget'];
            adData.ad_lowerBudget = src['youtube.lowerBudget'];
            adData.ad_upperBudget = src['youtube.upperBudget'];
          } else {
            adData.averageBudget = null;
          }

          // Text image title
          adData.text_image_title = src.text_image_title || null;

          // Language comes exclusively from ES `ad_language` (ISO). The SQL languages
          // join was removed above because its per-ad value is stale for many rows.
          // getLanguageMap is only used to resolve the ISO → display name (a small
          // reference lookup), not to source the ad's language.
          if (src['ad_language']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['ad_language']);
          } else {
            adData.language = null;
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            redirect_urls: src['redirect_urls'] || null,
          };

          // AI creative-quality scores (flat top-level ES keys written by creativeScoreController)
          const CREATIVE_FIELDS = ['creative_predicted_ctr','creative_hook_score','creative_hold_score','creative_hook_total','creative_hold_total','creative_total_score','creative_score_rationale','creative_scored_at','creative_scored_by'];
          for (const f of CREATIVE_FIELDS) { if (src[f] !== undefined) adData[f] = src[f]; }
        }
      } catch (esErr) {
        // console.log('ES overlay failed, continuing with SQL data only', { error: esErr.message });
        logger.warn('ES overlay failed, continuing with SQL data only', { error: esErr.message });
      }
    }

    // ─── Step 3: Compute ad status ──────────────────────
    adData.ad_status = computeAdStatus(adData.last_seen);

    // ─── Step 4: Resolve country codes to names (batch) ──
    const countryNames = [];
    if (adData.country_code) {
      const separator = adData.country_code.includes('||') ? '||' : '|';
      const codes = adData.country_code.split(separator).filter(Boolean).map(c => c.trim());
      const uniqueCodes = [...new Set(codes)];
      if (uniqueCodes.length > 0 && db.sql) {
        try {
          const placeholders = uniqueCodes.map(() => '?').join(',');
          const nameRows = await db.sql.query(
            `SELECT iso, name FROM country_data WHERE iso IN (${placeholders})`,
            uniqueCodes
          );
          if (nameRows) {
            for (const row of nameRows) {
              if (row.name && !countryNames.includes(row.name)) {
                countryNames.push(row.name);
              }
            }
          }
        } catch { /* skip */ }
      }
    }
    return {
      code: 200,
      data: cleanAdsData([adData]),
      country: countryNames,
      message: 'Ad details fetched successfully',
    };
  } catch (err) {
    logger.error('Error in getAdDetails (youtube)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
