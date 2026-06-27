'use strict';

/**
 * GTEXT (Google Text) gtAdsData pipeline — port of GoogleTextAdController::
 * insertAdsFromPluginO → insertNewGoogleTextAdsO → (processAdO | updateAdsDataO).
 * See ../../../../KT-GTEXT-MIGRATION.md.
 *
 * processMetaAd(ad, ctx) handles ONE ad → { code, message, data? }.
 * ctx = { db:{sql,elastic}, log, network:'google' }. Shared InsertionEngine batches.
 *
 * Faithful-but-fixed (MANIFEST §0.5): all INSERT writes in one transaction; image named
 * by the internal google_text_ad.id (post-commit, like GDN); ES doc is FLAT into google_ads_data.
 *
 * NOTE: peripheral analytics side-tables (keyword_domain / keyword_advertiser /
 * google_keyword_audit / domain-screenshot / platform hit-counts) are intentionally
 * omitted — they are not part of the ad document. See KT §6.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../config');
const repo = require('./repository');
const { validateMetaAds } = require('./validate');
const { normalizeGtextAd, checkGates } = require('./normalize');
const { buildDoc, searchIdQuery, firstHitId, firstHitSource, keywordArray, ES_INDEX } = require('./esDocBuilder');
const { META_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { storeInNas } = require('../../../insertion/helpers/nasClient');
const { nowDateTime, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const DEFAULT_AD_IMAGE = '/bydefault_ads.jpg';

async function processMetaAd(ad, ctx) {
  const { db, log } = ctx;
  const network = ctx.network || 'google';
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', { field: 'ad_id', hint: 'Add the platform ad_id and resend.' });
  }

  // entry gates (gif / version)
  const gate = checkGates(ad);
  if (gate) return { code: 400, status: 'rejected', message: gate.message, error: gate.error };

  // validation
  const v = validateMetaAds(ad);
  if (v.code !== 200) return v;

  // existence + translation in parallel
  const [existing, translation] = await Promise.all([
    repo.getAdByAdId(sql, ad.ad_id),
    api.translate({ call_to_action: '', text: ad.ad_text ?? '', title: ad.ad_title ?? '', newsfeed_description: ad.newsfeed_description ?? '' }),
  ]);
  const translationData = translation.ok ? translation.data : null;

  try {
    if (existing.code === 400) {
      return await insertPath(ctx, ad, { translation: translationData, network });
    }
    return await updatePath(ctx, ad, { translation: translationData, existingId: existing.data[0].id, network });
  } catch (err) {
    log.error('gtext metaAds pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── INSERT (processAdO) ───────────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { translation, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeGtextAd(rawAd);

  const postOwnerLower = String(n.post_owner ?? '').toLowerCase();
  const domain = extractDomain(n.destination_url);
  const now = nowDateTime();
  const source = String(n.source ?? 'desktop').toLowerCase();

  const result = await repo.withTransaction(sql, async (tx) => {
    // post owner (dedup by generated post_owner_lower)
    let postOwnerId;
    const po = await repo.getPostOwner(tx, postOwnerLower);
    if (po.code === 200) {
      postOwnerId = po.data[0].id;
      await repo.updatePostOwner(tx, { ads_count: toInt(po.data[0].ads_count) + 1 }, postOwnerId);
    } else {
      postOwnerId = await repo.insertPostOwner(tx, { post_owner_name: n.post_owner, ads_count: 1, post_owner_image: '/DefaultImage.jpg' });
    }

    // domain
    let domainId = null;
    let domainRow = null;
    if (domain && domain.trim() !== '') {
      const d = await repo.getDomain(tx, domain);
      if (d.code === 200) { domainId = d.data[0].id; domainRow = d.data[0]; }
      else domainId = await repo.insertDomain(tx, domain);
    }

    // country_only + country
    let countryOnlyId = null;
    const co = await repo.getCountryOnly(tx, n.country);
    countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(tx, n.country);
    let countryId = null;
    const c = await repo.getCountry(tx, { city: n.city, state: n.state, country: n.country });
    countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

    // google_text_ad (default_variant_id back-filled after variant)
    const adRow = buildGtextAdRow(n, { domainId, countryId, countryOnlyId, postOwnerId, now, source });
    const googleTextAdId = await repo.insertGoogleTextAd(tx, adRow);
    if (!googleTextAdId) throw new Error(`Failed to insert google_text_ad for ad_id ${n.ad_id}`);

    // variant (image_url set after commit) + back-ref default_variant_id
    const variantId = await repo.insertVariant(tx, {
      google_text_ad_id: googleTextAdId,
      title: n.ad_title, text: n.ad_text, newsfeed_description: n.newsfeed_description,
      image_url_original: n.ad_image ?? null, image_url: null,
      target_keyword: n.target_keyword, target_page: n.target_page ?? null,
    });
    await repo.updateGoogleTextAd(tx, { default_variant_id: variantId }, googleTextAdId);

    // ad_countries / _only
    const gac = await repo.getAdCountry(tx, googleTextAdId, countryOnlyId);
    if (gac.code !== 200) await repo.insertAdCountry(tx, { google_text_ad_id: googleTextAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
    const gaco = await repo.getAdCountryOnly(tx, googleTextAdId, countryOnlyId);
    if (gaco.code !== 200) await repo.insertAdCountryOnly(tx, { google_text_ad_id: googleTextAdId, country_only_id: countryOnlyId, count: 1 });

    // meta_data
    await repo.insertMetaData(tx, buildMetaRow(n, googleTextAdId, now, source));

    // translation
    await repo.upsertTranslation(tx, {
      google_ad_id: googleTextAdId,
      ad_text: translation?.text ?? null, ad_title: translation?.title ?? null, news_feed_description: translation?.newsfeed_description ?? null,
    });

    // platform 10 (system) → gtext_ad_users
    if (String(n.platform) === '10' && n.system_id) {
      const gu = await repo.getGtextUser(tx, n.system_id);
      if (gu.code === 200) await repo.bumpGtextUserCount(tx, gu.data[0].id);
      else await repo.insertGtextUser(tx, { system_id: n.system_id, ads_count: 1 });
    }

    return { googleTextAdId, variantId, postOwnerId, domainId, domainRow };
  });

  // image upload AFTER commit, named by internal id (IMAGE only); persist on the variant
  let imageUrl = null;
  if (n.type === 'IMAGE' && n.ad_image) {
    imageUrl = await uploadGtextImage(n.ad_image, result.googleTextAdId, network);
    if (imageUrl && imageUrl !== DEFAULT_AD_IMAGE) {
      await repo.updateVariantByAdId(sql, { image_url: imageUrl }, result.googleTextAdId).catch(() => {});
    }
  }

  // platform 10 → account activity (is_unique = 1 for new)
  if (String(n.platform) === '10' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, google_ad_id: result.googleTextAdId, platform: 10, is_unique: 1 }).catch(() => {});
  }

  // ES index (flat doc into google_ads_data)
  await indexAd(ctx, result, n, { translation, imageUrl, source }).catch((e) => log.warn('gtext ES index failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, result, imageUrl));

  const warning = (n.type === 'IMAGE' && (!imageUrl || String(imageUrl).includes('Default'))) ? 'Image storage issue: the ad was saved, but its image could not be stored.' : null;
  return ok(result.googleTextAdId, `Ad inserted successfully${n.target_keyword ? ` for keyword ${n.target_keyword}` : ''}`, warning ? { warning } : {});
}

// ── UPDATE (updateAdsDataO) ───────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { translation, existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeGtextAd(rawAd);

  const joined = await repo.getJoinedAd(sql, n.ad_id);
  const cur = joined[0] || { id: existingId };
  const googleTextAdId = cur.id || existingId;

  // last_seen / days_running
  const lastSeen = nowDateTime();
  const daysRunning = computeDaysRunning(cur.first_seen, lastSeen);
  await repo.updateGoogleTextAd(sql, { last_seen: lastSeen, days_running: daysRunning }, googleTextAdId);

  // country_only + country + ad_countries/_only (bump-or-insert)
  let countryOnlyId = null;
  const co = await repo.getCountryOnly(sql, n.country);
  countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(sql, n.country);
  let countryId = null;
  const c = await repo.getCountry(sql, { city: n.city, state: n.state, country: n.country });
  countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(sql, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });
  const gac = await repo.getAdCountry(sql, googleTextAdId, countryOnlyId);
  if (gac.code === 200) {
    await repo.bumpAdCountryCount(sql, gac.data[0].id);
    const gaco = await repo.getAdCountryOnly(sql, googleTextAdId, countryOnlyId);
    if (gaco.code === 200) await repo.bumpAdCountryOnlyCount(sql, gaco.data[0].id);
  } else {
    await repo.insertAdCountry(sql, { google_text_ad_id: googleTextAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
    await repo.insertAdCountryOnly(sql, { google_text_ad_id: googleTextAdId, country_only_id: countryOnlyId, count: 1 });
  }

  // domain registered date (for ES)
  const domInfo = cur.domain_id ? await repo.getDomainRegisteredDate(sql, cur.domain_id) : null;

  // target_keyword merge in variant (append |keyword if new)
  let mergedKeywords = null;
  if (n.target_keyword) {
    const existingKw = String(cur.target_keyword || '');
    const list = existingKw ? existingKw.toLowerCase().split('|').map((x) => x.trim()).filter(Boolean) : [];
    if (!list.includes(String(n.target_keyword).toLowerCase())) {
      const newVal = [existingKw, n.target_keyword].filter((x) => x && String(x).trim()).join('|').replace(/^\|+|\|+$/g, '');
      await repo.updateVariantByAdId(sql, { target_keyword: newVal }, googleTextAdId).catch(() => {});
      mergedKeywords = newVal.toLowerCase().split('|').map((x) => x.trim()).filter(Boolean);
    }
  }

  // translation upsert
  await repo.upsertTranslation(sql, {
    google_ad_id: googleTextAdId,
    ad_text: translation?.text ?? null, ad_title: translation?.title ?? null, news_feed_description: translation?.newsfeed_description ?? null,
  });

  // platform 10 → account activity (is_unique = 0 for existing)
  if (String(n.platform) === '10' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, google_ad_id: googleTextAdId, platform: 10, is_unique: 0 }).catch(() => {});
  }

  // ES update (flat doc; carry over fields from existing _source)
  await updateEsDoc(ctx, googleTextAdId, n, { translation, cur, domInfo, mergedKeywords, lastSeen, daysRunning, network })
    .catch((e) => log.warn('gtext ES update failed', { error: e.message }));

  return updated(googleTextAdId);
}

// ── ES index (INSERT) — build flat doc in-memory ──────────────────────────────
async function indexAd(ctx, result, n, { translation, imageUrl, source }) {
  const { db } = ctx;
  if (!db.elastic) return;
  // Live index from the configured client (cutover = config change); ES_INDEX is the fallback.
  const esIndex = db.elastic.indexName || ES_INDEX;
  const data = buildFlatInsertData(n, result, { translation, imageUrl, source });
  const doc = buildDoc(META_INSERT_COLUMNS, data, {
    extra: {
      image_url_original: n.ad_image ?? null,
      post_owner_image: data.post_owner_image ?? null,
      new_nas_image_url: imageUrl ?? null,
      image_video_url: imageUrl ?? null,
    },
  });
  // de-dup: reuse an existing _id if a doc already exists for this id; otherwise pin
  // the ES _id to the internal google_text_ad.id so a re-index OVERWRITES instead of
  // creating a second auto-_id doc (the ~8.6M-duplicate cause). A brand-new id can't
  // already exist in ES, so this is collision-free.
  let _id;
  try { _id = firstHitId(await db.elastic.search(searchIdQuery(esIndex, result.googleTextAdId))); } catch { /* ignore */ }
  await db.elastic.index({ index: esIndex, type: doc.type, id: _id || String(result.googleTextAdId), body: doc.body });
}

// ── ES update (UPDATE) — partial doc, carrying over existing _source fields ────
async function updateEsDoc(ctx, googleTextAdId, n, { translation, cur, domInfo, mergedKeywords, lastSeen, daysRunning, network }) {
  const { db } = ctx;
  if (!db.elastic) return;
  const esIndex = db.elastic.indexName || ES_INDEX;
  const found = await db.elastic.search(searchIdQuery(esIndex, googleTextAdId));
  const _id = firstHitId(found);
  const src = firstHitSource(found) || {};

  // NAS image backfill for IMAGE when missing
  let newNas = src.new_nas_image_url;
  if (n.type === 'IMAGE' && (!newNas || newNas === '')) {
    const up = await uploadGtextImage(n.ad_image, googleTextAdId, network);
    newNas = up && !String(up).includes('Default') ? up : (src.new_nas_image_url || null);
  }

  const doc = {
    id: googleTextAdId,
    last_seen: lastSeen,
    days_running: daysRunning,
    domain_registered_date: domInfo ? coerceDate(domInfo.domain_registered_date) : src.domain_registered_date ?? null,
    domain: domInfo ? domInfo.domain : src.domain ?? null,
    target_keyword: mergedKeywords ?? src.target_keyword ?? keywordArray(n.target_keyword),
    title: n.ad_title ?? null, text: n.ad_text ?? null, newsfeed_description: n.newsfeed_description ?? null,
    ad_text: translation?.text ?? src.ad_text ?? null,
    ad_title: translation?.title ?? src.ad_title ?? null,
    news_feed_description: translation?.newsfeed_description ?? src.news_feed_description ?? null,
    country: n.country ?? null, state: n.state ?? null, city: n.city ?? null,
    image_url_original: n.ad_image ?? src.image_url_original ?? null,
    platform: toInt(n.platform),
  };
  if (newNas) { doc.new_nas_image_url = newNas; doc.image_video_url = newNas; }

  if (_id) {
    await db.elastic.update({ index: esIndex, type: 'doc', id: _id, body: { doc } });
  } else {
    // No existing doc → index a fresh flat doc (recovery; SQL already updated). Pin
    // the ES _id to the internal id so a transient search miss can't spawn a second
    // auto-_id doc → no new duplicates.
    const full = buildDoc(META_INSERT_COLUMNS, { ...src, ...doc }, { extra: { new_nas_image_url: newNas ?? null, image_video_url: newNas ?? null } });
    await db.elastic.index({ index: esIndex, type: full.type, id: String(googleTextAdId), body: full.body });
  }
}

// ── building blocks ───────────────────────────────────────────────────────────
function buildGtextAdRow(n, ids) {
  const row = {
    ad_id: n.ad_id, language_id: 0, post_owner_updated: 0, variants_count: 0,
    type: n.type, ad_position: n.ad_position, ad_sub_position: n.ad_sub_position ?? null,
    ad_number_position: n.ad_number_position ?? null,
    post_date: n.post_date || ids.now, first_seen: n.first_seen || ids.now, last_seen: ids.now,
    days_running: 1, status: 1, source: n.source || 'desktop',
    affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    domain_id: ids.domainId ?? null, country_id: ids.countryId ?? null, country_only_id: ids.countryOnlyId ?? null,
    post_owner_id: ids.postOwnerId ?? null, default_variant_id: 0, ad_ranking: n.ad_ranking ?? '',
  };
  if (String(n.platform) === '10' && n.system_id) row.system_id = n.system_id;
  return row;
}

function buildMetaRow(n, googleTextAdId, now, source) {
  const sentinel = '0001-01-01 01:01:01';
  return {
    google_text_ad_id: googleTextAdId,
    firstSeenOnDesktop: source === 'desktop' || !n.source ? now : sentinel,
    lastSeenOnDesktop: source === 'desktop' || !n.source ? now : sentinel,
    firstSeenOnIos: source === 'ios' ? now : sentinel, lastSeenOnIos: source === 'ios' ? now : sentinel,
    firstSeenOnAndroid: source === 'android' ? now : sentinel, lastSeenOnAndroid: source === 'android' ? now : sentinel,
    platform: toInt(n.platform), version: n.version ?? null,
    destination_url: (n.destination_url && String(n.destination_url).trim() !== '') ? n.destination_url : null,
    g_temp_url: (n.g_temp_url && String(n.g_temp_url).trim() !== '') ? n.g_temp_url : null,
    screenshot_url: '/processing.gif',
  };
}

/** The flat $gtss equivalent used to build the ES doc on INSERT. */
function buildFlatInsertData(n, result, { translation, imageUrl, source }) {
  const now = nowDateTime();
  return {
    id: result.googleTextAdId, ad_id: n.ad_id, post_date: n.post_date || now, status: 1,
    first_seen: n.first_seen || now, last_seen: now, source: n.source ?? null, days_running: 1,
    ad_ranking: n.ad_ranking ?? null, ad_position: n.ad_position ?? null, ad_sub_position: n.ad_sub_position ?? null,
    type: n.type ?? null,
    domain_registered_date: result.domainRow ? result.domainRow.domain_registered_date : null,
    domain: result.domainRow ? result.domainRow.domain : extractDomain(n.destination_url),
    title: n.ad_title ?? null, text: n.ad_text ?? null, newsfeed_description: n.newsfeed_description ?? null,
    target_keyword: n.target_keyword ?? null, target_page: n.target_page ?? null,
    image_url: imageUrl ?? null, url: n.destination_url ?? null,
    post_owner_name: n.post_owner ?? null, post_owner_image: '/DefaultImage.jpg',
    post_owner_lower: String(n.post_owner ?? '').toLowerCase(),
    destination_url: n.destination_url ?? null,
    firstSeenOnDesktop: source === 'desktop' || !n.source ? now : null,
    firstSeenOnAndroid: source === 'android' ? now : null,
    firstSeenOnIos: source === 'ios' ? now : null,
    platform: toInt(n.platform), version: n.version ?? null,
    g_temp_url: (n.g_temp_url && String(n.g_temp_url).trim() !== '') ? n.g_temp_url : null,
    screenshot_url: '/processing.gif',
    ad_text: translation?.text ?? null, news_feed_description: translation?.newsfeed_description ?? null, ad_title: translation?.title ?? null,
    redirect_url: null, source_url: null, country: n.country ?? null, state: n.state ?? null, city: n.city ?? null,
    image_url_original: n.ad_image ?? null,
  };
}

/** Upload the gtext ad image to NAS (URL or base64). Returns NAS path or default. */
async function uploadGtextImage(adImage, adId, network) {
  if (!adImage || typeof adImage !== 'string') return DEFAULT_AD_IMAGE;
  if (/^https?:\/\//i.test(adImage)) {
    const up = await media.uploadImage(adImage, adId, network).catch(() => null);
    const p = up && up.nas_path;
    return p && !String(p).includes('DefaultImage') ? p : DEFAULT_AD_IMAGE;
  }
  let b64 = adImage;
  const marker = b64.indexOf('base64,');
  if (marker !== -1) b64 = b64.slice(marker + 7);
  let buf; try { buf = Buffer.from(b64, 'base64'); } catch { return DEFAULT_AD_IMAGE; }
  if (!buf || buf.length === 0) return DEFAULT_AD_IMAGE;
  const tmp = path.join(os.tmpdir(), `gt_${adId}_${process.hrtime.bigint()}.jpg`);
  try {
    fs.writeFileSync(tmp, buf);
    const p = await storeInNas('IMAGE', tmp, adId, network, `${adId}`);
    return p && !String(p).includes('DefaultImage') ? p : DEFAULT_AD_IMAGE;
  } catch { return DEFAULT_AD_IMAGE; }
  finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

// ── small helpers ─────────────────────────────────────────────────────────────
function extractDomain(url) {
  if (!url) return '';
  try { const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`); return (u.hostname || '').replace(/^www\./i, ''); }
  catch { return String(url); }
}
function computeDaysRunning(firstSeen, lastSeen) {
  const p = toEpochSeconds(firstSeen); const l = toEpochSeconds(lastSeen);
  if (!p || !l || l < p) return 1;
  const diffDays = Math.floor((l - p) / 86400);
  return diffDays > 1 ? diffDays + 1 : 1;
}
function toEpochSeconds(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : v;
  const s = String(v);
  if (/^\d+$/.test(s)) { const nn = parseInt(s, 10); return nn > 1e11 ? Math.floor(nn / 1000) : nn; }
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
function coerceDate(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
function buildAdgptPayload(n, result, imageUrl) {
  return { ad_id: result.googleTextAdId, network: 'google', type: n.type, platform: toInt(n.platform), target_keyword: n.target_keyword, [`ad-${String(n.type || '').toLowerCase()}`]: imageUrl ?? null };
}

module.exports = { processMetaAd };
