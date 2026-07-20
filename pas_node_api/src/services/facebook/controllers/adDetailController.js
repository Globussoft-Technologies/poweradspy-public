'use strict';
require("dotenv").config()


const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');

// SQL query to get ad details with all JOINs (mirrors PHP getJoindAds)
const AD_DETAIL_SQL = `
  SELECT 
    facebook_ad.id,
    facebook_ad.platform,
    facebook_ad.type,
    facebook_ad.ad_position,
    facebook_ad.likes,
    facebook_ad.views,
    facebook_ad.impression,
    facebook_ad.popularity,
    facebook_ad.comments AS comment,
    facebook_ad.shares AS share,
    facebook_ad.post_date,
    facebook_ad.first_seen,
    facebook_ad.last_seen,
    facebook_ad.days_running,
    facebook_ad.hits,
    facebook_ad.source,
    facebook_ad.discoverer_user_id AS facebook_id,
    facebook_ad_domains.domain,
    facebook_ad_domains.domain_registered_date,
    facebook_ad_meta_data.ad_url,
    facebook_ad_meta_data.meta_ad_url,
    facebook_ad_meta_data.built_with_analytics_tracking,
    facebook_ad_meta_data.destination_url,
    facebook_ad_meta_data.initial_url,
    facebook_ad_meta_data.screenshot_url_status,
    facebook_ad_meta_data.built_with,
    facebook_ad_meta_data.affiliate_data,
    facebook_ad_meta_data.screenshot_url,
    facebook_ad_meta_data.png_file,
    facebook_ad_meta_data.white_ad_screenshot,
    facebook_ad_meta_data.blackhat_path,
    facebook_ad_meta_data.white_ad_lander,
    facebook_ad_meta_data.est_audience_size_low,
    facebook_ad_meta_data.est_audience_size_high,
    facebook_ad_image_video.ad_image_video AS ad_image_video,
    facebook_call_to_actions.action AS call_to_action,
    facebook_ad_variants.title AS ad_title,
    facebook_ad_variants.text AS ad_text,
    facebook_ad_variants.newsfeed_description AS news_feed_description,
    facebook_ad_variants.image_url AS image_video_url,
    facebook_ad_variants.image_url_original,
    facebook_ad_post_owners.post_owner_name AS post_owner,
    facebook_ad_post_owners.id AS post_owner_id,
    facebook_ad_post_owners.post_owner_image,
    facebook_ad_post_owners.verified,
    facebook_ad_url.country_code,
    facebook_ad_url.url,
    facebook_meta_ad_budget.lowerBudget,
    facebook_meta_ad_budget.upperBudget,
    languages.name AS language,
    facebook_lib_page_details.impression_low,
    facebook_lib_page_details.impression_high
  FROM facebook_ad
  LEFT JOIN facebook_ad_meta_data ON facebook_ad.id = facebook_ad_meta_data.facebook_ad_id
  LEFT JOIN facebook_ad_variants ON facebook_ad.id = facebook_ad_variants.facebook_ad_id
  LEFT JOIN facebook_ad_post_owners ON facebook_ad.post_owner_id = facebook_ad_post_owners.id
  LEFT JOIN facebook_ad_image_video ON facebook_ad.id = facebook_ad_image_video.facebook_ad_id
  LEFT JOIN facebook_call_to_actions ON facebook_ad.call_to_action_id = facebook_call_to_actions.id
  LEFT JOIN facebook_ad_url ON facebook_ad.id = facebook_ad_url.facebook_ad_id
  LEFT JOIN facebook_ad_domains ON facebook_ad.domain_id = facebook_ad_domains.id
  LEFT JOIN facebook_meta_ad_budget ON facebook_ad.id = facebook_meta_ad_budget.facebook_ad_id
  LEFT JOIN languages ON facebook_ad.language_id = languages.id
  LEFT JOIN facebook_lib_page_details ON facebook_ad.id = facebook_lib_page_details.facebook_ad_id
  WHERE facebook_ad.id = ?
  LIMIT 1
`;

// Country ISO query
const COUNTRY_ISO_SQL = `
  SELECT 
    country_only.country,
    facebook_ad_countries_only.facebook_ad_id,
    country_data.iso
  FROM facebook_ad_countries_only
  LEFT JOIN country_only ON facebook_ad_countries_only.country_only_id = country_only.id
  LEFT JOIN country_data ON country_only.country = country_data.name
  WHERE facebook_ad_countries_only.facebook_ad_id = ?
    AND country_only.country IS NOT NULL
`;

// Country name from ISO code
const COUNTRY_NAME_SQL = `SELECT name FROM country_data WHERE iso = ?`;

// Language name from ISO code
const LANGUAGE_NAME_SQL = `SELECT name FROM languages WHERE iso = ?`;

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
    // Language is ES-only — must agree with the language FILTER, which only
    // ever matches `lang_detect`. Discard the stale SQL `languages` join value
    // seeded above by the spread; it's re-populated below only from ES.
    adData.language = null;

    // ─── Step 2: Overlay ES data (translations, latest LCS, image analysis) ──
    if (db.elastic) {
      try {
        const esParams = {
          index: process.env.FB_ES_INDEX,
          body: {
            query: {
              bool: {
                filter: { terms: { 'facebook_ad.id': [parseInt(p.ad_id, 10)] } },
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
            const translationKey = `facebook_translations.${lang}`;
            if (source[translationKey]) {
              adData[translationKey] = source[translationKey];
            }
          }

          // Latest LCS from ES (more up-to-date than MySQL)
          if (source['facebook_ad.platform'] !== 15) {
            if (source['facebook_ad.likes'] !== undefined)      adData.likes = source['facebook_ad.likes'];
            if (source['facebook_ad.shares'] !== undefined)     adData.share = source['facebook_ad.shares'];
            if (source['facebook_ad.comments'] !== undefined)   adData.comment = source['facebook_ad.comments'];
            if (source['facebook_ad.impression'] !== undefined) adData.impression = source['facebook_ad.impression'];
            if (source['facebook_ad.popularity'] !== undefined) adData.popularity = source['facebook_ad.popularity'];
            // Numeric average spend — node-ingested docs use `facebook.averagebudget`,
            // legacy docs use `facebook_ad.averagebudget`. Take whichever ES has.
            {
              const avgBudget = source['facebook.averagebudget'] ?? source['facebook_ad.averagebudget'];
              if (avgBudget !== undefined && avgBudget !== null && avgBudget !== '') adData.averageBudget = Number(avgBudget);
            }
          }

          // Image analysis data
          if (source['facebook_ad_variants.image_brand_logo_exactly']) {
            adData.image_brand = source['facebook_ad_variants.image_brand_logo_exactly'];
          }
          if (source['facebook_ad_variants.image_object']) {
            adData.image_object = source['facebook_ad_variants.image_object'];
          }
          if (source['facebook_ad_variants.image_celebrity_exactly']) {
            adData.image_celeb = source['facebook_ad_variants.image_celebrity_exactly'];
          }
          if (source['facebook_ad_variants.image_ocr_exactly']) {
            adData.image_ocr = source['facebook_ad_variants.image_ocr_exactly'];
          }

          // NAS image URL override
          if (source['new_nas_image_url']) {
            adData.image_video_url = source['new_nas_image_url'];
          }
          if (source['nas_video_url']) {
            adData.nas_video_url = source['nas_video_url'];
          }

          if (source['facebook_ad_domains.domain_registered_date'] !== undefined) adData.domain_registered_date = source['facebook_ad_domains.domain_registered_date'];
          if (source['facebook_ad.days_running'] !== undefined) adData.days_running = source['facebook_ad.days_running'];

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: source['facebook_ad_url.url_destination']         || null,
            source_url:      source['facebook_ad_outgoing_links.source_url']   || null,
            redirect_url:    source['facebook_ad_outgoing_links.redirect_url'] || null,
            final_url:       source['facebook_ad_outgoing_links.final_url']    || null,
            url_redirects:   source['facebook_ad_url.url_redirects']           || null,
            destination_url: source['facebook_ad_meta_data.destination_url']   || null,
            initial_url:     source['facebook_ad_meta_data.initial_url']       || null,
          };

          // Category & SubCategory
          if (source['facebook.category']) adData.ad_category = source['facebook.category'];
          if (source['facebook.subCategory']) adData.subCategory = source['facebook.subCategory'];

          // Behaviours & Interests
          if (source['behaviors']) adData.behaviours = source['behaviors'];
          if (source['interests']) adData.interests = source['interests'];

          // Confidence score
          if (source['confidence_score']) adData.confidence_score = source['confidence_score'];

          // Language from ES lang_detect ISO
          if (source['lang_detect']) {
            try {
              const langRows = await db.sql.query(LANGUAGE_NAME_SQL, [source['lang_detect']]);
              if (langRows && langRows.length > 0 && langRows[0].name) {
                adData.language = langRows[0].name;
              }
            } catch {
              // Name lookup failed — leave language null rather than guess
            }
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
        facebook_ad_id: row.facebook_ad_id,
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
