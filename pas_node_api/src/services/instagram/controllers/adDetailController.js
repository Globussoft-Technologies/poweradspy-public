'use strict';
const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

// SQL query to get ad details with all JOINs (mirrors PHP getJoindAds)
const AD_DETAIL_SQL = `
  SELECT 
    instagram_ad.id,
    instagram_ad.type,
    instagram_ad.ad_position,
    instagram_ad.views,
    instagram_ad.impression,
    instagram_ad.popularity,
    instagram_ad.comments AS comment,
    instagram_ad.shares AS share,
    instagram_ad.post_date,
    instagram_ad.first_seen,
    instagram_ad.last_seen,
    instagram_ad.days_running,
    instagram_ad.hits,
    instagram_ad.source,
    instagram_ad.discoverer_user_id AS instagram_id,

    instagram_ad_domain.domain,
    instagram_ad_domain.domain_registered_date,

    instagram_ad_meta_data.ad_url,
    instagram_ad_meta_data.built_with_analytics_tracking,
    instagram_ad_meta_data.destination_url,
    instagram_ad_analytics.initial_url,

    instagram_ad_meta_data.built_with,
    instagram_ad_meta_data.affiliate_data,
    instagram_ad_meta_data.screenshot_url,
    instagram_ad_meta_data.png_file,
    instagram_ad_meta_data.white_ad_screenshot,
    instagram_ad_meta_data.blackhat_path,
    instagram_ad_meta_data.white_ad_lander,

    instagram_ad_image_video.ad_image_video AS ad_image_video,

    instagram_call_to_action.call_to_action AS call_to_action,

    instagram_ad_variants.title AS ad_title,
    instagram_ad_variants.text AS ad_text,
    instagram_ad_variants.newsfeed_description AS news_feed_description,
    instagram_ad_variants.image_url AS image_video_url,
    instagram_ad_variants.image_url_original,

    instagram_ad_post_owners.post_owner_name AS post_owner,
    instagram_ad_post_owners.id AS post_owner_id,
    instagram_ad_post_owners.post_owner_image,
    instagram_ad_post_owners.verified,

    instagram_ad_url.country_code,
    instagram_ad_url.url,

    instagram_meta_ad_budget.lowerBudget,
    instagram_meta_ad_budget.upperBudget,

    languages.name AS language,

    
    instagram_page_details.impression_low,
    instagram_page_details.impression_high

  FROM instagram_ad

  LEFT JOIN instagram_ad_meta_data 
    ON instagram_ad.id = instagram_ad_meta_data.instagram_ad_id

  LEFT JOIN instagram_ad_variants 
    ON instagram_ad.id = instagram_ad_variants.instagram_ad_id

  LEFT JOIN instagram_ad_post_owners 
    ON instagram_ad.post_owner_id = instagram_ad_post_owners.id

  LEFT JOIN instagram_ad_image_video 
    ON instagram_ad.id = instagram_ad_image_video.instagram_ad_id

  LEFT JOIN instagram_call_to_action 
    ON instagram_ad.call_to_action_id = instagram_call_to_action.id

  LEFT JOIN instagram_ad_url 
    ON instagram_ad.id = instagram_ad_url.instagram_ad_id

  LEFT JOIN instagram_ad_domain 
    ON instagram_ad.domain_id = instagram_ad_domain.id

  LEFT JOIN instagram_meta_ad_budget 
    ON instagram_ad.id = instagram_meta_ad_budget.instagram_ad_id

  LEFT JOIN languages 
    ON instagram_ad.language_id = languages.id

  LEFT JOIN instagram_page_details
    ON instagram_ad.id = instagram_page_details.instagram_ad_id

  LEFT JOIN instagram_ad_analytics
    ON instagram_ad.default_analytics_id = instagram_ad_analytics.id

  WHERE instagram_ad.id = ?
  LIMIT 1
`;

// Country ISO query
const COUNTRY_ISO_SQL = `
  SELECT 
    instagram_country_only.country,
    instagram_ad_countries_only.instagram_ad_id,
    country_data.instagram_country_iso AS iso
  FROM instagram_ad_countries_only
  LEFT JOIN instagram_country_only 
    ON instagram_ad_countries_only.country_only_id = instagram_country_only.id
  LEFT JOIN country_data 
    ON instagram_country_only.country = country_data.name
  WHERE instagram_ad_countries_only.instagram_ad_id = ?
    AND instagram_country_only.country IS NOT NULL
`;

// Country name from ISO code
const COUNTRY_NAME_SQL = `SELECT name FROM country_data WHERE iso = ?`;

/**
 * Fix known country ISO mapping quirks (mirrors PHP logic).
 */
function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (iso === 'null' || !iso)) return 'CD';
  if (country === 'DR Congo' || name === 'democratic republic of the congo') return 'CD';
  return iso;
}

/**
 * Compute ad status based on last_seen date.
 * Active if last seen within 15 days, otherwise Inactive.
 */
function computeAdStatus(lastSeen) {
  if (!lastSeen) return 'Inactive';
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffDays = Math.floor((now - lastSeenDate) / (1000 * 60 * 60 * 24));
  return diffDays > 15 ? 'Inactive' : 'Active';
}

/**
 * Get ad details by ID.
 * @param {Object} req    - Express request (body.ad_id, body.user_id, body.language)
 * @param {Object} db     - { sql, elastic } injected database connections
 * @param {Object} logger - service logger
 * @returns {Object}      - { code, data, country, builtwithStatusCode }
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
    // ─── Step 1: Get base ad data from MySQL ────────────
    const rows = await db.sql.query(AD_DETAIL_SQL, [p.ad_id]);

    if (!rows || rows.length === 0) {
      return { code: 404, message: 'Ad not found', data: null };
    }

    const adData = { ...rows[0] };

    // ─── Step 2: Overlay ES data (translations, latest LCS, image analysis) ──
    if (db.elastic) {
      try {
        const esParams = {
          index: db.elastic.indexName,
          body: {
            query: {
              bool: {
                filter: { terms: { 'instagram_ad.id': [parseInt(p.ad_id, 10)] } },
              },
            },
          },
        };

        const esResult = await db.elastic.search(esParams);
        const hits = esResult.hits || esResult.body?.hits;

        if (hits && hits.hits && hits.hits.length > 0) {
          const source = hits.hits[0]._source;

          // Translation overlay (if language != 'en')
          const lang = p.language || 'en';
          if (lang !== 'en') {
            const translationKey = `instagram_translations.${lang}`;
            if (source[translationKey]) {
              adData[translationKey] = source[translationKey];
            }
          }

          // Latest LCS from ES (more up-to-date than MySQL)
          if (source['instagram_ad.platform'] !== 15) {
            if (source['instagram_ad.likes'] !== undefined)      adData.likes = source['instagram_ad.likes'];
            if (source['instagram_ad.shares'] !== undefined)     adData.share = source['instagram_ad.shares'];
            if (source['instagram_ad.comments'] !== undefined)   adData.comment = source['instagram_ad.comments'];
            if (source['instagram_ad.impression'] !== undefined) adData.impression = source['instagram_ad.impression'];
            if (source['instagram_ad.popularity'] !== undefined) adData.popularity = source['instagram_ad.popularity'];
            if (source['instagram.averagebudget'] !== undefined) adData.averageBudget = source['instagram.averagebudget'];
          }

          // Image analysis data
          if (source['instagram_ad_variants.image_brand_logo_exactly']) {
            adData.image_brand = source['instagram_ad_variants.image_brand_logo_exactly'];
          }
          if (source['instagram_ad_variants.image_object']) {
            adData.image_object = source['instagram_ad_variants.image_object'];
          }
          if (source['instagram_ad_variants.image_celebrity_exactly']) {
            adData.image_celeb = source['instagram_ad_variants.image_celebrity_exactly'];
          }
          if (source['instagram_ad_variants.image_ocr_exactly']) {
            adData.image_ocr = source['instagram_ad_variants.image_ocr_exactly'];
          }

          // NAS image URL override
          if (source['new_nas_image_url']) {
            adData.image_video_url = source['new_nas_image_url'];
          }
          if (source['nas_video_url']) {
            adData.nas_video_url = source['nas_video_url'];
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: source['instagram_ad_url.url_destination']         || null,
            source_url:      source['instagram_ad_outgoing_links.source_url']   || null,
            redirect_url:    source['instagram_ad_outgoing_links.redirect_url'] || null,
            final_url:       source['instagram_ad_outgoing_links.final_url']    || null,
            url_redirects:   source['instagram_ad_url.url_redirects']           || null,
            destination_url: source['instagram_ad_meta_data.destination_url']   || null,
            initial_url:     source['instagram_ad_meta_data.initial_url']       || null,
          };

          if (source['instagram_ad_domain.domain_registered_date'] !== undefined) adData.domain_registered_date = source['instagram_ad_domain.domain_registered_date'];
          if (source['days_running'] !== undefined) adData.days_running = source['days_running'];

          // Category & SubCategory
          if (source['instagram.category']) adData.ad_category = source['instagram.category'];
          if (source['instagram.subCategory']) adData.subCategory = source['instagram.subCategory'];

          // Behaviours & Interests
          if (source['behaviors']) adData.behaviours = source['behaviors'];
          if (source['interests']) adData.interests = source['interests'];

          // Confidence score
          if (source['confidence_score']) adData.confidence_score = source['confidence_score'];

          // Language from ES lang_detect ISO
          if (source['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, source['lang_detect']);
          }

          // AI creative-quality scores (flat top-level ES keys written by creativeScoreController)
          const CREATIVE_FIELDS = ['creative_predicted_ctr','creative_hook_score','creative_hold_score','creative_hook_total','creative_hold_total','creative_total_score','creative_score_rationale','creative_scored_at','creative_scored_by'];
          for (const f of CREATIVE_FIELDS) { if (source[f] !== undefined) adData[f] = source[f]; }
        }
      } catch (esErr) {
        logger.warn('ES overlay failed, continuing with SQL data only', { error: esErr.message });
      }
    }

    // ─── Step 3: Capitalize call_to_action ──────────────
    if (adData.call_to_action) {
      adData.call_to_action = adData.call_to_action
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }

    // ─── Step 4: Compute ad status ──────────────────────
    adData.ad_status = computeAdStatus(adData.last_seen);

    // ─── Step 5: Get country ISO data ───────────────────
    let countryIso = [];
    try {
      const countryRows = await db.sql.query(COUNTRY_ISO_SQL, [p.ad_id]);
      countryIso = (countryRows || []).map((row) => ({
        country: row.country
          ? row.country.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          : row.country,
        instagram_ad_id: row.instagram_ad_id,
        iso: fixCountryIso(row.country, row.iso),
      }));
    } catch (countryErr) {
      logger.warn('Country ISO query failed', { error: countryErr.message });
    }
    adData.country_iso = countryIso;

    // ─── Step 6: Resolve country codes to names ─────────
    const countryNames = [];
    if (adData.country_code) {
      const separator = adData.country_code.includes('||') ? '||' : '|';
      const codes = adData.country_code.split(separator).filter(Boolean);
      for (const code of codes) {
        try {
          const nameRows = await db.sql.query(COUNTRY_NAME_SQL, [code.trim()]);
          if (nameRows && nameRows.length > 0 && nameRows[0].name) {
            if (!countryNames.includes(nameRows[0].name)) {
              countryNames.push(nameRows[0].name);
            }
          }
        } catch {
          // Skip failed lookups
        }
      }
    }

    // ─── Step 7: Built-with technology status ───────────
    let builtwithStatusCode = 501;
    if (adData.domain && adData.domain !== 'null' && adData.domain !== null) {
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
        logger.warn('Built-with API call failed', { error: bwErr.message });
      }
    }

    return {
      code: 200,
      data: cleanAdsData([{ ...adData, ad_id: adData.ad_id ?? adData.id }]),
      country: countryNames,
      builtwithStatusCode,
      message: 'Ad details fetched successfully',
    };
  } catch (err) {
    logger.error('Error in getAdDetails', { error: err.message, stack: err.stack });
    return {
      code: 500,
      message: 'Error occurred in getAdDetails',
      error: err.message,
    };
  }
}

module.exports = { getAdDetails };
