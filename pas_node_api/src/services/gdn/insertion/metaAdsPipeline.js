'use strict';

/**
 * GDN metaAdsData pipeline — port of GdnAdController::insertAds() →
 * insertNewGdnAds() → (processAd | updateAdsData).
 * See ../../../../PHP-SPEC-gdn.md §2–4 for the authoritative behaviour.
 *
 * processMetaAd(ad, ctx) handles ONE ad and returns { code, message, data? }.
 * ctx = { db:{sql,elastic}, log, network }. The shared InsertionEngine batches/parallelizes.
 *
 * Faithful-but-fixed (MANIFEST §0.5):
 *   - all INSERT DB writes happen inside ONE transaction (PHP committed mid-way);
 *   - translation title/desc/text are mapped correctly (PHP UPDATE path cross-wired them);
 *   - the UPDATE path re-indexes a fresh ES doc when none exists instead of returning a
 *     misleading 400 after the SQL update already succeeded.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../config');
const repo = require('./repository');
const { validateMetaAds } = require('./validate');
const { normalizeGdnAd, checkVersion } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery, firstHitId, firstHitSource } = require('./esDocBuilder');
const { META_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { storeInNas, DEFAULT_IMAGE } = require('../../../insertion/helpers/nasClient');
const { nowDateTime, today, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const ES_INDEX = 'gdn_search_mix';
const DEFAULT_AD_IMAGE = '/bydefault_ads.jpg';
// Near-duplicate guard: a new creative whose perceptual hash (dhash, stored in gdn_ad.phash) is within
// NEAR_HAM bits of one this SAME advertiser already has is a render/animation variant of the same ad ->
// update it instead of inserting a dupe. ad_id stays the exact (SHA-256) identity; phash catches re-renders.
const NEAR_HAM = Number(process.env.GDN_NEAR_HAM || 4);

async function processMetaAd(ad, ctx) {
  const { db, log } = ctx;
  const network = ctx.network || 'gdn';
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  // ad_id guard
  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', {
      field: 'ad_id', hint: 'Add the platform ad_id to the payload and resend.',
    });
  }

  // version gate
  const versionErr = checkVersion(ad.platform, ad.version);
  if (versionErr) return { code: 400, status: 'rejected', message: versionErr.message, error: versionErr.error };

  // validation
  const v = validateMetaAds(ad);
  if (v.code !== 200) return v;

  // existence + translation in parallel (translation is best-effort for GDN)
  const [existing, translation] = await Promise.all([
    repo.getAdByAdId(sql, ad.ad_id),
    api.translate({
      call_to_action: ad.call_to_action ?? '',
      text: ad.ad_text ?? '',
      title: ad.ad_title ?? '',
      newsfeed_description: ad.newsfeed_description ?? '',
    }),
  ]);
  const translationData = translation.ok ? translation.data : null;

  try {
    if (existing.code === 400) {
      // exact ad_id (SHA-256) is new -> check for a perceptual near-variant from the SAME advertiser
      // (a re-render the exact-hash dedup misses: same ad, dhash within NEAR_HAM bits). Found -> update it.
      let near = { code: 400 };
      try {
        if (ad.post_owner && ad.phash) near = await repo.getNearHashAd(sql, ad.post_owner, ad.phash, NEAR_HAM);
      } catch (e) { near = { code: 400 }; }   // never block an insert on the dedup probe
      if (near.code === 200 && near.data && near.data[0]) {
        return await updatePath(ctx, ad, { translation: translationData, existingId: near.data[0].id, network });
      }
      return await insertPath(ctx, ad, { translation: translationData, network });
    }
    return await updatePath(ctx, ad, { translation: translationData, existingId: existing.data[0].id, network });
  } catch (err) {
    log.error('gdn metaAds pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── INSERT path (processAd) ─────────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { translation, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeGdnAd(rawAd);

  // language detect (skipped in dev, like PHP APP_ENV check)
  let languageId = 0;
  let iso = null;
  if (!config.isDev && translation?.detected_language) {
    iso = String(translation.detected_language).slice(0, 2);
    languageId = (await repo.getLanguageId(sql, iso)) || 0;
  }

  // Media is uploaded AFTER the insert (named by the internal gdn_ad.id, like Facebook),
  // so the variant goes in with a placeholder and is updated post-commit (see below).
  const postOwnerLower = String(n.post_owner ?? '').toLowerCase();
  const domain = extractDomain(n.destination_url);

  const result = await repo.withTransaction(sql, async (tx) => {
    // target_site (get-or-insert)
    let targetSiteId;
    const ts = await repo.getTargetSite(tx, n.target_site);
    targetSiteId = ts.code === 200 ? ts.data[0].id : await repo.insertTargetSite(tx, n.target_site);

    // domain (insert if new + non-empty)
    let domainId = null;
    if (domain && domain.trim() !== '') {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    // country_only + country
    let countryOnlyId = null;
    const co = await repo.getCountryOnly(tx, n.country);
    countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(tx, n.country);

    let countryId = null;
    const c = await repo.getCountry(tx, { city: n.city, state: n.state, country: n.country });
    countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

    // post owner (lookup by post_owner_name = lower(post_owner); bump or insert)
    let postOwnerId;
    const po = await repo.getPostOwner(tx, postOwnerLower);
    if (po.code === 200) {
      postOwnerId = po.data[0].id;
      await repo.updatePostOwner(tx, { ads_count: toInt(po.data[0].ads_count) + 1 }, postOwnerId);
    } else {
      postOwnerId = await repo.insertPostOwner(tx, { post_owner_name: n.post_owner, ads_count: 1, post_owner_image: '/DefaultImage.jpg' });
    }

    // gdn_ad
    const adRow = buildGdnAdRow(n, { domainId, countryId, countryOnlyId, postOwnerId, languageId, targetSiteId });
    const gdnAdId = await repo.insertGdnAd(tx, adRow);
    if (!gdnAdId) throw new Error(`Failed to insert gdn_ad for ad_id ${n.ad_id}`);

    // gdn_ad_target_site
    await repo.insertAdTargetSite(tx, { gdn_ad_id: gdnAdId, target_site_id: targetSiteId, count: 1, date: today() });

    // platform 12 (gtext) — gdn_ad_users bookkeeping
    if (String(n.platform) === '12' && n.system_id) {
      const gu = await repo.getGtextUser(tx, n.system_id);
      if (gu.code === 200) await repo.bumpGtextUserCount(tx, gu.data[0].id);
      else await repo.insertGtextUser(tx, { system_id: n.system_id, ads_count: 1 });
    }

    // gdn_placement_url
    await repo.insertPlacementUrl(tx, { gdn_ad_id: gdnAdId, placement_url: n.placement_url, count: 1 });

    // gdn_ad_variants
    const variantId = await repo.insertVariant(tx, {
      gdn_ad_id: gdnAdId,
      title: n.ad_title, text: n.ad_text, newsfeed_description: n.newsfeed_description,
      image_url_original: n.image_url_original ?? null, ad_image_size: n.ad_image_size ?? null,
      image_url: DEFAULT_AD_IMAGE, // real NAS path (named by internal gdn_ad.id) is set after commit
    });

    // gdn_ad_countries (insert if absent)
    const gac = await repo.getAdCountry(tx, gdnAdId, countryOnlyId);
    if (gac.code !== 200) await repo.insertAdCountry(tx, { gdn_ad_id: gdnAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });

    // gdn_ad_countries_only (insert if absent)
    const gaco = await repo.getAdCountryOnly(tx, gdnAdId, countryOnlyId);
    if (gaco.code !== 200) await repo.insertAdCountryOnly(tx, { gdn_ad_id: gdnAdId, country_only_id: countryOnlyId, count: 1, ip_address: n.ip_address });

    // gdn_ad_meta_data
    await repo.insertMetaData(tx, buildMetaRow(n, gdnAdId));

    // gdn_ad_url (destination)
    if (n.destination_url) {
      await repo.insertAdUrl(tx, { gdn_ad_id: gdnAdId, url_type: 'D', url: n.destination_url });
    }

    // gdn_ad_translation (correct mapping — fixes PHP UPDATE-path cross-wire).
    // Coalesce to the ORIGINAL text when translation is unavailable: gdn_ad_translation columns are
    // NOT NULL, so a null translation (translate best-effort fails) would 500 + roll back the whole ad.
    await repo.upsertTranslation(tx, {
      gdn_ad_id: gdnAdId,
      ad_text: translation?.text ?? n.ad_text ?? '',
      ad_title: translation?.title ?? n.ad_title ?? '',
      news_feed_description: translation?.newsfeed_description ?? n.newsfeed_description ?? '',
    });

    return { gdnAdId, variantId, postOwnerId };
  });

  // Media upload AFTER commit (off the transaction), named by the internal gdn_ad.id —
  // matches Facebook and what the search/read side expects. Then persist it on the variant.
  const imageUrl = await uploadGdnImage(n.ad_image, result.gdnAdId, network);
  if (imageUrl && imageUrl !== DEFAULT_AD_IMAGE) {
    await repo.updateVariantByAdId(sql, { image_url: imageUrl }, result.gdnAdId).catch(() => {});
  }

  // platform 12 → account activity (is_unique = 1 for a new ad), best-effort after commit
  if (String(n.platform) === '12' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, gdn_ad_id: result.gdnAdId, platform: 12, is_unique: 1 }).catch(() => {});
  }

  // ES index (non-transactional)
  await indexAd(ctx, result.gdnAdId, n, { iso, imageUrl }, network)
    .catch((e) => log.warn('gdn ES index failed', { error: e.message }));

  const warning = (!imageUrl || String(imageUrl).includes('Default')) ? 'Image storage issue: the ad was saved, but its image could not be stored.' : null;
  return ok(result.gdnAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE path (updateAdsData) ─────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { translation, existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeGdnAd(rawAd);
  const gdnAdId = existingId;

  const joined = await repo.getJoinedAd(sql, 'gdn_ad.id', gdnAdId);
  const cur = joined[0] || {};

  // refresh variant original image url
  if (n.image_url_original) {
    await repo.updateVariantByAdId(sql, { image_url_original: n.image_url_original }, gdnAdId).catch(() => {});
  }

  // last_seen / days_running
  const lastSeen = nowDateTime();
  const daysRunning = computeDaysRunning(cur.first_seen, lastSeen);
  await repo.updateGdnAd(sql, { last_seen: lastSeen, days_running: daysRunning }, gdnAdId);

  // country_only + country
  let countryOnlyId = null;
  const co = await repo.getCountryOnly(sql, n.country);
  countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(sql, n.country);
  let countryId = null;
  const c = await repo.getCountry(sql, { city: n.city, state: n.state, country: n.country });
  countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(sql, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

  // gdn_ad_countries / _only: bump if pair exists, else insert
  const gac = await repo.getAdCountry(sql, gdnAdId, countryOnlyId);
  if (gac.code === 200) {
    await repo.bumpAdCountryCount(sql, gac.data[0].id);
    const gaco = await repo.getAdCountryOnly(sql, gdnAdId, countryOnlyId);
    if (gaco.code === 200) await repo.bumpAdCountryOnlyCount(sql, gaco.data[0].id);
  } else {
    await repo.insertAdCountry(sql, { gdn_ad_id: gdnAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
    await repo.insertAdCountryOnly(sql, { gdn_ad_id: gdnAdId, country_only_id: countryOnlyId, count: 1, ip_address: n.ip_address });
  }

  // target_site (get-or-insert) + one gdn_ad_target_site row per day
  let targetSiteId;
  const ts = await repo.getTargetSite(sql, n.target_site);
  targetSiteId = ts.code === 200 ? ts.data[0].id : await repo.insertTargetSite(sql, n.target_site);
  const atsDay = await repo.getAdTargetSiteForDay(sql, gdnAdId, targetSiteId, today());
  if (atsDay.code !== 200) await repo.insertAdTargetSite(sql, { gdn_ad_id: gdnAdId, target_site_id: targetSiteId, count: 1, date: today() });

  // one gdn_placement_url row per day
  const puDay = await repo.getPlacementForDay(sql, gdnAdId, n.placement_url, today());
  if (puDay.code !== 200) await repo.insertPlacementUrl(sql, { gdn_ad_id: gdnAdId, placement_url: n.placement_url, count: 1 });

  // platform 12 → account activity (is_unique = 0 for an existing ad)
  if (String(n.platform) === '12' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, gdn_ad_id: gdnAdId, platform: 12, is_unique: 0 }).catch(() => {});
  }

  // ── ES update ──
  await updateEsDoc(ctx, gdnAdId, n, { translation, cur, network }).catch((e) => log.warn('gdn ES update failed', { error: e.message }));

  return updated(gdnAdId);
}

// ── ES indexing (INSERT) ────────────────────────────────────────────────────────
async function indexAd(ctx, gdnAdId, n, { iso, imageUrl }, network) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'gdn_ad.id', gdnAdId);
  const row = joined[0];
  if (!row) return;

  const doc = buildSearchMixDoc(META_INSERT_COLUMNS, row, { index: ES_INDEX, extra: buildEsExtra(n, { iso, imageUrl }) });

  // de-dup: reuse an existing _id if a doc already exists for this ad
  let _id;
  try { _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, gdnAdId))); } catch { /* ignore */ }
  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

// ── ES update (UPDATE path) ─────────────────────────────────────────────────────
async function updateEsDoc(ctx, gdnAdId, n, { translation, cur, network }) {
  const { db } = ctx;
  if (!db.elastic) return;

  const found = await db.elastic.search(searchIdQuery(ES_INDEX, gdnAdId));
  const _id = firstHitId(found);
  const src = firstHitSource(found);

  // merge-able aggregate fields from SQL
  const targetSites = await repo.getTargetSitesCsv(db.sql, gdnAdId);
  const domainRegDate = cur.domain_id ? await repo.getDomainRegisteredDate(db.sql, cur.domain_id) : null;
  const daysRunning = computeDaysRunning(cur.first_seen, nowDateTime());

  // NAS image: backfill if the doc has none
  let newNas = src && src['new_nas_image_url'];
  if (!newNas) {
    const up = await uploadGdnImage(n.ad_image, gdnAdId, network);
    newNas = up && !String(up).includes('Default') ? up : (src ? src['new_nas_image_url'] : null);
  }

  // placement union (existing ES + new)
  const existingPlacement = toArray(src && src['gdn_placement_url.placement_url']);
  const placement = uniq([...existingPlacement, n.placement_url]);

  // country / states / city union (existing ES + payload, split on ',')
  const country = uniq([...toArray(src && src['gdn_country_only.country']), ...splitCsv(n.country)]);
  const states = uniq([...toArray(src && src['states']), ...splitCsv(n.state)]);
  const city = uniq([...toArray(src && src['city']), ...splitCsv(n.city)]);

  const docFields = {
    'gdn_target_site.target_site': targetSites,
    'gdn_placement_url.placement_url': placement,
    'gdn_ad_domains.domain_registered_date': domainRegDate,
    'gdn_ad_translation.ad_text': translation?.text ?? (src ? src['gdn_ad_translation.ad_text'] : null),
    'gdn_ad_translation.ad_title': translation?.title ?? (src ? src['gdn_ad_translation.ad_title'] : null),
    'gdn_ad_translation.news_feed_description': translation?.newsfeed_description ?? (src ? src['gdn_ad_translation.news_feed_description'] : null),
    'gdn_ad.last_seen': nowDateTime(),
    'gdn_ad.days_running': daysRunning,
    'gdn_country_only.country': country,
    states,
    city,
    image_url_original: n.image_url_original ?? (src ? src['image_url_original'] : null),
    platform: toInt(n.platform),
    new_nas_image_url: newNas ?? null,
  };

  if (_id) {
    await db.elastic.update({ index: ES_INDEX, type: 'doc', id: _id, body: { doc: docFields } });
  } else {
    // No existing doc (SQL update already succeeded) → index a fresh, complete doc.
    const joined = await repo.getJoinedAd(db.sql, 'gdn_ad.id', gdnAdId);
    const row = joined[0];
    if (!row) return;
    const doc = buildSearchMixDoc(META_INSERT_COLUMNS, row, {
      index: ES_INDEX,
      extra: { ...buildEsExtra(n, { iso: null, imageUrl: newNas }), ...docFields },
    });
    await db.elastic.index({ index: doc.index, type: doc.type, body: doc.body });
  }
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildGdnAdRow(n, ids) {
  const now = nowDateTime();
  const row = {
    ad_id: n.ad_id,
    type: n.type,
    ad_position: n.ad_position,
    ad_sub_position: n.ad_sub_position ?? null,
    ad_number_position: n.ad_number_position ?? null,
    post_date: now, first_seen: now, last_seen: now,
    days_running: 1,
    source: n.source || 'desktop',
    domain_id: ids.domainId ?? null,
    country_id: ids.countryId ?? null,
    country_only_id: ids.countryOnlyId ?? null,
    post_owner_id: ids.postOwnerId ?? null,
    language_id: ids.languageId || 0,
    target_site_id: ids.targetSiteId ?? null,
  };
  if (String(n.platform) === '12' && n.system_id) row.system_id = n.system_id;
  if (n.phash) row.phash = String(BigInt('0x' + n.phash));   // 16-hex dhash -> BIGINT UNSIGNED (decimal string)
  return row;
}

function buildMetaRow(n, gdnAdId) {
  const now = nowDateTime();
  const desktop = String(n.source ?? 'desktop').toLowerCase() === 'desktop' || !n.source;
  return {
    gdn_ad_id: gdnAdId,
    firstSeenOnDesktop: desktop ? now : '0001-01-01 01:01:01',
    lastSeenOnDesktop: desktop ? now : '0001-01-01 01:01:01',
    platform: toInt(n.platform),
    version: n.version ?? null,
    destination_url: (n.destination_url && String(n.destination_url).trim() !== '') ? n.destination_url : null,
    redirect_url: n.redirect_url ?? null,
    screenshot_url: '/processing.gif',
  };
}

function buildEsExtra(n, { iso, imageUrl }) {
  const extra = {
    lang_detect: iso || null,
    states: splitCsv(n.state),
    city: splitCsv(n.city),
    image_url_original: n.image_url_original ?? null,
    platform: toInt(n.platform),
  };
  if (imageUrl) {
    extra.image_url = imageUrl;          // S3-equivalent (NAS path)
    extra.new_nas_image_url = imageUrl;  // NAS path
  }
  return extra;
}

/**
 * Upload the GDN ad image to NAS. Handles a remote URL (download) or a raw/base64
 * payload (decode → temp). Returns the stored NAS path, or '/bydefault_ads.jpg' on failure.
 * Mirrors PHP helper::fileUpload (IMAGE/TEXT only).
 */
async function uploadGdnImage(adImage, adId, network) {
  if (!adImage || typeof adImage !== 'string') return DEFAULT_AD_IMAGE;

  // Remote URL → reuse the shared downloader/uploader.
  if (/^https?:\/\//i.test(adImage)) {
    const up = await media.uploadImage(adImage, adId, network).catch(() => null);
    const p = up && up.nas_path;
    return p && !String(p).includes('DefaultImage') ? p : DEFAULT_AD_IMAGE;
  }

  // Base64 (possibly data:...;base64,XXXX) → decode → temp file → NAS.
  let b64 = adImage;
  const marker = b64.indexOf('base64,');
  if (marker !== -1) b64 = b64.slice(marker + 7);
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return DEFAULT_AD_IMAGE; }
  if (!buf || buf.length === 0) return DEFAULT_AD_IMAGE;

  const tmp = path.join(os.tmpdir(), `gdn_${adId}_${process.hrtime.bigint()}.jpg`);
  try {
    fs.writeFileSync(tmp, buf);
    const p = await storeInNas('IMAGE', tmp, adId, network, `${adId}`);
    return p && !String(p).includes('DefaultImage') ? p : DEFAULT_AD_IMAGE;
  } catch {
    return DEFAULT_AD_IMAGE;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── small helpers ─────────────────────────────────────────────────────────────
function computeDaysRunning(firstSeen, lastSeen) {
  const p = toEpochSeconds(firstSeen);
  const l = toEpochSeconds(lastSeen);
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
function splitCsv(v) {
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(',').map((x) => x.trim()).filter((x) => x.length);
}
function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}
function uniq(arr) { return [...new Set(arr.filter((x) => x !== undefined && x !== null && x !== ''))]; }
/** Host of a URL minus a leading www. (PHP parse_url); falls back to the raw string. */
function extractDomain(url) {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    return (u.hostname || '').replace(/^www\./i, '');
  } catch {
    return String(url); // PHP: domainName = destination_url when parse_url has no host
  }
}

module.exports = { processMetaAd };
