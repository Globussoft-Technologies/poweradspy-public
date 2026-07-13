'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    quora_ad.id,
    quora_ad.source,
    quora_ad.type,
    quora_ad.ad_position,
    quora_ad.ad_id,
    quora_ad.likes,
    quora_ad.comments AS comment,
    quora_ad.shares AS share,
    quora_ad.post_date,
    quora_ad.first_seen,
    quora_ad.last_seen,
    quora_ad.days_running,
    quora_ad.lower_age_seen AS lower_age,
    quora_ad.upper_age_seen AS upper_age,
    quora_ad_domain.domain,
    quora_ad_domain.domain_registered_date,
    quora_ad_meta_data.ad_url,
    quora_ad_meta_data.built_with,
    quora_ad_meta_data.built_with_analytics_tracking,
    quora_ad_meta_data.affiliate_data,
    quora_ad_meta_data.destination_url,
    quora_ad_meta_data.screenshot_url,
    quora_ad_meta_data.png_file,
    quora_ad_meta_data.white_ad_screenshot,
    quora_ad_meta_data.blackhat_path,
    quora_ad_meta_data.white_ad_lander,
    quora_ad_image_video.ad_image_video AS ad_image_video,
    quora_call_to_action.call_to_action AS call_to_action,
    quora_ad_variants.title AS ad_title,
    quora_ad_variants.text AS ad_text,
    quora_ad_variants.newsfeed_description AS news_feed_description,
    quora_ad_variants.image_url AS image_video_url,
    quora_ad_variants.image_url_original,
    quora_ad_variants.video_url,
    quora_ad_post_owners.post_owner_name AS post_owner,
    quora_ad_post_owners.post_owner_image,
    quora_ad_url.url_type,
    quora_ad_url.url,
    quora_ad_url.country_code,
    quora_ad_outgoing_links.source_url,
    quora_ad_outgoing_links.redirect_url,
    quora_ad_outgoing_links.final_url,
    languages.name AS language
  FROM quora_ad
  LEFT JOIN quora_ad_meta_data ON quora_ad.id = quora_ad_meta_data.quora_ad_id
  LEFT JOIN quora_ad_domain ON quora_ad.domain_id = quora_ad_domain.id
  LEFT JOIN quora_ad_image_video ON quora_ad.id = quora_ad_image_video.quora_ad_id
  LEFT JOIN quora_call_to_action ON quora_ad.call_to_action_id = quora_call_to_action.id
  LEFT JOIN quora_ad_url ON quora_ad.id = quora_ad_url.quora_ad_id
  LEFT JOIN quora_ad_variants ON quora_ad.id = quora_ad_variants.quora_ad_id
  LEFT JOIN quora_ad_outgoing_links ON quora_ad.id = quora_ad_outgoing_links.quora_ad_id
  LEFT JOIN quora_ad_post_owners ON quora_ad.post_owner_id = quora_ad_post_owners.id
  LEFT JOIN languages ON quora_ad.language_id = languages.id
  WHERE quora_ad.id = ?
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

    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: 'quora_search_mix',
          body: { query: { bool: { filter: { terms: { 'quora_ad.id': [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`quora_translations.${lang}`]) {
            adData[`quora_translations.${lang}`] = src[`quora_translations.${lang}`];
          }
          if (src['quora_ad_variants.image_brand_logo_exactly']) adData.imageBrand = src['quora_ad_variants.image_brand_logo_exactly'];
          if (src['quora_ad_variants.image_object']) adData.imageObject = src['quora_ad_variants.image_object'];
          if (src['quora_ad_variants.image_celebrity_exactly']) adData.imageCeleb = src['quora_ad_variants.image_celebrity_exactly'];
          if (src['quora_ad_variants.image_ocr_exactly']) adData.imageOcr = src['quora_ad_variants.image_ocr_exactly'];
          if (src.new_nas_image_url) adData.image_video_url = src.new_nas_image_url;
          // CTA is empty in SQL for API-ingested ads (no call_to_action_id link);
          // ES carries it as quora_call_to_action.call_to_action. Overlay when SQL has none.
          if (!adData.call_to_action && src['quora_call_to_action.call_to_action']) adData.call_to_action = src['quora_call_to_action.call_to_action'];
          // Destination URL is deferred in the Node insert (SQL quora_ad_meta_data empty for
          // API-ingested ads); ES has it. Overlay so the CTA button isn't disabled.
          if (!adData.destination_url && src['quora_ad_meta_data.destination_url']) adData.destination_url = src['quora_ad_meta_data.destination_url'];
          if (src['quora_ad_domain.domain_registered_date'] !== undefined) adData.domain_registered_date = src['quora_ad_domain.domain_registered_date'];
          if (src['quora_ad.days_running'] !== undefined) adData.days_running = src['quora_ad.days_running'];
          if (src['quora.category'] !== undefined) adData.category = src['quora.category'];
          if (src['quora.subCategory'] !== undefined) adData.subCategory = src['quora.subCategory'];

          // SOURCE (desktop/ios/android): the ES `source` field is the authoritative
          // scrape source kept current by the insertion pipeline (and consistent with
          // firstSeenOn*), whereas the SQL quora_ad.source column is populated by a
          // different mechanism and can be empty (API-ingested ads) or stale/divergent.
          // Prefer ES whenever it has a value so the frontend matches Kibana; fall back
          // to the SQL value only when ES has none.
          if (src['source']) adData.source = src['source'];

          // The ad's outbound/destination URL lives in ES as quora_ad_meta_data.destination_url
          // (the metadata-table insert is deferred in the Node pipeline, so it's empty in SQL).
          // Surface it as the Basic Info "Redirect URL" — BasicInfo maps adDetails.redirect_url
          // to that row for Quora. Only backfill when SQL didn't supply a real redirect.
          if (!adData.redirect_url && src['quora_ad_meta_data.destination_url']) {
            adData.redirect_url = src['quora_ad_meta_data.destination_url'];
          }

          // Language from ES lang_detect ISO
          if (src['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['lang_detect']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['quora_ad_url.url_destination']         || null,
            source_url:      src['quora_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['quora_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['quora_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['quora_ad_url.url_redirects']           || null,
            destination_url: src['quora_ad_meta_data.destination_url']   || null,
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
    logger.error('Error in getAdDetails (quora)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
