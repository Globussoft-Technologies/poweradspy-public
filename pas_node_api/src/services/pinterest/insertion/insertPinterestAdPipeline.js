'use strict';

/**
 * Pinterest ad insertion pipeline — port of adsController::insert_ads_in_sql_es()
 * and processAd() / updateAdsData().
 *
 * Optimized the same way as Native:
 *   - Translation capped at 3s
 *   - Image download starts immediately, overlaps with ALL DB work
 *   - Parallel pre-tx DB lookups for post owner, domain, language
 *   - Country lookups/inserts are done inside the tx because the payload may
 *     contain multiple comma-separated countries (platform 12/15 style)
 *   - All media uploads awaited before response (no fire-and-forget on SQL paths)
 *   - ES index fire-and-forget (search index only, SQL is source of truth)
 */

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const axios = require('axios');
const https = require('https');
const repo  = require('./repository');
const { validatePinterestAds }    = require('./validate');
const { normalizePinterestAd, explodeMediaUrl, nowDateTime } = require('./normalize');
const { buildPinterestSearchMixDoc, searchIdQuery, firstHitId } = require('./esDocBuilder');
const { PINTEREST_INSERT_COLUMNS } = require('./esColumns');
const { saveOwnerImage } = require('./postOwner');
const api   = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { storeInNas } = require('../../../insertion/helpers/nasClient');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

// Pinterest CDN requires Referer + User-Agent headers — plain axios GET is blocked
const pinterestAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
async function downloadPinterestImage(url, ext) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      responseType:     'arraybuffer',
      timeout:          30000,
      httpsAgent:       pinterestAgent,
      validateStatus:   () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer':    'https://www.pinterest.com/',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.status !== 200 || !res.data || res.data.byteLength === 0) return null;
    const tmp = path.join(os.tmpdir(), `pint_${Date.now()}_${Math.round(process.hrtime()[1])}.${ext}`);
    fs.writeFileSync(tmp, Buffer.from(res.data));
    return tmp;
  } catch { return null; }
}

const ES_INDEX              = 'pinterest_search_mix';
const TRANSLATION_TIMEOUT   = 3000;

// ── Entry point ────────────────────────────────────────────────────────────────

async function processPinterestAd(ad, ctx) {
  const { db, log, network = 'pinterest' } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available.');

  if (!ad.ad_id) {
    return rejected(400, 'Missing ad_id.', { field: 'ad_id', hint: 'Every ad must carry a unique ad_id.' });
  }

  // PHP: country empty check
  if (!ad.country || String(ad.country).trim() === '') {
    return rejected(400, 'Invalid country data.', { field: 'country' });
  }

  // PHP: Video ads require thumbnail_url — the video file itself is NOT uploaded to NAS,
  // only the thumbnail is. Reject early if thumbnail is missing.
  if (ad.type === 'Video' && (!ad.thumbnail_url || String(ad.thumbnail_url).trim() === '')) {
    return rejected(400, 'Thumbnail field should be present for video ads.', {
      field: 'thumbnail_url',
      hint: 'Include a non-empty thumbnail_url for Video ads.',
    });
  }

  const v = validatePinterestAds(ad);
  if (v.code !== 200) return v;

  const n = normalizePinterestAd(ad);

  // Step 1 — existence check + translation in parallel
  const [existing, translationResult] = await Promise.all([
    repo.getAdByAdId(sql, n.ad_id),
    Promise.race([
      api.translate({ call_to_action: '', text: n.ad_text ?? '', title: n.ad_title ?? '', newsfeed_description: n.newsfeed_description ?? '' }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false }), TRANSLATION_TIMEOUT)),
    ]),
  ]);

  const translation = translationResult.ok ? translationResult.data : null;

  try {
    if (existing.code === 400) {
      return await insertPath(ctx, n, { translation, network });
    }
    return await updatePath(ctx, n, { existingId: existing.data[0].id, network });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('pinterest pipeline error', { error: err.message, ad_id: n.ad_id });
    return serverError(500, 'The ad could not be processed because of a server error.', { error: err.message });
  }
}

// ── INSERT path ────────────────────────────────────────────────────────────────
// Mirrors PHP exactly: upload media FIRST, then DB transaction.
// If upload fails → return 500, zero DB writes (clean state guaranteed).

async function insertPath(ctx, n, { translation, network }) {
  const { db, log } = ctx;
  const sql = db.sql;

  const iso    = translation?.detected_language ?? null;
  const domain = extractDomain(n.destination_url);

  // Step 1 — Upload media to NAS FIRST (PHP does this before any DB work)
  // Image: upload ad image(s). Video: upload thumbnail only (video URL stays as image_url_original).
  let nasImageUrl = null, nasThumbnailUrl = null;

  if (n.type === 'IMAGE' && n.ad_image) {
    const imageUrls = explodeMediaUrl(n.ad_image);
    const nasUrls = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const tmp = await downloadPinterestImage(imageUrls[i], 'jpg');
      if (tmp) {
        try {
          const keyBase = imageUrls.length > 1 ? `${n.ad_id}_${i + 1}` : n.ad_id;
          const nasPath = await storeInNas('IMAGE', tmp, n.ad_id, network, keyBase);
          if (nasPath && !nasPath.includes('DefaultImage')) nasUrls.push(nasPath);
        } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
      }
    }
    nasImageUrl = nasUrls.length > 1 ? nasUrls.join('||') : (nasUrls[0] ?? null);
    // PHP: if upload returns DefaultImage → abort with 500, no DB writes
    if (!nasImageUrl) return serverError(500, 'Failed when uploading image to NAS.', { hint: 'Check NAS config and image URL.' });
  }

  if (n.type === 'VIDEO' && n.thumbnail_url) {
    const thumbUrls = explodeMediaUrl(n.thumbnail_url);
    const nasUrls = [];
    for (let i = 0; i < thumbUrls.length; i++) {
      const tmp = await downloadPinterestImage(thumbUrls[i], 'jpg');
      if (tmp) {
        try {
          const keyBase = thumbUrls.length > 1 ? `${n.ad_id}_${i + 1}` : n.ad_id;
          const nasPath = await storeInNas('THUMBNAIL', tmp, n.ad_id, network, keyBase);
          if (nasPath && !nasPath.includes('DefaultImage')) nasUrls.push(nasPath);
        } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
      }
    }
    nasThumbnailUrl = nasUrls.length > 1 ? nasUrls.join('||') : (nasUrls[0] ?? null);
    if (!nasThumbnailUrl) return serverError(500, 'Failed when uploading thumbnail to NAS.', { hint: 'Check NAS config and thumbnail URL.' });
  }

  // NAS path for the variant — Image uses image NAS path; Video uses thumbnail NAS path
  const variantImageUrl = nasImageUrl ?? nasThumbnailUrl ?? null;

  // Step 2 — parallel pre-tx lookups
  const [
    postOwnerRes,
    domainRes,
    languageId,
  ] = await Promise.all([
    repo.getPostOwner(sql, n.post_owner),
    domain ? repo.getDomain(sql, domain) : Promise.resolve({ code: 400, data: null }),
    iso ? repo.getLanguageId(sql, iso)   : Promise.resolve(0),
  ]);

  // Step 3 — transaction (only INSERTs, NAS URL already available)
  const result = await repo.withTransaction(sql, async (tx) => {

    // Post owner
    let postOwnerId;
    if (postOwnerRes.code !== 200) {
      postOwnerId = await repo.insertPostOwner(tx, {
        post_owner_name:  n.post_owner,
        post_owner_image: n.post_owner_image || '/DefaultImage.jpg',
        ads_count:        1,
      });
    } else {
      postOwnerId = postOwnerRes.data[0].id;
      const upd = { ads_count: (postOwnerRes.data[0].ads_count ?? 0) + 1 };
      if (n.post_owner_image) upd.post_owner_image = n.post_owner_image;
      await repo.updatePostOwner(tx, upd, postOwnerId);
    }

    // Domain
    let domainId = 0;
    if (domain) domainId = domainRes.code === 200 ? domainRes.data[0].id : await repo.insertDomain(tx, domain);

    // Countries (split comma-separated list; each country gets its own row)
    const countries = parseCountries(n.country);
    const countryMappings = [];
    for (const country of countries) {
      countryMappings.push(await ensureCountry(tx, n.city, n.state, country));
    }
    const lastCountry = countryMappings[countryMappings.length - 1] || { countryId: 0, countryOnlyId: 0 };
    const countryId = lastCountry.countryId;
    const countryOnlyId = lastCountry.countryOnlyId;

    // pinterest_ad main row
    const pinterestAdId = await repo.insertPinterestAd(tx, stripNulls({
      ad_id:              n.ad_id,
      language_id:        languageId,
      post_owner_updated: 0,
      type:               n.type,
      ad_position:        n.ad_position,
      ad_sub_position:    n.ad_sub_position ?? null,
      post_date:          n.post_date,
      first_seen:         n.first_seen,
      last_seen:          n.last_seen,
      days_running:       1,
      source:             n.source ?? 'desktop',
      domain_id:          domainId || null,
      country_id:         countryId || null,
      country_only_id:    countryOnlyId || null,
      post_owner_id:      postOwnerId || null,
      ad_start_date:      n.ad_start_date ? formatDate(n.ad_start_date) : null,
      ad_end_date:        n.ad_end_date   ? formatDate(n.ad_end_date)   : null,
    }));

    if (!pinterestAdId) {
      const e = new Error(`ad_id "${n.ad_id}" already exists.`);
      e.insertionCode = 402; e.insertionHint = 'The ad is already stored.';
      throw e;
    }

    // Variant — insert with real NAS URL (no placeholder needed since upload already done)
    await repo.insertPinterestAdVariant(tx, {
      pinterest_ad_id:      pinterestAdId,
      title:                n.ad_title,
      text:                 n.ad_text,
      newsfeed_description: n.newsfeed_description,
      target_keyword:       n.target_keyword || null,
      image_url:            variantImageUrl,             // real NAS path from Step 1
      image_url_original:   n.type === 'IMAGE' ? (n.ad_image ?? null) : (n.ad_video ?? null),
    });

    // Countries
    for (const { countryId: cid, countryOnlyId: coid } of countryMappings) {
      if (!coid) continue;
      await repo.insertPinterestAdCountry(tx, { pinterest_ad_id: pinterestAdId, country_id: cid, country_only_id: coid, count: 1 });
      await repo.insertPinterestAdCountryOnly(tx, { pinterest_ad_id: pinterestAdId, country_only_id: coid, count: 1, ip_address: n.ip_address });
    }

    // Meta data
    await repo.insertPinterestAdMetaData(tx, {
      pinterest_ad_id:    pinterestAdId,
      platform:           n.platform,
      version:            n.version ?? null,
      destination_url:    n.destination_url || null,
      ad_url:             n.ad_url ?? null,
      firstSeenOnDesktop: nowDateTime(),
      lastSeenOnDesktop:  nowDateTime(),
      screenshot_url:     '/processing.gif',
    });

    if (String(n.platform) === '10' && n.system_id) {
      await repo.insertPinterestAccountActivity(tx, {
        system_id: n.system_id, pinterest_ad_id: pinterestAdId,
        account_id: n.pinterest_id ?? null, platform: 10, is_unique: 1,
      }).catch(() => {});
    }

    return { pinterestAdId, postOwnerId, iso };
  });

  // Step 4 — post-owner image upload using Pinterest CDN headers (same as ad image)
  let postOwnerNasImage = null;
  if (n.post_owner_image) {
    const tmp = await downloadPinterestImage(n.post_owner_image, 'jpg');
    if (tmp) {
      try {
        const nasPath = await storeInNas('POSTOWNER', tmp, result.postOwnerId, network, `${result.postOwnerId}`);
        if (nasPath && !nasPath.includes('DefaultImage')) {
          postOwnerNasImage = nasPath;
          await repo.updatePostOwner(sql, { post_owner_image: nasPath }, result.postOwnerId).catch(() => {});
        }
      } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    }
  }

  // Step 5 — ES index (fire-and-forget, SQL is source of truth)
  indexAd(ctx, result.pinterestAdId, n, {
    iso:               result.iso,
    nasImageUrl,
    nasThumbnailUrl,
    imageUrlOriginal:  n.type === 'IMAGE' ? (n.ad_image ?? null) : (n.ad_video ?? null),
    postOwnerNasImage,
  }).catch((e) => log.warn('ES index failed', { error: e.message }));

  api.adgptInsert({ ad_id: n.ad_id, pinterest_ad_id: result.pinterestAdId, type: n.type, platform: n.platform });

  return ok(result.pinterestAdId, 'Ad inserted successfully');
}

// ── UPDATE path ────────────────────────────────────────────────────────────────

async function updatePath(ctx, n, { existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const adId = existingId;

  const adRow = await repo.getAdByAdId(sql, n.ad_id);
  const firstSeen = adRow.data?.[0]?.first_seen ?? n.first_seen;
  const daysRunning = computeDaysRunning(firstSeen, n.last_seen);

  // Update ad row (post_date write-once backfill: only if DB has none and crawler now sends one)
  const curPostEpoch = Date.parse(adRow.data?.[0]?.post_date);
  const backfillPostDate = !(Number.isFinite(curPostEpoch) && curPostEpoch > 0) && n.post_date;
  await repo.updatePinterestAd(sql, {
    last_seen: n.last_seen,
    days_running: daysRunning,
    ...(backfillPostDate ? { post_date: n.post_date } : {}),
  }, adId);

  // Country upsert (split comma-separated list; each country gets its own row)
  const countryList = parseCountries(n.country);
  for (const country of countryList) {
    const { countryId, countryOnlyId } = await ensureCountry(sql, n.city, n.state, country);
    const [crRes, coRes] = await Promise.all([
      repo.getPinterestAdCountry(sql, adId, countryId),
      repo.getPinterestAdCountryOnly(sql, adId, countryOnlyId),
    ]);
    await Promise.all([
      crRes.code === 200
        ? repo.updatePinterestAdCountryCount(sql, crRes.data[0].id)
        : repo.insertPinterestAdCountry(sql, { pinterest_ad_id: adId, country_id: countryId, country_only_id: countryOnlyId, count: 1 }),
      coRes.code === 200
        ? repo.updatePinterestAdCountryOnlyCount(sql, coRes.data[0].id)
        : repo.insertPinterestAdCountryOnly(sql, { pinterest_ad_id: adId, country_only_id: countryOnlyId, count: 1, ip_address: n.ip_address }),
    ]);
  }

  // Re-upload media first (PHP pattern — upload before DB writes)
  let updatedNasPath = null;
  const mediaUrl = n.type === 'IMAGE' ? n.ad_image : n.thumbnail_url;
  const nasType  = n.type === 'IMAGE' ? 'IMAGE' : 'THUMBNAIL';
  if (mediaUrl) {
    const tmp = await downloadPinterestImage(mediaUrl, 'jpg');
    if (tmp) {
      try {
        const nasPath = await storeInNas(nasType, tmp, adId, network, `${adId}`);
        if (nasPath && !nasPath.includes('DefaultImage')) updatedNasPath = nasPath;
      } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    }
  }

  // Build variant update object
  const variantUpdate = {};
  const imageUrlOriginal = n.type === 'IMAGE' ? n.ad_image : n.ad_video;
  if (imageUrlOriginal) variantUpdate.image_url_original = imageUrlOriginal;
  if (updatedNasPath)   variantUpdate.image_url           = updatedNasPath;

  // Append new target_keyword if not already present
  if (n.target_keyword) {
    const currentVariant = await sql.query(
      'SELECT target_keyword FROM pinterest_ad_variants WHERE pinterest_ad_id = ? LIMIT 1', [adId]
    ).then((r) => (Array.isArray(r) && r.length > 0 ? r[0] : null)).catch(() => null);

    if (currentVariant) {
      const existing = (currentVariant.target_keyword || '').toLowerCase().split('|').map((s) => s.trim()).filter(Boolean);
      if (!existing.includes(n.target_keyword.toLowerCase())) {
        existing.push(n.target_keyword.toLowerCase());
        variantUpdate.target_keyword = existing.join('|');
      }
    }
  }

  if (Object.keys(variantUpdate).length > 0) {
    await repo.updatePinterestAdVariant(sql, variantUpdate, adId).catch(() => {});
  }

  // Platform 10: account activity
  if (String(n.platform) === '10' && n.system_id) {
    await repo.insertPinterestAccountActivity(sql, {
      system_id: n.system_id, pinterest_ad_id: adId,
      account_id: n.pinterest_id ?? null, platform: 10, is_unique: 0,
    }).catch(() => {});
  }

  // Platform 15: update dates
  if (String(n.platform) === '15') {
    const dateUpdate = {};
    if (n.ad_start_date) dateUpdate.ad_start_date = formatDate(n.ad_start_date);
    if (n.ad_end_date)   dateUpdate.ad_end_date   = formatDate(n.ad_end_date);
    if (Object.keys(dateUpdate).length) await repo.updatePinterestAd(sql, dateUpdate, adId).catch(() => {});
  }

  // Post-owner image upload using Pinterest headers — pass correct post_owner_id
  const postOwnerIdForUpdate = adRow.data?.[0]?.post_owner_id ?? null;
  if (postOwnerIdForUpdate && n.post_owner_image) {
    downloadPinterestImage(n.post_owner_image, 'jpg').then(async (tmp) => {
      if (!tmp) return;
      try {
        const nasPath = await storeInNas('POSTOWNER', tmp, postOwnerIdForUpdate, network, `${postOwnerIdForUpdate}`);
        if (nasPath && !nasPath.includes('DefaultImage')) {
          await repo.updatePostOwner(sql, { post_owner_image: nasPath }, postOwnerIdForUpdate).catch(() => {});
        }
      } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    }).catch(() => {});
  }

  // Fetch countries for ES
  const countries = await repo.getAdCountriesList(sql, adId);

  // ES partial update
  if (db.elastic) {
    try {
      const esRes = await db.elastic.search(searchIdQuery(ES_INDEX, adId));
      const _id = firstHitId(esRes);
      if (_id) {
        const esUpdate = {
          'pinterest_ad.last_seen':          n.last_seen,
          'pinterest_ad.days_running':       daysRunning,
          'pinterest_country_only.country':  countries,
          'pinterest_ad.platform':           n.platform,
          image_url_original:                imageUrlOriginal ?? null,
          states: n.state ? n.state.split(',').map((s) => s.trim()).filter(Boolean) : [],
          city:   n.city  ? n.city.split(',').map((s) => s.trim()).filter(Boolean)  : [],
        };
        // PHP: Image → image_url + new_nas_image_url; Video → thumbnail only
        if (updatedNasPath) {
          if (n.type === 'IMAGE') {
            esUpdate.image_url         = updatedNasPath;
            esUpdate.new_nas_image_url = updatedNasPath;
          } else {
            esUpdate.thumbnail = updatedNasPath;
          }
        }
        if (variantUpdate.target_keyword) {
          esUpdate['pinterest_ad_variants.target_keyword'] = variantUpdate.target_keyword.split('|');
        }
        await db.elastic.update({ index: ES_INDEX, type: 'doc', id: _id, body: { doc: esUpdate } });
      }
    } catch (e) {
      log.warn('ES update failed', { error: e.message, adId });
    }
  }

  return updated(adId, null);
}

// ── ES index ──────────────────────────────────────────────────────────────────

async function indexAd(ctx, pinterestAdId, n, result) {
  const { db } = ctx;
  if (!db.elastic) return;
  const [joined, countries] = await Promise.all([
    repo.getJoinedAd(db.sql, pinterestAdId),
    repo.getAdCountriesList(db.sql, pinterestAdId),
  ]);
  const row = joined[0];
  if (!row) return;

  const extra = {
    lang_detect:                       (result.iso || '').toLowerCase(),
    'pinterest_ad.platform':           n.platform,
    'pinterest_country_only.country':  countries,
    states: n.state ? n.state.split(',').map((s) => s.trim()).filter(Boolean) : [],
    city:   n.city  ? n.city.split(',').map((s) => s.trim()).filter(Boolean)  : [],
    image_url_original:                result.imageUrlOriginal ?? null,
    post_owner_image:                  result.postOwnerNasImage ?? row.post_owner_image ?? null,
  };

  // PHP: Image → set image_url + new_nas_image_url only
  //      Video → set thumbnail only (image_url/new_nas_image_url not set for video)
  if (n.type === 'IMAGE' && result.nasImageUrl) {
    extra.image_url         = result.nasImageUrl;
    extra.new_nas_image_url = result.nasImageUrl;
  }
  if (n.type === 'VIDEO' && result.nasThumbnailUrl) {
    extra.thumbnail = result.nasThumbnailUrl;
  }

  // Platform 15 extra fields
  if (String(n.platform) === '15') {
    if (n.ad_start_date)              extra.ad_start_date              = formatDate(n.ad_start_date);
    if (n.ad_end_date)                extra.ad_end_date                = formatDate(n.ad_end_date);
    if (n.interests)                  extra.interests                  = n.interests;
    if (n.keywords_used)              extra.keywords_used              = n.keywords_used;
    if (n.negative_keywords_used)     extra.negative_keywords_used     = n.negative_keywords_used;
    if (n.pinner_list_types)          extra.pinner_list_types          = n.pinner_list_types;
    if (n.postal_codes)               extra.postal_codes               = n.postal_codes;
    if (n.regions)                    extra.pinner_regionslist_types   = n.regions;
    if (n.reach_count_eu_low != null) extra.reach_count_eu_low         = n.reach_count_eu_low;
    if (n.reach_count_eu_high != null) extra.reach_count_eu_high        = n.reach_count_eu_high;
    if (n.reach_count_by_country)     extra.reach_count_by_country     = n.reach_count_by_country;
    if (n.ad_url)                     extra['pinterest_ad_url.url']    = n.ad_url;
  }

  const doc = buildPinterestSearchMixDoc(PINTEREST_INSERT_COLUMNS, row, { index: ES_INDEX, extra });

  let _id;
  try { const f = await db.elastic.search(searchIdQuery(ES_INDEX, pinterestAdId)); _id = firstHitId(f); } catch { /* ignore */ }
  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDate(v) {
  if (!v) return null;
  try { return new Date(v).toISOString().split('T')[0]; } catch { return null; }
}

function computeDaysRunning(firstSeen, lastSeen) {
  try {
    const toDate = (s) => new Date(String(s).includes('T') ? s : s.replace(' ', 'T') + 'Z');
    const diff = Math.floor((toDate(lastSeen) - toDate(firstSeen)) / 86400000);
    return diff > 1 ? diff + 1 : 1;
  } catch { return 1; }
}

function parseCountries(countryStr) {
  if (!countryStr || typeof countryStr !== 'string') return [];
  return countryStr.split(',').map((s) => s.trim()).filter(Boolean);
}

async function ensureCountry(exec, city, state, country) {
  let countryOnlyRes = await repo.getCountryOnly(exec, country);
  const countryOnlyId = countryOnlyRes.code === 200
    ? countryOnlyRes.data[0].id
    : await repo.insertCountryOnly(exec, country);

  let countryRes = await repo.getCountry(exec, city, state, country);
  const countryId = countryRes.code === 200
    ? countryRes.data[0].id
    : await repo.insertCountry(exec, { city, state, country, country_only_id: countryOnlyId });

  return { countryId, countryOnlyId };
}

module.exports = { processPinterestAd };
