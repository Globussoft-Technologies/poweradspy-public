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
    google_text_ad.last_seen,
    google_text_ad.days_running,
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
    google_text_ad_variants.image_url_original,
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

const TRANSPARENCY_PAYLOAD_SQL = `
  SELECT advertiser_id, ad_url, subnetwork, region_code,
         impressions_min, impressions_max, impressions_operator,
         video_url_original, redirect_url
    FROM google_transparency_ad_payload
   WHERE google_text_ad_id = ?
   LIMIT 1
`;

const TRANSPARENCY_COUNTRY_SQL = `
  SELECT co.country, d.country_code, d.first_seen, d.last_seen,
         d.impressions_min, d.impressions_max, d.impressions_operator
    FROM google_transparency_country_delivery d
    JOIN google_text_country_only co ON co.id = d.country_only_id
   WHERE d.google_text_ad_id = ?
   ORDER BY d.ordinal
`;

function computeAdStatus(lastSeen) {
  if (!lastSeen) return 'Inactive';
  const diffDays = Math.floor((new Date() - new Date(lastSeen)) / (1000 * 60 * 60 * 24));
  return diffDays > 15 ? 'Inactive' : 'Active';
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function dateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  const sqlDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (sqlDate) return sqlDate[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function countryDelivery(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    country: row.country || null,
    country_code: row.country_code || null,
    first_seen: row.first_seen || null,
    last_seen: row.last_seen || null,
    times_shown: row.impressions_operator ? {
      min: row.impressions_min ?? null,
      max: row.impressions_max ?? null,
      operator: row.impressions_operator,
    } : null,
  }));
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

    let esSource = {};
    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2',
          body: { query: { bool: { filter: { terms: { id: [parseInt(p.ad_id, 10)] } } } } },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          esSource = src || {};
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
          if (src.last_seen != null) adData.last_seen = dateOnly(src.last_seen);
          if (src.domain_registered_date !== undefined) {
            adData.domain_registered_date = src.domain_registered_date;
          }

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

    const isTransparency = Number(esSource.platform ?? adData.platform) === 18;
    if (isTransparency) {
      let transparencyPayload = null;
      let deliveryRows = [];
      try {
        const [payloadRows, countryRows] = await Promise.all([
          db.sql.query(TRANSPARENCY_PAYLOAD_SQL, [p.ad_id]),
          db.sql.query(TRANSPARENCY_COUNTRY_SQL, [p.ad_id]),
        ]);
        transparencyPayload = Array.isArray(payloadRows) ? payloadRows[0] || null : null;
        deliveryRows = countryRows;
      } catch (transparencyErr) {
        // The platform-18 tables are deliberately read separately so an
        // environment that has not applied the optional schema can still serve
        // legacy Google details.
        logger.warn('Google Transparency SQL overlay failed', { error: transparencyErr.message });
      }

      const payload = transparencyPayload || {};
      const esCountries = Array.isArray(esSource.country_details)
        ? esSource.country_details
        : null;
      const sqlCountries = countryDelivery(deliveryRows);
      const details = esCountries || sqlCountries;
      const impressions = {
        min: hasOwn(esSource, 'impressions_min')
          ? esSource.impressions_min
          : payload.impressions_min ?? null,
        max: hasOwn(esSource, 'impressions_max')
          ? esSource.impressions_max
          : payload.impressions_max ?? null,
        operator: hasOwn(esSource, 'impressions_operator')
          ? esSource.impressions_operator
          : payload.impressions_operator ?? null,
      };

      adData.platform = 18;
      adData.network = 'google';
      adData.advertiser_id = esSource.advertiser_id || payload.advertiser_id || null;
      adData.ad_url = esSource.ad_url || payload.ad_url || null;
      adData.subnetwork = esSource.subnetwork || payload.subnetwork || null;
      adData.region_code = esSource.region_code || payload.region_code || null;
      adData.source = esSource.source || adData.source || null;
      adData.version = esSource.version || adData.version || null;
      adData.redirect_url = esSource.redirect_url || payload.redirect_url || null;
      adData.destination_url = hasOwn(esSource, 'destination_url')
        ? esSource.destination_url
        : adData.destination_url ?? null;

      // ES owns crawler-null semantics. SQL contains operational fallback
      // dates, so only use SQL when the ES document truly lacks the field.
      adData.first_seen = hasOwn(esSource, 'first_seen')
        ? esSource.first_seen
        : adData.first_seen ?? null;
      adData.last_seen = hasOwn(esSource, 'last_seen')
        ? dateOnly(esSource.last_seen)
        : dateOnly(adData.last_seen);
      if (hasOwn(esSource, 'post_date')) adData.post_date = esSource.post_date;
      const normalizedPostDate = dateOnly(adData.post_date);
      if (!normalizedPostDate || normalizedPostDate.startsWith('1000-')) {
        adData.post_date = null;
      }

      adData.country = Array.isArray(esSource.country)
        ? esSource.country
        : details.map((item) => item.country).filter(Boolean);
      adData.country_details = details;
      adData.impressions = impressions.operator || impressions.min != null || impressions.max != null
        ? impressions
        : null;
      adData.city = null;
      if (/DefaultImage/i.test(String(adData.post_owner_image || ''))) {
        adData.post_owner_image = null;
      }

      adData.image_url_original = esSource.image_url_original || adData.image_url_original || null;
      adData.video_url_original =
        esSource.video_url_original || payload.video_url_original || null;
      adData.thumbnail = esSource.thumbnail ||
        (String(adData.type || esSource.type).toUpperCase() === 'VIDEO'
          ? adData.image_url || null
          : null);
      adData.nas_video_url = esSource.nas_video_url || null;
      adData.image_video_url =
        esSource.image_video_url ||
        esSource.new_nas_image_url ||
        esSource.nas_video_url ||
        (String(adData.type || esSource.type).toUpperCase() === 'VIDEO'
          ? adData.video_url_original
          : adData.image_url || adData.image_url_original || null);
      adData.image_url = String(adData.type || esSource.type).toUpperCase() === 'VIDEO'
        ? adData.thumbnail
        : adData.image_video_url;
      adData.othermultimedia = Array.isArray(esSource.othermultimedia)
        ? esSource.othermultimedia.filter(Boolean)
        : [];
      adData.language = esSource.lang_detect ? adData.language : null;
    }

    adData.ad_status = computeAdStatus(
      isTransparency ? adData.last_seen : adData.lastSeenOnDesktop
    );

    return { code: 200, data: cleanAdsData([adData]), message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (google)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

module.exports = { getAdDetails };
