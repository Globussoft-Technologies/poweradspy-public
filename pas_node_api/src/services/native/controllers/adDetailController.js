'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { getLanguageMap, resolveLanguageName } = require('../../../utils/languageMap');

const AD_DETAIL_SQL = `
  SELECT
    native_ad.id,
    native_ad.type,
    native_ad.ad_position,
    native_ad.ad_sub_position,
    native_ad.ad_id,
    DATE(native_ad.post_date)                    AS post_date,
    native_ad.first_seen,
    native_ad.last_seen,
    native_ad.days_running,
    native_ad.post_owner_id,
    native_country.city,
    native_country.state,
    native_country.country,
    native_ad_domains.domain,
    native_ad_domains.domain_registered_date,
    native_ad_meta_data.built_with,
    native_ad_meta_data.affiliate_data,
    native_ad_meta_data.platform,
    native_ad_meta_data.destination_url,
    native_ad_meta_data.ad_url,
    native_ad_meta_data.redirect_url,
    native_ad_meta_data.tracker_url,
    native_ad_meta_data.screenshot_url,
    native_ad_meta_data.version,
    native_ad_meta_data.firstSeenOnDesktop,
    native_ad_meta_data.lastSeenOnDesktop,
    native_ad_meta_data.png_file,
    native_ad_meta_data.white_ad_screenshot,
    native_ad_meta_data.blackhat_path,
    native_ad_meta_data.white_ad_lander,
    native_ad_variants.title                     AS ad_title,
    native_ad_variants.text                      AS ad_text,
    native_ad_variants.newsfeed_description      AS news_feed_description,
    native_ad_variants.image_url,
    native_ad_post_owners.post_owner_name        AS post_owner,
    native_ad_post_owners.post_owner_image,
    native_ad_url.country_code,
    native_placement_url.placement_url,
    languages.name                               AS language,
    (
      SELECT GROUP_CONCAT(DISTINCT n.network)
      FROM native_ad_network nan
      JOIN networks n ON nan.network_id = n.id
      WHERE nan.native_ad_id = native_ad.id
    )                                            AS network
  FROM native_ad
  LEFT JOIN native_ad_domains     ON native_ad.domain_id         = native_ad_domains.id
  LEFT JOIN native_country        ON native_country.id           = native_ad.country_id
  LEFT JOIN native_ad_meta_data   ON native_ad.id                = native_ad_meta_data.native_ad_id
  LEFT JOIN native_ad_url         ON native_ad.id                = native_ad_url.native_ad_id
  LEFT JOIN native_ad_post_owners ON native_ad.post_owner_id     = native_ad_post_owners.id
  LEFT JOIN native_ad_variants    ON native_ad.id                = native_ad_variants.native_ad_id
  LEFT JOIN languages             ON native_ad.language_id       = languages.id
  LEFT JOIN native_placement_url  ON native_ad.id                = native_placement_url.native_ad_id
  WHERE native_ad.id = ?
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
          index: db.elastic.indexName || 'native_search_mix_v2',
          body: { query: { bool: { filter: { terms: { 'native_ad.id': [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const lang = p.language || 'en';
          if (lang !== 'en' && src[`native_translations.${lang}`]) {
            adData[`native_translations.${lang}`] = src[`native_translations.${lang}`];
          }
          if (src['native_ad_variants.image_brand_logo_exactly']) adData.imageBrand = src['native_ad_variants.image_brand_logo_exactly'];
          if (src['native_ad_variants.image_object']) adData.imageObject = src['native_ad_variants.image_object'];
          if (src['native_ad_variants.image_celebrity_exactly']) adData.imageCeleb = src['native_ad_variants.image_celebrity_exactly'];
          if (src['native_ad_variants.image_ocr_exactly']) adData.imageOcr = src['native_ad_variants.image_ocr_exactly'];
          if (src['native_ad.nas_url']) adData.image_url = src['native_ad.nas_url'];
          else if (src.new_nas_image_url) adData.image_url = src.new_nas_image_url;
          if (src['native_ad_domains.domain_registered_date'] !== undefined) adData.domain_registered_date = src['native_ad_domains.domain_registered_date'];
          if (src['native_ad_meta_data.built_with_analytics_tracking'] !== undefined) adData.built_with_analytics_tracking = src['native_ad_meta_data.built_with_analytics_tracking'];
          if (src['native_ad.source'] !== undefined) adData.source = src['native_ad.source'];
          if (src['native_ad.days_running'] !== undefined) adData.days_running = src['native_ad.days_running'];
          if (src['native.category'] !== undefined) adData.category = src['native.category'];
          if (src['native.subCategory'] !== undefined) adData.subCategory = src['native.subCategory'];

          // Language from ES lang_detect ISO
          if (src['lang_detect']) {
            const langMap = await getLanguageMap(db.sql);
            adData.language = resolveLanguageName(langMap, src['lang_detect']);
          }

          // Market platform URL fields
          adData.market_platform_urls = {
            url_destination: src['native_ad_url.url_destination']         || null,
            source_url:      src['native_ad_outgoing_links.source_url']   || null,
            redirect_url:    src['native_ad_outgoing_links.redirect_url'] || null,
            final_url:       src['native_ad_outgoing_links.final_url']    || null,
            url_redirects:   src['native_ad_url.url_redirects']           || null,
            destination_url: src['native_ad_meta_data.destination_url']   || null,
          };
        }
      } catch (esErr) {
        logger.warn('ES overlay failed', { error: esErr.message });
      }
    }

    // Redirect chain: initial click -> network tracker -> hops -> final lander -> placement.
    // Hops are stored ||-joined in native_ad_meta_data.redirect_url. tracker_url + initial_url
    // (ad_url) are populated for fresh ads only; historic ads carry just hops + final.
    {
      const hops = (typeof adData.redirect_url === 'string' && adData.redirect_url)
        ? adData.redirect_url.split('||').map((s) => s.trim()).filter(Boolean)
        : [];
      adData.redirect_chain = {
        network:       adData.network         || null,
        tracker_url:   adData.tracker_url     || null,
        initial_url:   adData.ad_url          || null,
        hops,
        final_url:     adData.destination_url || null,
        placement_url: adData.placement_url   || null,
      };
    }

    adData.ad_status = computeAdStatus(adData.last_seen);
    adData.platform_network = 'Native';

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
    logger.error('Error in getAdDetails (native)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
