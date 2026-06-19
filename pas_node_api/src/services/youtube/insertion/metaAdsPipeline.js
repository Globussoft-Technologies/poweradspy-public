'use strict';

/**
 * YouTube ytAdsData pipeline — port of YoutubeAdController::insertNewYoutubeAds() →
 * insertAdToMySqlDatabase() → (insert | updateAdsData). See ../../../../KT-YOUTUBE-MIGRATION.md.
 *
 * processMetaAd(ad, ctx) handles ONE ad → { code, message, data? }.
 * ctx = { db:{sql,elastic}, log, network:'youtube' }. Shared InsertionEngine batches.
 *
 * Faithful-but-fixed (MANIFEST §0.5): all INSERT writes in ONE transaction; media uploaded
 * AFTER commit named by the internal youtube_ad.id; ES doc is FLAT into youtube_ads_data with
 * the internal id as _id and dates as UNIX epoch ints.
 *
 * Media: IMAGE/DISPLAY → ad image to NAS (yt/adImage) → variant.video_url. Other types
 * (VIDEO/DISCOVERY/…) → thumbnail to NAS (yt/thumbnail) → variant.video_url + thumbnail_url;
 * variant.video_url_original keeps the raw ad_image URL. (The real mp4→S3 upload + youtube_ad_budget
 * are peripheral and intentionally omitted — see KT §6.)
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateMetaAds } = require('./validate');
const { normalizeYoutubeAd, checkGates } = require('./normalize');
const { buildDoc, ES_INDEX } = require('./esDocBuilder');
const { META_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const DEFAULT_AD_IMAGE = '/bydefault_ads.jpg';
const DEFAULT_OWNER_IMAGE = '/DefaultImage.jpg';
const ZERO_DATE = '0000-00-00 00:00:00';
const IMAGE_TYPES = new Set(['IMAGE', 'DISPLAY']);

async function processMetaAd(ad, ctx) {
  const { db, log } = ctx;
  const network = ctx.network || 'youtube';
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', { field: 'ad_id', hint: 'Add the platform ad_id and resend.' });
  }

  // BANNER ads are a separate PHP method (insertBannerAds) — not part of this port.
  if (String(ad.type) === 'BANNER') {
    return rejected(400, 'BANNER ads are handled by a separate flow and are not supported on this endpoint.', { field: 'type', hint: 'Send IMAGE/VIDEO/TEXT/RESPONSIVE/DISPLAY/DISCOVERY/TEXT_IMAGE.' });
  }

  // entry gates (SHORTS / version / TEXT_IMAGE)
  const gate = checkGates(ad);
  if (gate) return { code: 400, status: 'rejected', message: gate.message, error: gate.error };

  // validation
  const v = validateMetaAds(ad);
  if (v.code !== 200) return v;

  try {
    const existing = await repo.getAdByAdId(sql, ad.ad_id);
    if (existing.code === 400) {
      return await insertPath(ctx, ad, { network });
    }
    return await updatePath(ctx, ad, { network, existingId: existing.data[0].id });
  } catch (err) {
    log.error('youtube ytAdsData pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── INSERT path ─────────────────────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeYoutubeAd(rawAd);

  const source = String(n.source || 'desktop');
  const postOwnerLower = String(n.post_owner ?? '').toLowerCase();
  const domain = extractDomain(n.destination_url);
  const isImageType = IMAGE_TYPES.has(String(n.type));

  // external APIs in parallel (best-effort): translation + impression + popularity
  const imprParams = {
    ad_running_days: 1, ad_position: n.ad_position, ad_type: n.type,
    ad_likes: n.likes, ad_comments: n.comment, ad_views: n.views, ad_shares: 0,
  };
  const [translationRes, impr, pop] = await Promise.all([
    api.translate({ call_to_action: n.call_to_action ?? '', text: n.ad_text ?? '', title: n.ad_title ?? '', newsfeed_description: n.newsfeed_description ?? '' }),
    api.impression(imprParams),
    api.popularity(imprParams),
  ]);
  const translation = translationRes.ok ? translationRes.data : null;

  // language detect (skipped in dev, like the other networks' APP_ENV check)
  let languageId = 0;
  if (!config.isDev && translation?.detected_language) {
    languageId = (await repo.getLanguageId(sql, String(translation.detected_language).slice(0, 2))) || 0;
  }
  const impressionVal = toInt(impr?.impression, 0);
  const popularityObj = pop || { max: 0, current: 0 };

  const result = await repo.withTransaction(sql, async (tx) => {
    // post owner (dedup by name, case-insensitive)
    let postOwnerId;
    const po = await repo.getPostOwner(tx, postOwnerLower);
    if (po.code === 200) {
      postOwnerId = po.data[0].id;
      await repo.updatePostOwner(tx, { ads_count: toInt(po.data[0].ads_count) + 1 }, postOwnerId);
    } else {
      postOwnerId = await repo.insertPostOwner(tx, {
        post_owner_name: n.post_owner, channal_url: n.channnelurl ?? null,
        post_owner_image: DEFAULT_OWNER_IMAGE, original_post_owner_image: n.post_owner_image ?? null,
        ads_count: 1, image_updated: 0, verified: n.verified,
      });
    }

    // call_to_action (dedup by action, bump count) — nullable when CTA is empty
    let callToActionId = null;
    if (n.call_to_action !== undefined && n.call_to_action !== null) {
      const cta = await repo.getCallToAction(tx, n.call_to_action);
      if (cta.code === 200) { callToActionId = cta.data[0].id; await repo.bumpCallToActionCount(tx, callToActionId); }
      else callToActionId = await repo.insertCallToAction(tx, n.call_to_action);
    }

    // country_only (+ country row)
    let countryOnlyId = null;
    const co = await repo.getCountryOnly(tx, n.country);
    countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(tx, n.country);
    let countryId = null;
    const c = await repo.getCountry(tx, { city: n.city, state: n.state, country: n.country });
    countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

    // domain
    let domainId = null;
    let domainRow = null;
    if (domain && domain.trim() !== '') {
      const d = await repo.getDomain(tx, domain);
      if (d.code === 200) { domainId = d.data[0].id; domainRow = d.data[0]; }
      else domainId = await repo.insertDomain(tx, domain);
    }

    // variant FIRST (PHP inserts variant before youtube_ad → default_variant_id) — image_url set post-commit
    const variantId = await repo.insertVariant(tx, {
      youtube_ad_id: 1, // placeholder, back-filled below
      title: n.ad_title, text: n.ad_text, newsfeed_description: n.newsfeed_description,
      video_url_original: n.ad_image ?? null, video_url: null,
      channal_url: n.channnelurl ?? null, tags: n.tags ?? null,
      thumbnail_url_original: (n.thumbnail && String(n.thumbnail).trim() !== '') ? n.thumbnail : null, thumbnail_url: null,
    });

    // youtube_ad (with all FK ids + default_variant_id)
    const adRow = buildYoutubeAdRow(n, {
      categoryId: n.category, languageId, postOwnerId, callToActionId, domainId, countryId, countryOnlyId,
      defaultVariantId: variantId, impression: impressionVal, popularity: JSON.stringify(popularityObj), source,
    });
    const youtubeAdId = await repo.insertYoutubeAd(tx, adRow);
    if (!youtubeAdId) throw new Error(`Failed to insert youtube_ad for ad_id ${n.ad_id}`);

    // back-fill the variant's youtube_ad_id
    await repo.updateVariantById(tx, { youtube_ad_id: youtubeAdId }, variantId);

    // analytics
    await repo.insertAnalytics(tx, { youtube_ad_id: youtubeAdId, views: n.views, likes: n.likes, dislike: n.dislike, comments: n.comment, date: today() });

    // ad_countries / _only (insert if absent)
    const yac = await repo.getAdCountry(tx, youtubeAdId, countryOnlyId);
    if (yac.code !== 200) await repo.insertAdCountry(tx, { youtube_ad_id: youtubeAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
    const yaco = await repo.getAdCountryOnly(tx, youtubeAdId, countryOnlyId);
    if (yaco.code !== 200) await repo.insertAdCountryOnly(tx, { youtube_ad_id: youtubeAdId, country_only_id: countryOnlyId, count: 1 });

    // meta_data
    await repo.insertMetaData(tx, buildMetaRow(n, youtubeAdId, source, languageId));

    // translation
    await repo.upsertTranslation(tx, {
      youtube_ad_id: youtubeAdId,
      ad_text: translation?.text ?? null, ad_title: translation?.title ?? null, news_feed_description: translation?.newsfeed_description ?? null,
    });

    return { youtubeAdId, variantId, postOwnerId, domainId, domainRow, countryOnlyId };
  });

  // ── media AFTER commit (named by internal youtube_ad.id) ──
  // post-owner image
  let postOwnerImage = DEFAULT_OWNER_IMAGE;
  if (n.post_owner_image && /^https?:\/\//i.test(n.post_owner_image)) {
    const up = await media.uploadPostOwner(n.post_owner_image, result.postOwnerId, network).catch(() => null);
    postOwnerImage = up && up.post_owner_image && !String(up.post_owner_image).includes('DefaultImage') ? up.post_owner_image : DEFAULT_OWNER_IMAGE;
    if (postOwnerImage !== DEFAULT_OWNER_IMAGE) {
      await repo.updatePostOwner(sql, { post_owner_image: postOwnerImage, original_post_owner_image: n.post_owner_image, image_updated: 1 }, result.postOwnerId).catch(() => {});
    }
  }

  // ad creative: IMAGE/DISPLAY → image to NAS; else → thumbnail to NAS (video_url = thumbnail)
  const isImage = IMAGE_TYPES.has(String(n.type));
  let mediaUrl = DEFAULT_AD_IMAGE;
  let thumbUrl = null;
  if (isImage && n.ad_image && /^https?:\/\//i.test(n.ad_image)) {
    const up = await media.uploadImage(n.ad_image, result.youtubeAdId, network).catch(() => null);
    mediaUrl = up && up.nas_path && !String(up.nas_path).includes('DefaultImage') ? up.nas_path : DEFAULT_AD_IMAGE;
    thumbUrl = mediaUrl;
  } else if (n.thumbnail && /^https?:\/\//i.test(n.thumbnail)) {
    const up = await media.uploadThumbnail(n.thumbnail, result.youtubeAdId, network).catch(() => null);
    thumbUrl = up && up.image_video_url && !String(up.image_video_url).includes('DefaultImage') ? up.image_video_url : DEFAULT_OWNER_IMAGE;
    mediaUrl = thumbUrl;
  }
  if (mediaUrl && mediaUrl !== DEFAULT_AD_IMAGE) {
    await repo.updateVariantByAdId(sql, { video_url: mediaUrl, thumbnail_url: thumbUrl }, result.youtubeAdId).catch(() => {});
  }

  // other_multimedia (carousel) → youtube_ad_image_video (VIDEO + SIDE only, PHP-exact)
  if (String(n.type) === 'VIDEO' && String(n.ad_position) === 'SIDE' && Array.isArray(n.othermedia_list) && n.othermedia_list.length) {
    const mm = await media.uploadMultimedia(n.othermedia_list, n.type, result.youtubeAdId, network).catch(() => null);
    if (mm && mm.ad_image_video) {
      await repo.insertAdImageVideo(sql, { youtube_ad_id: result.youtubeAdId, ad_type: n.type, ad_image_video: mm.ad_image_video }).catch(() => {});
    }
  }

  // platform 12 (python plugin) → system user + account activity
  if (String(n.platform) === '12' && n.system_id) {
    const su = await repo.getSystemUser(sql, n.system_id).catch(() => ({ code: 400 }));
    if (su.code === 200) await repo.bumpSystemUserCount(sql, su.data[0].id).catch(() => {});
    else await repo.insertSystemUser(sql, { system_id: n.system_id, ads_count: 1 }).catch(() => {});
    await repo.insertAccountActivity(sql, { system_id: n.system_id, youtube_ad_id: result.youtubeAdId, platform: 12, is_unique: 1 }).catch(() => {});
  }

  // ES index (flat doc into youtube_ads_data, _id = internal id)
  await indexAd(ctx, result.youtubeAdId, n, { translation, mediaUrl, thumbUrl, postOwnerImage, impressionVal, popularityObj, isImage }, network)
    .catch((e) => log.warn('youtube ES index failed', { error: e.message }));

  api.adgptInsert(buildAdgptPayload(n, result, mediaUrl));

  const warning = (!mediaUrl || String(mediaUrl).includes('Default')) ? 'Media storage issue: the ad was saved, but its image/thumbnail could not be stored.' : null;
  return ok(result.youtubeAdId, `Ad inserted successfully ad_type:${n.type}, ad_position:${n.ad_position}`, warning ? { warning } : {});
}

// ── UPDATE path ─────────────────────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { network, existingId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeYoutubeAd(rawAd);

  const joined = await repo.getJoinedAd(sql, 'youtube_ad.id', existingId);
  const cur = joined[0] || { id: existingId };
  const youtubeAdId = cur.id || existingId;

  // last_seen / days_running + refreshed engagement
  const lastSeen = nowDateTime();
  const daysRunning = computeDaysRunning(cur.first_seen, lastSeen);
  await repo.updateYoutubeAd(sql, {
    last_seen: lastSeen, days_running: daysRunning,
    likes: n.likes, dislikes: n.dislike, comments: n.comment, views: n.views,
  }, youtubeAdId);

  // analytics (new daily row)
  await repo.insertAnalytics(sql, { youtube_ad_id: youtubeAdId, views: n.views, likes: n.likes, dislike: n.dislike, comments: n.comment, date: today() }).catch(() => {});

  // country_only + ad_countries/_only (bump-or-insert)
  let countryOnlyId = null;
  const co = await repo.getCountryOnly(sql, n.country);
  countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(sql, n.country);
  let countryId = null;
  const c = await repo.getCountry(sql, { city: n.city, state: n.state, country: n.country });
  countryId = c.code === 200 ? c.data[0].id : await repo.insertCountry(sql, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });
  const yac = await repo.getAdCountry(sql, youtubeAdId, countryOnlyId);
  if (yac.code === 200) {
    await repo.bumpAdCountryCount(sql, yac.data[0].id);
    const yaco = await repo.getAdCountryOnly(sql, youtubeAdId, countryOnlyId);
    if (yaco.code === 200) await repo.bumpAdCountryOnlyCount(sql, yaco.data[0].id);
  } else {
    await repo.insertAdCountry(sql, { youtube_ad_id: youtubeAdId, country_id: countryId, country_only_id: countryOnlyId, count: 1 });
    await repo.insertAdCountryOnly(sql, { youtube_ad_id: youtubeAdId, country_only_id: countryOnlyId, count: 1 });
  }

  // platform 12 → account activity (is_unique = 0 for existing)
  if (String(n.platform) === '12' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, youtube_ad_id: youtubeAdId, platform: 12, is_unique: 0 }).catch(() => {});
  }

  // ES update (flat partial doc; recover by re-indexing if missing)
  await updateEsDoc(ctx, youtubeAdId, n, { cur, lastSeen, daysRunning, network })
    .catch((e) => log.warn('youtube ES update failed', { error: e.message }));

  return updated(youtubeAdId);
}

// ── ES index (INSERT) — build flat doc from the joined row ─────────────────────
async function indexAd(ctx, youtubeAdId, n, extras, network) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'youtube_ad.id', youtubeAdId);
  const row = joined[0];
  if (!row) return;
  const data = await buildFlatData(db, row, youtubeAdId, n, extras);
  const doc = buildDoc(META_INSERT_COLUMNS, data, { extra: buildEsExtra(n, row, extras) });
  await db.elastic.index({ index: doc.index, type: doc.type, id: String(youtubeAdId), body: doc.body });
}

// ── ES update (UPDATE) — partial doc addressed by _id = internal id ────────────
async function updateEsDoc(ctx, youtubeAdId, n, { cur, lastSeen, daysRunning, network }) {
  const { db } = ctx;
  if (!db.elastic) return;
  const countriesCsv = await repo.getCountriesCsv(db.sql, youtubeAdId);
  const { toEpoch, splitPipes, splitCsv } = require('./esDocBuilder');
  const doc = {
    last_seen: toEpoch(lastSeen),
    reactions: { likes: n.likes },
    comments: n.comment,
    views: n.views,
    countries: countriesCsv ? splitCsv(countriesCsv) : splitCsv(n.country),
    states: splitCsv(n.state),
    city: splitCsv(n.city),
    source: splitPipes(n.source),
  };
  try {
    await db.elastic.update({ index: ES_INDEX, type: 'doc', id: String(youtubeAdId), body: { doc } });
  } catch (err) {
    const joined = await repo.getJoinedAd(db.sql, 'youtube_ad.id', youtubeAdId);
    const row = joined[0];
    if (!row) return;
    const data = await buildFlatData(db, row, youtubeAdId, n, { mediaUrl: row.video_url, thumbUrl: row.thumbnail_url, postOwnerImage: row.post_owner_image, isImage: IMAGE_TYPES.has(String(row.type)) });
    const full = buildDoc(META_INSERT_COLUMNS, data, { extra: { ...buildEsExtra(n, row, {}), ...doc } });
    await db.elastic.index({ index: full.index, type: full.type, id: String(youtubeAdId), body: full.body });
  }
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildYoutubeAdRow(n, ids) {
  const now = nowDateTime();
  const row = {
    ad_id: n.ad_id,
    category_id: ids.categoryId ?? 12345,
    language_id: ids.languageId || 0,
    discoverer_user_id: 0,
    default_ad_url_id: 0,
    default_variant_id: ids.defaultVariantId ?? 0,
    post_owner_updated: 0,
    variants_count: 0,
    type: n.type, ad_position: n.ad_position,
    likes: toInt(n.likes), dislikes: toInt(n.dislike), comments: toInt(n.comment), views: toInt(n.views),
    lower_age_seen: toInt(n.lower_age, 18), upper_age_seen: toInt(n.upper_age, 65),
    post_date: (n.post_date === '' ? ZERO_DATE : (n.post_date || now)),
    first_seen: n.first_seen || now, last_seen: now,
    days_running: 1, status: 1, hits: 0, source: n.source || 'desktop',
    affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    l_c_s_status: 0, l_c_s_updated_date: now,
    impression: ids.impression ?? 0, popularity: ids.popularity ?? null,
    domain_id: ids.domainId ?? null, country_id: ids.countryId ?? null, country_only_id: ids.countryOnlyId ?? null,
    post_owner_id: ids.postOwnerId ?? null, call_to_action_id: ids.callToActionId ?? null,
  };
  if (String(n.platform) === '12' && n.system_id) row.system_id = n.system_id;
  return row;
}

function buildMetaRow(n, youtubeAdId, source, languageId) {
  const now = nowDateTime();
  const sentinel = '0001-01-01 01:01:01';
  const src = String(source).toLowerCase();
  return {
    youtube_ad_id: youtubeAdId,
    firstSeenOnIos: src === 'ios' ? now : sentinel, lastSeenOnIos: src === 'ios' ? now : sentinel,
    firstSeenOnAndroid: src === 'android' ? now : sentinel, lastSeenOnAndroid: src === 'android' ? now : sentinel,
    firstSeenOnDesktop: (src === 'desktop' || !n.source) ? now : sentinel, lastSeenOnDesktop: (src === 'desktop' || !n.source) ? now : sentinel,
    language_id: languageId || 0,
    platform: toInt(n.platform),
    ad_url: n.ad_url ?? null,
    version: n.version ?? null,
    display_link: n.display_link ?? null,
    destination_url: (n.destination_url && String(n.destination_url).trim() !== '') ? n.destination_url : null,
    screenshot_url: '/processing.gif',
  };
}

/** Map the joined SQL row → flat ES data object. */
async function buildFlatData(db, row, youtubeAdId, n, extras) {
  const countriesCsv = await repo.getCountriesCsv(db.sql, youtubeAdId).catch(() => null);
  return {
    ad_id: youtubeAdId,
    post_owner: row.post_owner_name ?? null,
    post_owner_id: row.post_owner_table_id ?? null,
    post_owner_image: extras.postOwnerImage ?? row.post_owner_image ?? null,
    ad_title: row.title ?? null,
    ad_text: row.text ?? null,
    newsfeed_description: row.newsfeed_description ?? null,
    call_to_action: row.call_to_action ?? null,
    ad_url: row.ad_url ?? null,
    ad_image_or_video: extras.mediaUrl ?? row.video_url ?? null,
    verified: row.verified ?? 0,
    first_seen: row.first_seen ?? null,
    last_seen: row.last_seen ?? null,
    hastags: row.tags ?? null,
    reactions: { likes: toInt(row.likes) },
    comments: toInt(row.comments),
    views: toInt(row.views),
    impression: row.impression ?? extras.impressionVal ?? 0,
    popularity: safeJson(row.popularity) ?? extras.popularityObj ?? { max: 0, current: 0 },
    destination_url: row.destination_url ?? null,
    // redirect_urls: resolved click chain from the crawler (no SQL column — read from payload).
    redirect_urls: n.redirect_urls ?? null,
    html_text: null,
    image_ocr: null, image_object: null, image_brand: null, image_celebrity: null,
    post_date: row.post_date ?? null,
    countries: countriesCsv ?? row.country ?? null,
    states: n.state ?? null,
    city: n.city ?? null,
    ad_type: row.type ?? null,
    ad_position: row.ad_position ?? null,
    ad_language: row.ad_language ?? null,
    affiliate_networks: null, ecommerce_platform: null, funnel: null,
    source: row.source ?? n.source ?? null,
    comment_data: null,
    domain_registration_date: row.domain_registered_date ?? null,
    text_image_title: n.text_image_title ?? null,
    image_url_original: row.video_url_original ?? n.ad_image ?? null,
    thumbnail_url: extras.thumbUrl ?? row.thumbnail_url ?? null,
    platform: toInt(row.platform ?? n.platform),
  };
}

function buildEsExtra(n, row, extras) {
  const extra = {};
  // IMAGE/DISPLAY → new_nas_image_url; other types skip it (PHP-exact)
  if (extras && extras.isImage && extras.mediaUrl && extras.mediaUrl !== DEFAULT_AD_IMAGE) {
    extra.new_nas_image_url = extras.mediaUrl;
  }
  if (extras && extras.translation) {
    const t = extras.translation;
    if (t.localization_en || t.en) extra.localization_en = t.localization_en ?? t.en;
  }
  return extra;
}

function buildAdgptPayload(n, result, mediaUrl) {
  return {
    ad_id: result.youtubeAdId, network: 'youtube', type: n.type, platform: toInt(n.platform),
    source: n.source, ad_position: n.ad_position, ad_title: n.ad_title,
    newsfeed_description: n.newsfeed_description, destination_url: n.destination_url,
    [`ad-${String(n.type || '').toLowerCase()}`]: mediaUrl ?? null,
  };
}

// ── small helpers ─────────────────────────────────────────────────────────────
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
function extractDomain(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (s === '' || s.toLowerCase() === 'null') return '';
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`); const h = (u.hostname || '').replace(/^www\./i, ''); return h.toLowerCase() === 'null' ? '' : h; }
  catch { return ''; }
}
function safeJson(s) {
  if (s === undefined || s === null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { processMetaAd };
