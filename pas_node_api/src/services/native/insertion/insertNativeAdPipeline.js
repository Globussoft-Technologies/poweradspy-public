'use strict';

/**
 * Native ad insertion pipeline — optimized port of NativeAdController::insertNewNativeAds().
 *
 * Key optimization vs naïve port:
 *   - All independent DB lookups (postOwner, domain, country, network, targetSite, language)
 *     run in ONE Promise.all BEFORE the transaction instead of sequentially inside it.
 *   - Translation API + ad-existence check also run in parallel before everything else.
 *   - Post-commit media uploads run in parallel.
 *   - Inside the transaction only INSERT operations remain (sequential — single connection rule).
 */

const fs    = require('fs');
const repo  = require('./repository');
const { validateNativeAds }   = require('./validate');
const { normalizeNativeAd, checkVersion, nowDateTime } = require('./normalize');
const { buildNativeSearchMixDoc, searchIdQuery, firstHitId } = require('./esDocBuilder');
const { NATIVE_INSERT_COLUMNS } = require('./esColumns');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');
const api   = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { storeInNas } = require('../../../insertion/helpers/nasClient');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { isNullLike } = require('../../../insertion/helpers/util');

const TRANSLATION_TIMEOUT_MS = 3000; // cap translation wait at 3s

const ES_INDEX = 'native_search_mix_v2'; // module fallback; per-call below sources db.elastic.indexName

// Perceptual near-duplicate threshold: max Hamming distance between dhashes
// for two ads (same post owner) to be treated as the same creative.
const NEAR_HAM = Number(process.env.NATIVE_NEAR_HAM || 4);

// ── Entry point ────────────────────────────────────────────────────────────────

async function processNativeAd(ad, ctx) {
  const { db, log, network = 'native' } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available.');

  if (!ad.ad_id) {
    return rejected(400, 'Missing ad_id.', { field: 'ad_id', hint: 'Every ad must carry a unique ad_id.' });
  }

  // Native ads (esp. Taboola) frequently surface no advertiser brand, so the crawler sends an
  // empty post_owner. The landing DOMAIN is the advertiser identity in that case — the same model
  // as the historical domain->post_owner backfill — so derive it from the resolved destination
  // (or redirect chain) before validation, instead of shedding a valid, resolvable ad on
  // 'post_owner required' (this was ~80% of native Taboola inserts, 2026-07-04).
  if (isNullLike(ad.post_owner)) {
    const derived = derivePostOwner(ad.destination_url) || derivePostOwner(firstUrl(ad.redirect_url));
    if (derived) ad.post_owner = derived;
  }

  const v = validateNativeAds(ad);
  if (v.code !== 200) return v;

  const versionErr = checkVersion(ad.platform, ad.version);
  if (versionErr) return versionErr;

  const n = normalizeNativeAd(ad);

  // Step 1 — existence check + translation in parallel.
  // Translation is capped at 3s — if the service is slow, we continue without it
  // rather than making the whole insert wait.
  const [existing, translationResult] = await Promise.all([
    repo.getAdByAdId(sql, n.ad_id),
    Promise.race([
      api.translate({
        call_to_action:       '',
        text:                 n.ad_text ?? '',
        title:                n.ad_title ?? '',
        newsfeed_description: n.newsfeed_description ?? '',
      }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false }), TRANSLATION_TIMEOUT_MS)),
    ]),
  ]);

  const translation = translationResult.ok ? translationResult.data : null;

  try {
    if (existing.code === 400) {
      // Perceptual near-duplicate guard: the exact ad_id is new, but a visually
      // identical creative from the same post owner may already exist (re-encoded
      // image / different ad_id). If so, route to the UPDATE path on the match
      // instead of inserting a duplicate.
      let near = { code: 400 };
      try {
        if (n.post_owner && n.phash) near = await repo.getNearHashAd(sql, n.post_owner, n.phash, NEAR_HAM);
      } catch (e) {
        near = { code: 400 };
      }
      if (near.code === 200 && near.data && near.data[0]) {
        return await updatePath(ctx, n, { translation, existingId: near.data[0].id, network });
      }
      return await insertPath(ctx, n, { translation, network });
    }
    return await updatePath(ctx, n, { translation, existingId: existing.data[0].id, network });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('native pipeline error', { error: err.message, ad_id: n.ad_id });
    return serverError(500, 'The ad could not be processed because of a server error.', { error: err.message });
  }
}

// ── INSERT path ────────────────────────────────────────────────────────────────

async function insertPath(ctx, n, { translation, network }) {
  const { db, log } = ctx;
  const sql = db.sql;

  const iso = translation?.detected_language ?? null;
  const domain = extractDomain(n.destination_url);

  // Step 2 — Start image download immediately (parallel with ALL DB work below).
  // External CDN downloads (Taboola/Outbrain) can take 3-7s. By the time the
  // transaction finishes (~300ms), the image is already downloaded — only the
  // fast local NAS upload remains.
  const imageDownloadPromise = (n.type === 'IMAGE' && n.ad_image)
    ? media.downloadToTemp(n.ad_image, 'jpg').catch(() => null)
    : Promise.resolve(null);

  // Step 3 — ALL independent DB lookups run in parallel (while image is downloading).
  const [
    postOwnerRes,
    domainRes,
    countryOnlyRes,
    countryRes,
    networkRes,
    targetSiteRes,
    languageId,
  ] = await Promise.all([
    repo.getPostOwner(sql, String(n.post_owner ?? '').toLowerCase()),
    domain ? repo.getDomain(sql, domain)                        : Promise.resolve({ code: 400, data: null }),
    n.country ? repo.getCountryOnly(sql, n.country)             : Promise.resolve({ code: 400, data: null }),
    n.country ? repo.getCountry(sql, n.city, n.state, n.country): Promise.resolve({ code: 400, data: null }),
    n.network ? repo.getNetwork(sql, n.network)                 : Promise.resolve({ code: 400, data: null }),
    n.target_site ? repo.getTargetSite(sql, n.target_site)      : Promise.resolve({ code: 400, data: null }),
    iso ? repo.getLanguageId(sql, iso)                          : Promise.resolve(0),
  ]);

  // Step 3 — transaction: only INSERTs remain (sequential — single-connection rule)
  const result = await repo.withTransaction(sql, async (tx) => {

    // Post owner
    let postOwnerId;
    if (postOwnerRes.code !== 200) {
      const hasImage = !!(n.post_owner_image);
      postOwnerId = await repo.insertPostOwner(tx, {
        post_owner_name: n.post_owner,
        post_owner_image: hasImage ? n.post_owner_image : '/DefaultImage.jpg',
        ads_count:   1,
        image_updated: hasImage ? 1 : 0,
      });
    } else {
      postOwnerId = postOwnerRes.data[0].id;
      const upd = { ads_count: (postOwnerRes.data[0].ads_count ?? 0) + 1 };
      if (n.post_owner_image) { upd.post_owner_image = n.post_owner_image; upd.image_updated = 1; }
      await repo.updatePostOwner(tx, upd, postOwnerId);
    }

    // Domain
    let domainId = 0;
    if (domain) {
      domainId = domainRes.code === 200 ? domainRes.data[0].id : await repo.insertDomain(tx, domain);
    }

    // Country only
    let countryOnlyId = 0;
    if (n.country) {
      countryOnlyId = countryOnlyRes.code === 200
        ? countryOnlyRes.data[0].id
        : await repo.insertCountryOnly(tx, n.country);
    }

    // Country
    let countryId = 0;
    if (n.country) {
      countryId = countryRes.code === 200
        ? countryRes.data[0].id
        : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });
    }

    // Network
    let networkId = 0;
    if (n.network) {
      networkId = networkRes.code === 200 ? networkRes.data[0].id : await repo.insertNetwork(tx, n.network);
    }

    // Target site
    let targetSiteId = 0;
    if (n.target_site) {
      targetSiteId = targetSiteRes.code === 200 ? targetSiteRes.data[0].id : await repo.insertTargetSite(tx, n.target_site);
    }

    // native_ad main row
    const adRow = {
      ad_id:              n.ad_id,
      language_id:        languageId,
      type:               n.type,
      ad_position:        n.ad_position,
      ad_number_position: n.ad_number_position ?? null,
      post_date:          n.post_date,
      first_seen:         n.first_seen,
      last_seen:          n.last_seen,
      days_running:       1,
      source:             n.source ?? 'desktop',
      domain_id:          domainId,
      country_id:         countryId,
      country_only_id:    countryOnlyId,
      post_owner_id:      postOwnerId,
      network_id:         networkId,
      target_site_id:     targetSiteId,
    };
    if (String(n.platform) === '12' && n.system_id) adRow.system_id = n.system_id;
    if (n.phash) adRow.phash = String(BigInt('0x' + n.phash));

    const nativeAdId = await repo.insertNativeAd(tx, adRow);
    if (!nativeAdId) {
      const e = new Error(`ad_id "${n.ad_id}" already exists.`);
      e.insertionCode = 402; e.insertionHint = 'The ad is already stored.';
      throw e;
    }

    // All remaining child inserts are sequential (single tx connection)
    await repo.insertNativeAdTargetSite(tx, { native_ad_id: nativeAdId, target_site_id: targetSiteId, count: 1, date: n.post_date.slice(0, 10) });
    await repo.insertNativeAdNetwork(tx, { native_ad_id: nativeAdId, network_id: networkId, count: 1 });
    await repo.insertNativePlacementUrl(tx, { native_ad_id: nativeAdId, placement_url: n.placement_url, count: 1 });
    await repo.insertNativeAdVariant(tx, {
      native_ad_id: nativeAdId, title: n.ad_title, text: n.ad_text,
      newsfeed_description: n.newsfeed_description, image_url_original: n.image_url_original ?? null,
    });
    if (countryOnlyId) {
      await repo.insertNativeAdCountry(tx, { native_ad_id: nativeAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
      await repo.insertNativeAdCountryOnly(tx, { native_ad_id: nativeAdId, country_only_id: countryOnlyId, count: 1, ip_address: n.ip_address ?? null });
    }
    await repo.insertNativeAdMetaData(tx, {
      native_ad_id:       nativeAdId,
      platform:           n.platform,
      version:            n.version,
      destination_url:    n.destination_url || null,
      redirect_url:       buildRedirectUrl(n),
      ad_url:             (n.ad_url && String(n.ad_url).trim() !== '') ? n.ad_url : null,
      tracker_url:        (n.tracker_url && String(n.tracker_url).trim() !== '') ? n.tracker_url : null,
      screenshot_url:     '/processing.gif',
      firstSeenOnDesktop: String(n.source).toLowerCase() === 'desktop' ? nowDateTime() : '0001-01-01 01:01:01',
      lastSeenOnDesktop:  String(n.source).toLowerCase() === 'desktop' ? nowDateTime() : '0001-01-01 01:01:01',
    });
    await repo.upsertNativeTranslation(tx, {
      native_ad_id:          nativeAdId,
      ad_text:               translation?.text               ?? n.ad_text              ?? null,
      news_feed_description: translation?.newsfeed_description ?? n.newsfeed_description ?? null,
      ad_title:              translation?.title              ?? n.ad_title             ?? null,
    });

    // Platform 12 user tracking
    if (String(n.platform) === '12' && n.system_id) {
      const uRes = await repo.getNativeAdUser(tx, n.system_id);
      if (uRes.code === 200) {
        await repo.updateNativeAdUserCount(tx, uRes.data[0].id);
      } else {
        await repo.insertNativeAdUser(tx, { system_id: n.system_id, ads_count: 1 });
      }
      await repo.insertNativeAccountActivity(tx, { system_id: n.system_id, native_ad_id: nativeAdId, platform: 12, is_unique: 1 }).catch(() => {});
    }

    return { nativeAdId, postOwnerId, iso };
  });

  // Step 4 — post-commit uploads (fully synchronous, all data saved before response).
  // The image was already downloading during Steps 3+transaction above, so we only
  // pay for whatever download time remains, then do the fast local NAS upload.
  // Post-owner image + ad image upload run in parallel.
  const [, tmpImagePath] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, network).catch(() => null),
    imageDownloadPromise,
  ]);

  let imageVideoUrl = null;
  if (tmpImagePath) {
    try {
      const nasPath = await storeInNas('IMAGE', tmpImagePath, result.nativeAdId, network, `${result.nativeAdId}`);
      imageVideoUrl = (nasPath && !nasPath.includes('DefaultImage')) ? nasPath : null;
      if (imageVideoUrl) {
        await repo.updateNativeAdVariant(sql, { image_url: imageVideoUrl }, result.nativeAdId).catch(() => {});
      }
    } finally {
      try { fs.unlinkSync(tmpImagePath); } catch { /* ignore cleanup error */ }
    }
  }

  // Step 5 — ES index (fire-and-forget: search index only, SQL is source of truth)
  indexAd(ctx, result.nativeAdId, n, { iso: result.iso, imageUrl: imageVideoUrl }).catch((e) => log.warn('ES index failed', { error: e.message }));

  api.adgptInsert({ ad_id: n.ad_id, native_ad_id: result.nativeAdId, type: n.type, platform: n.platform });

  return ok(result.nativeAdId, 'Ad inserted successfully');
}

// ── UPDATE path ────────────────────────────────────────────────────────────────

async function updatePath(ctx, n, { translation, existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const adId = existingId;

  const adRow = await repo.getAdByAdId(sql, n.ad_id);
  const firstSeen = adRow.data?.[0]?.first_seen ?? n.first_seen;
  const daysRunning = computeDaysRunning(firstSeen, n.last_seen);

  // All independent lookups in parallel
  const domain = extractDomain(n.destination_url);
  const [
    ,  // updateNativeAd (fire first, don't need result)
    countryOnlyRes,
    networkRes,
    targetSiteRes,
    placementRes,
  ] = await Promise.all([
    repo.updateNativeAd(sql, { last_seen: n.last_seen, days_running: daysRunning }, adId),
    n.country    ? repo.getCountryOnly(sql, n.country)                 : Promise.resolve({ code: 400, data: null }),
    n.network    ? repo.getNetwork(sql, n.network)                     : Promise.resolve({ code: 400, data: null }),
    n.target_site ? repo.getTargetSite(sql, n.target_site)             : Promise.resolve({ code: 400, data: null }),
    n.placement_url ? repo.getNativePlacementUrl(sql, adId, n.placement_url) : Promise.resolve({ code: 400, data: null }),
  ]);

  // Country upsert
  let countryOnlyId = 0, countryId = 0;
  if (n.country) {
    countryOnlyId = countryOnlyRes.code === 200
      ? countryOnlyRes.data[0].id
      : await repo.insertCountryOnly(sql, n.country);
    const cRes = await repo.getCountry(sql, n.city, n.state, n.country);
    countryId = cRes.code === 200
      ? cRes.data[0].id
      : await repo.insertCountry(sql, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

    const [crRes, coRes] = await Promise.all([
      repo.getNativeAdCountry(sql, adId, countryOnlyId),
      repo.getNativeAdCountryOnly(sql, adId, countryOnlyId),
    ]);
    await Promise.all([
      crRes.code === 200
        ? repo.updateNativeAdCountryCount(sql, crRes.data[0].id)
        : repo.insertNativeAdCountry(sql, { native_ad_id: adId, country_id: countryId, country_only_id: countryOnlyId, count: 1 }),
      coRes.code === 200
        ? repo.updateNativeAdCountryOnlyCount(sql, coRes.data[0].id)
        : repo.insertNativeAdCountryOnly(sql, { native_ad_id: adId, country_only_id: countryOnlyId, count: 1, ip_address: n.ip_address ?? null }),
    ]);
  }

  // Target site upsert
  if (n.target_site) {
    const todayStr = n.post_date.slice(0, 10);
    const targetSiteId = targetSiteRes.code === 200 ? targetSiteRes.data[0].id : await repo.insertTargetSite(sql, n.target_site);
    const tsRes = await repo.getNativeAdTargetSite(sql, adId, targetSiteId);
    if (tsRes.code === 200 && String(tsRes.data[0].date ?? '').slice(0, 10) === todayStr) {
      await repo.updateNativeAdTargetSiteCount(sql, tsRes.data[0].id);
    } else {
      await repo.insertNativeAdTargetSite(sql, { native_ad_id: adId, target_site_id: targetSiteId, count: 1, date: todayStr });
    }
  }

  // Network upsert
  if (n.network) {
    const networkId = networkRes.code === 200 ? networkRes.data[0].id : await repo.insertNetwork(sql, n.network);
    const netRes = await repo.getNativeAdNetwork(sql, adId, networkId);
    if (netRes.code === 200) {
      await repo.updateNativeAdNetworkCount(sql, netRes.data[0].id);
    } else {
      await repo.insertNativeAdNetwork(sql, { native_ad_id: adId, network_id: networkId, count: 1 });
    }
  }

  // Placement URL upsert
  if (n.placement_url) {
    const todayStr = n.post_date.slice(0, 10);
    if (placementRes.code === 200 && String(placementRes.data[0].created_date ?? '').slice(0, 10) === todayStr) {
      await repo.updateNativePlacementUrlCount(sql, placementRes.data[0].id);
    } else {
      await repo.insertNativePlacementUrl(sql, { native_ad_id: adId, placement_url: n.placement_url, count: 1 });
    }
  }

  // Variant + image upload in parallel
  const [, uploadedMedia] = await Promise.all([
    n.newsfeed_description
      ? repo.updateNativeAdVariant(sql, { newsfeed_description: n.newsfeed_description, image_url_original: n.image_url_original ?? null }, adId).catch(() => {})
      : Promise.resolve(),
    n.type === 'IMAGE' && n.ad_image
      ? media.uploadImage(n.ad_image, adId, network).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (uploadedMedia?.image_video_url) {
    await repo.updateNativeAdVariant(sql, { image_url: uploadedMedia.image_video_url }, adId).catch(() => {});
  }

  if (String(n.platform) === '12' && n.system_id) {
    await repo.insertNativeAccountActivity(sql, { system_id: n.system_id, native_ad_id: adId, platform: 12, is_unique: 0 }).catch(() => {});
  }

  // Fetch ES update data in parallel
  const [countries, targetSites, networks, placements] = await Promise.all([
    repo.getAdCountriesList(sql, adId),
    repo.getTargetSitesList(sql, adId),
    repo.getNetworksList(sql, adId),
    repo.getPlacementUrlsList(sql, adId),
  ]);

  if (db.elastic) {
    try {
      const esRes = await db.elastic.search(searchIdQuery(db.elastic.indexName || ES_INDEX, adId));
      const _id = firstHitId(esRes);
      if (_id) {
        const esUpdate = {
          'native_ad.last_seen':                    n.last_seen,
          'native_country_only.country':             countries,
          'target_site.target_site':                 targetSites,
          'networks.network':                        networks,
          'native_placement_url.placement_url':      placements,
          'native_ad_variants.newsfeed_description': n.newsfeed_description,
          'native_ad.platform':                      n.platform,
          image_url_original:                        n.image_url_original ?? null,
          states: n.state ? n.state.split(',').map((s) => s.trim()).filter(Boolean) : [],
          city:   n.city  ? n.city.split(',').map((s) => s.trim()).filter(Boolean)  : [],
        };
        if (uploadedMedia?.image_video_url) {
          esUpdate['native_ad.nas_url'] = uploadedMedia.image_video_url;
          esUpdate['native_ad.aws_url'] = uploadedMedia.image_video_url;
        }
        await db.elastic.update({ index: db.elastic.indexName || ES_INDEX, type: 'doc', id: _id, body: { doc: esUpdate } });
      }
    } catch (e) {
      log.warn('ES update failed', { error: e.message, adId });
    }
  }

  return updated(adId, null);
}

// ── ES index ──────────────────────────────────────────────────────────────────

async function indexAd(ctx, nativeAdId, n, result) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, nativeAdId);
  const row = joined[0];
  if (!row) return;

  const extra = {
    lang_detect:          (result.iso || '').toLowerCase(),
    'native_ad.platform': n.platform,
    states: n.state ? n.state.split(',').map((s) => s.trim()).filter(Boolean) : [],
    city:   n.city  ? n.city.split(',').map((s) => s.trim()).filter(Boolean)  : [],
    image_url_original: n.image_url_original ?? null,
  };
  if (result.imageUrl) { extra['native_ad.nas_url'] = result.imageUrl; extra['native_ad.aws_url'] = result.imageUrl; }
  if (row.post_owner_image) extra['native_ad_post_owners.post_owner_image'] = row.post_owner_image;

  const idx = db.elastic.indexName || ES_INDEX;
  const doc = buildNativeSearchMixDoc(NATIVE_INSERT_COLUMNS, row, { index: idx, extra });

  let _id;
  try { const f = await db.elastic.search(searchIdQuery(idx, nativeAdId)); _id = firstHitId(f); } catch { /* ignore */ }
  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Public-suffix set for the common multi-label TLDs so registrableDomain() doesn't mistake
// e.g. `hkmu.edu.hk` for `edu.hk`. Not a full PSL — it falls back to the last two labels, which
// is correct for the overwhelming majority (.com/.net/.org/…) and good enough to key an advertiser on.
const MULTI_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'com.br', 'com.mx',
  'co.nz', 'co.jp', 'co.in', 'co.za', 'com.hk', 'edu.hk', 'org.hk', 'gov.hk', 'com.cn', 'com.tw',
  'com.sg', 'co.kr', 'com.tr', 'co.il', 'com.ua', 'com.pl',
]);

function registrableDomain(hostname) {
  const parts = String(hostname).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return MULTI_TLDS.has(last2) ? parts.slice(-3).join('.') : last2;
}

// Advertiser-identity fallback: the registrable domain of the ad's landing URL, lowercased.
function derivePostOwner(url) {
  const host = extractDomain(url); // '' on a non-URL / tracker with no host
  return host ? registrableDomain(host).toLowerCase() : '';
}

// First usable URL out of a redirect_url that may be a string, a '||'-joined chain, or an array.
function firstUrl(r) {
  if (!r) return '';
  if (Array.isArray(r)) return r.find(Boolean) || '';
  const s = String(r);
  return s.includes('||') ? (s.split('||').find(Boolean) || '') : s;
}

function buildRedirectUrl(n) {
  if (!n.redirect_url) return null;
  if (String(n.platform) === '3') return n.redirect_url;
  return Array.isArray(n.redirect_url) ? n.redirect_url.join('||') : n.redirect_url;
}

function computeDaysRunning(firstSeen, lastSeen) {
  try {
    const toDate = (s) => new Date(String(s).includes('T') ? s : s.replace(' ', 'T') + 'Z');
    const diff = Math.floor((toDate(lastSeen) - toDate(firstSeen)) / 86400000);
    return diff > 1 ? diff + 1 : 1;
  } catch { return 1; }
}

module.exports = { processNativeAd };
