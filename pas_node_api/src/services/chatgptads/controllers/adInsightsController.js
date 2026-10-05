'use strict';

const { mediaUrl } = require('../helpers/paramParser');
const {
  readAdId,
  fetchAdSource,
  getYearRange,
  getCustomDateRange,
  advertiserFilter,
  fetchAvailableYears,
  fetchAdvertiserCountryHits,
  toAdCountryList,
  aggregateCountryData,
} = require('../helpers/insightsHelpers');

// ─── 1. getAdDetails ────────────────────────────────────

const AD_DETAIL_FIELDS = [
  'id',
  'ad_id',
  'ad_text',
  'ad_title',
  'newsfeed_description',
  'post_owner_image',
  'post_owner_name',
  'new_nas_image_url',
  'first_seen',
  'last_seen',
  'ad_position',
  'type',
  'domain',
  'destination_url',
  'image_url_original',
  'days_running',
  'lang_detect',
];

// Read from ES only to build `image_video_url` — not returned as-is.
const MEDIA_SOURCE_FIELDS = ['Thumbnail', 'nas_video_url'];

async function getAdDetails(req, db, logger) {
  const adId = readAdId(req);

  if (!adId) return { code: 401, message: 'Missing parameters: ad_id is required' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const src = await fetchAdSource(db.elastic, adId, [...AD_DETAIL_FIELDS, ...MEDIA_SOURCE_FIELDS]);
    if (!src) return { code: 404, message: 'Ad not found', data: null };

    const adData = {};
    for (const field of AD_DETAIL_FIELDS) adData[field] = src[field] ?? null;

    // NAS paths → full URLs via the shared NAS resolver (same as the ChatGPT search cards);
    // a DefaultImage placeholder (failed upload) comes back as null rather than a broken image.
    adData.post_owner_image = mediaUrl(adData.post_owner_image) || null;
    adData.new_nas_image_url = mediaUrl(adData.new_nas_image_url) || null;

    // Same shape as the other networks' ad details:
    //   image_video_url    — our stored NAS copy as a full CDN URL (the image for IMAGE ads;
    //                        the video for VIDEO ads, falling back to its thumbnail)
    //   image_url_original — the original source URL the extension sent, unchanged
    const nasMedia = String(src.type || '').toUpperCase() === 'VIDEO'
      ? (src.nas_video_url || src.Thumbnail)
      : src.new_nas_image_url;
    adData.image_video_url = mediaUrl(nasMedia) || null;

    // lang_detect holds the full language name (e.g. "English"). Also sent as `language`,
    // the field the analytics modal (and the other networks' ad details) read.
    adData.language = adData.lang_detect;

    return { code: 200, data: [adData], message: 'Ad details fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdDetails (chatgptads)', { error: err.message });
    return { code: 500, message: 'Error fetching ad details', error: err.message };
  }
}

// ─── 2. getChatgptAdCountry ─────────────────────────────

/**
 * Ad-level country list — every country this one ad has been seen in. ES `country` holds
 * the full list (appended across re-sends by the insertion pipeline), as full names.
 * Returns [{ country, iso: null }] — same shape as the other networks' `country` event;
 * `iso` is null because only names are stored, and the frontend resolves it from the name.
 */
async function getChatgptAdCountry(req, db, logger) {
  const adId = readAdId(req);

  if (!adId) return { code: 401, message: 'Missing parameters: chatgptads_ad_id is required' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const src = await fetchAdSource(db.elastic, adId, ['country']);
    if (!src) return { code: 400, message: 'No data found.', data: null };

    const data = toAdCountryList(src.country);
    if (data.length === 0) return { code: 400, message: 'No country data found.', data: null };

    return { code: 200, message: 'ChatGPT Ads country data fetched.', data };
  } catch (err) {
    logger.error('Error in getChatgptAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getAdvertiserCountryData ────────────────────────

const AD_META_SQL = `
  SELECT ca.last_seen, capo.post_owner_name, capo.post_owner_lower, ca.post_owner_id
  FROM chatgptads_ad ca
  JOIN chatgptads_ad_post_owners capo ON ca.post_owner_id = capo.id
  WHERE ca.id = ?
  LIMIT 1
`;

/**
 * Fetch advertiser-level country data. Default to ad's year.
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const adId = readAdId(req);

  if (!adId) return { code: 401, message: 'Missing chatgptads_ad_id', data: null };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const metaRows = await db.sql.query(AD_META_SQL, [adId]);
    const postOwnerLower = metaRows?.[0]?.post_owner_lower || null;
    const postOwnerId = metaRows?.[0]?.post_owner_id || null;
    const adLastSeen = metaRows?.[0]?.last_seen || null;

    if (!postOwnerLower) return { code: 400, message: 'Advertiser not found', data: null };

    const lastSeenDate = adLastSeen ? new Date(adLastSeen) : null;
    const adYear = parseInt(raw.year, 10)
      || (lastSeenDate && !isNaN(lastSeenDate.getTime()) ? lastSeenDate.getFullYear() : new Date().getFullYear());

    const [availableYears, hitsResult] = await Promise.allSettled([
      fetchAvailableYears(db.elastic, advertiserFilter(postOwnerLower)),
      fetchAdvertiserCountryHits(db.elastic, postOwnerLower, getYearRange(adYear)),
    ]);

    if (hitsResult.status === 'rejected') {
      logger.warn('Advertiser country ES query failed (chatgptads)', { error: hitsResult.reason?.message });
    }

    const hits = hitsResult.status === 'fulfilled' ? hitsResult.value : [];

    const base = {
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
    };

    if (hits.length === 0) {
      return { code: 200, message: 'No data found for this year.', ...base, data: [] };
    }

    const data = aggregateCountryData(hits);

    return { code: 200, message: 'Advertiser country data fetched.', ...base, data: data || [] };
  } catch (err) {
    logger.error('Error in getAdvertiserCountryData (chatgptads)', { error: err.message });
    return { code: 500, message: 'Error fetching advertiser country data', error: err.message };
  }
}

// ─── 4. getAdvertiserInsightsByDateRange ────────────────

const POST_OWNER_SQL = `
  SELECT id, post_owner_lower FROM chatgptads_ad_post_owners WHERE id = ? LIMIT 1
`;

/**
 * Advertiser-level data for a custom date range — the analytics modal's "Select Range" picker.
 * POST /api/v1/chatgptads/ads/getAdvertiserInsightsByDateRange
 * Body: { post_owner_id, from_date, to_date, type }  (dates YYYY-MM-DD)
 *
 * Only `type: "country"` exists for this network — there is no likes/comments/shares or
 * audience data to break down by range.
 */
async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const postOwnerId = parseInt(raw.post_owner_id, 10);
  const fromDate = raw.from_date;
  const toDate = raw.to_date;

  if (!Number.isFinite(postOwnerId)) return { code: 400, message: 'Missing post_owner_id', data: null };
  if (!fromDate || !toDate) return { code: 400, message: 'Missing from_date or to_date', data: null };

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
    return { code: 400, message: 'Invalid date format. Use YYYY-MM-DD', data: null };
  }
  if (fromDate > toDate) {
    return { code: 400, message: 'from_date must be before or equal to to_date', data: null };
  }

  const type = String(raw.type || 'country').toLowerCase();
  if (type !== 'country') {
    return { code: 400, message: `Insight type '${type}' not supported for this platform.`, data: null };
  }

  if (!db.sql) return { code: 503, message: 'SQL connection not available', data: null };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available', data: null };

  try {
    const ownerRows = await db.sql.query(POST_OWNER_SQL, [postOwnerId]);
    const postOwnerLower = ownerRows?.[0]?.post_owner_lower || null;
    if (!postOwnerLower) return { code: 400, message: 'Advertiser not found', data: null };

    const base = { from_date: fromDate, to_date: toDate, post_owner_id: postOwnerId };

    const hits = await fetchAdvertiserCountryHits(db.elastic, postOwnerLower, getCustomDateRange(fromDate, toDate));
    if (hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

    const data = aggregateCountryData(hits);
    if (!data) return { code: 400, message: 'No data found.', ...base, data: [] };

    return { code: 200, message: 'Advertiser country data fetched.', ...base, data };
  } catch (err) {
    logger.error('Error in getAdvertiserInsightsByDateRange (chatgptads)', { error: err.message });
    return { code: 500, message: 'Error fetching advertiser insights', error: err.message };
  }
}

module.exports = {
  getAdDetails,
  getChatgptAdCountry,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
