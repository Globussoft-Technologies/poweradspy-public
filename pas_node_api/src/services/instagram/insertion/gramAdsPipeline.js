'use strict';

/**
 * Instagram gramAdsData pipeline — port of InstagramUserController::instaAdsData.
 * Same optimized shape as the Facebook metaAds pipeline: parallel translation/user/
 * existence + impression‖popularity; all DB writes in one transaction; media uploads
 * (post-owner + ad image/video + carousel) run AFTER commit, in parallel; ES + ADGPT after.
 *
 * Instagram specifics: discoverer resolved by `instagram_id`; instagram_ad has NO
 * `platform` column (platform → meta_data); call_to_action column is `call_to_action`;
 * country is a single string; first_seen/last_seen = now() (PHP), post_date from epoch.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateInsta } = require('./validate');
const { normalizeInsta, parseOtherMultimedia } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver } = require('./esDocBuilder');
const { ES_INDEX, INSTA_INSERT_COLUMNS } = require('./esColumns');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, epochToDateTime, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const NETWORK = 'instagram';

async function processGramAd(ad, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', { field: 'ad_id', hint: 'Add the platform ad_id and resend.' });
  }
  const v = validateInsta(ad);
  if (v.code !== 200) return v;

  // user (instagram_id) + existence + translation in parallel
  const [userRes, existing, translation] = await Promise.all([
    resolveUser(sql, ad),
    repo.getAdByAdId(sql, ad.ad_id),
    api.translate({ call_to_action: ad.call_to_action ?? '', text: ad.ad_text ?? '', title: ad.ad_title ?? '', newsfeed_description: ad.news_feed_description ?? '' }).catch(() => ({ ok: false })),
  ]);
  if (userRes.code !== 200) return userRes;
  const userId = userRes.userId;
  const translationData = translation.ok ? translation.data : null;

  try {
    if (existing.code === 400) {
      return await insertPath(ctx, ad, { userId, translation: translationData });
    }
    return await updatePath(ctx, ad, { userId, translation: translationData, existingId: existing.data[0].id });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('gramAds pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── discovering user via instagram_id (+ platform 3 country fallback) ────────────
async function resolveUser(sql, ad) {
  if (ad.instagram_id) {
    const u = await repo.getUserByInstagramId(sql, ad.instagram_id);
    if (u.code !== 200) return rejected(401, `The instagram_id "${ad.instagram_id}" is not registered.`, { field: 'instagram_id', hint: 'Send a known instagram_id.' });
    return { code: 200, userId: u.data[0].id };
  }
  if (String(ad.platform) === '3') {
    const igId = await repo.getUserInstagramIdByCountry(sql, ad.country);
    if (igId) {
      const u = await repo.getUserByInstagramId(sql, igId);
      if (u.code === 200) return { code: 200, userId: u.data[0].id, userIdStatus: true };
    }
    return rejected(401, 'No discovering user found for the given country (platform 3).', { field: 'country' });
  }
  return rejected(400, 'Missing instagram_id — the discovering user is required.', { field: 'instagram_id' });
}

// ── INSERT ───────────────────────────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { userId, translation }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeInsta(rawAd);

  // language detect (best-effort)
  let languageId = 0;
  let iso = null;
  if (translation?.detected_language) {
    iso = translation.detected_language;
    languageId = (await repo.getLanguageId(sql, iso)) || (await repo.insertLanguage(sql, iso, translation.language_name)) || 0;
  }
  if (translation?.call_to_action) n.call_to_action = translation.call_to_action;

  // STORIES handling (PHP): ad_type 1 → type STORIES; Adtype 1=image 2=video
  let type = n.type;
  let adType;
  if (toInt(n.ad_type) === 1) { type = 'STORIES'; adType = n.type === 'IMAGE' ? 1 : (n.type === 'VIDEO' ? 2 : 0); }
  const isVideo = n.type === 'VIDEO';

  // impression + popularity (parallel; API). country is a single string.
  const isoList = await repo.getIsoByNames(sql, n.country ? [n.country] : []).catch(() => []);
  const metrics = {
    ad_running_days: 1, ad_call_to_action: n.call_to_action ?? '', ad_iso: isoList,
    ad_type: type, ad_position: n.ad_position,
    ad_likes: toInt(n.likes), ad_comments: toInt(n.comment), ad_shares: toInt(n.share), ad_views: toInt(n.views),
  };
  const [imp, pop] = await Promise.all([api.impression(metrics), api.popularity(metrics)]);

  const result = await repo.withTransaction(sql, async (tx) => {
    const postOwnerId = await upsertPostOwner(tx, n, NETWORK, { skipImage: true });

    let ctaId = 0;
    if (n.call_to_action) {
      const c = await repo.getCallToAction(tx, n.call_to_action);
      if (c.code === 200) { ctaId = c.data[0].id; await repo.bumpCallToActionCount(tx, ctaId); }
      else ctaId = await repo.insertCallToAction(tx, n.call_to_action);
    }

    let categoryId = 0;
    if (n.category) {
      const cat = await repo.getCategory(tx, n.category);
      categoryId = cat.code === 200 ? cat.data[0].id : await repo.insertCategory(tx, n.category);
    }

    const countryOnly = n.country ? await repo.upsertCountryOnly(tx, [n.country]) : [];
    const countryOnlyId = countryOnly[0]?.country_only_id ?? 0;
    let countryId = 0;
    if (n.country) {
      const cExisting = await repo.getCountry(tx, { city: n.city, state: n.state, country: n.country });
      countryId = cExisting.code === 200 ? cExisting.data[0].id
        : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });
    }

    let domainId = 0;
    const domain = extractDomain(n.destination_url);
    if (domain) {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    const adRow = buildInstaAdRow(n, { type, adType, categoryId, ctaId, domainId, countryId, countryOnlyId, postOwnerId, userId, languageId, impression: imp.impression, popularity: popToSql(pop), isVideo });
    const instagramAdId = await repo.insertInstagramAd(tx, adRow);
    if (!instagramAdId) {
      const e = new Error(`This ad_id "${n.ad_id}" already exists (duplicate).`); e.insertionCode = 402; throw e;
    }

    const variantId = await repo.insertVariant(tx, { instagram_ad_id: instagramAdId, title: n.ad_title, text: n.ad_text, newsfeed_description: n.news_feed_description, image_url_original: n.image_video_url });

    const analyticsId = await repo.insertAnalytics(tx, { instagram_ad_id: instagramAdId, likes: toInt(n.likes), comments: toInt(n.comment), shares: toInt(n.share), popularity: popToSql(pop), impression: imp.impression, date: today(), hits: 1 });
    await repo.updateInstagramAd(tx, { default_variant_id: variantId, default_analytics_id: analyticsId }, instagramAdId);

    // child rows: countries
    if (countryOnly.length) {
      await repo.insertAdCountries(tx, countryOnly.map((c) => ({ ...c, instagram_ad_id: instagramAdId, country_id: countryId })));
      await repo.insertAdCountriesOnly(tx, countryOnly.map((c) => ({ ...c, instagram_ad_id: instagramAdId })));
    }

    // ad_users (+ userid_status platform 3)
    await upsertAdUser(tx, instagramAdId, userId, n.platform);

    // meta_data + ad_url
    await insertMetaData(tx, n, instagramAdId);
    if (n.destination_url) {
      await tx.query('INSERT INTO instagram_ad_url (instagram_ad_id, url_type, url) VALUES (?,?,?)', [instagramAdId, 'D', n.destination_url]).catch(() => {});
    }

    // translation
    await repo.upsertTranslation(tx, { instagram_ad_id: instagramAdId, news_feed_description: translation?.newsfeed_description ?? n.news_feed_description, ad_title: translation?.title ?? n.ad_title, ad_text: translation?.text ?? n.ad_text });

    // platform 10: System_id + accounts_activities
    if (String(n.platform) === '10' && n.system_id) {
      await repo.updateUser(tx, { System_id: n.system_id }, n.instagram_id).catch(() => {});
      await repo.insertAccountActivity(tx, { system_id: n.system_id, instagram_ad_id: instagramAdId, platform: 10, is_unique: 1 }).catch(() => {});
    }

    return { instagramAdId, variantId, postOwnerId, imp, pop, iso };
  });

  // After commit: media uploads in parallel
  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, NETWORK).catch(() => null),
    uploadAdMediaAndSaveVariant(sql, n, result.instagramAdId, result.variantId),
  ]);
  result.mediaPaths = mediaPaths;

  await indexAd(ctx, result.instagramAdId, n, result).catch((e) => log.warn('ES index failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, result));

  const warning = media.mediaIssueWarning(mediaPaths, n.type);
  return ok(result.instagramAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE ───────────────────────────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { userId, translation, existingId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeInsta(rawAd);
  const adId = existingId;
  const joined = await repo.getJoinedAd(sql, adId);
  const cur = joined[0] || {};

  const likes = Math.max(toInt(cur.likes), toInt(n.likes));
  const comments = Math.max(toInt(cur.comments), toInt(n.comment));
  const shares = Math.max(toInt(cur.shares), toInt(n.share));

  const lastSeen = nowDateTime();
  const daysRunning = computeDaysRunning(cur.first_seen ?? cur.post_date, Math.floor(Date.now() / 1000));
  await repo.updateInstagramAd(sql, { last_seen: lastSeen, days_running: daysRunning }, adId);

  // analytics + facebook_ad LCS/impression/popularity
  if (['FEED', 'VIDEOFEED', 'SIDE', 'STORIES'].includes(String(n.ad_position).replace(/\s/g, '').toUpperCase())) {
    await updateAnalyticsAndAd(sql, adId, n, daysRunning, likes, comments, shares);
  }

  const hits = (toInt(cur.hits) === 0 || toInt(cur.hits) === 1) ? await repo.sumHits(sql, adId) : toInt(cur.hits) + 1;
  await repo.updateInstagramAd(sql, { hits }, adId).catch(() => {});

  if (userId) await upsertAdUser(sql, adId, userId, n.platform);
  if (!n.destination_url) await repo.updateMetaBuiltWith(sql, adId, 4).catch(() => {});

  const countryOnly = n.country ? await repo.upsertCountryOnly(sql, [n.country]) : [];
  if (countryOnly.length) await repo.upsertAdCountriesOnly(sql, countryOnly.map((c) => ({ ...c, instagram_ad_id: adId })));

  await repo.upsertTranslation(sql, { instagram_ad_id: adId, news_feed_description: translation?.newsfeed_description ?? n.news_feed_description, ad_title: translation?.title ?? n.ad_title, ad_text: translation?.text ?? n.ad_text });

  // re-upload media only if the stored image is missing / DefaultImage
  let mediaPaths = {};
  const storedImg = String(cur.image_url || '');
  if (!storedImg || storedImg.includes('DefaultImage')) {
    mediaPaths = await uploadAdMediaAndSaveVariant(sql, n, adId, null).catch(() => ({}));
  }

  const carryOver = await fetchCarryOver(ctx, adId);
  await deleteEsDoc(ctx, adId).catch(() => {});
  await indexAd(ctx, adId, n, { instagramAdId: adId, mediaPaths, carryOver }).catch((e) => log.warn('ES reindex failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, { instagramAdId: adId }));

  const warning = Object.keys(mediaPaths).length ? media.mediaIssueWarning(mediaPaths, n.type) : null;
  return updated(adId, warning);
}

async function updateAnalyticsAndAd(sql, adId, n, daysRunning, likes, comments, shares) {
  const isoList = await repo.getIsoByNames(sql, n.country ? [n.country] : []).catch(() => []);
  const metrics = { ad_running_days: daysRunning, ad_call_to_action: n.call_to_action ?? '', ad_iso: isoList, ad_type: n.type, ad_position: n.ad_position, ad_likes: likes, ad_comments: comments, ad_shares: shares, ad_views: toInt(n.views) };
  const [imp, pop] = await Promise.all([api.impression(metrics).catch(() => ({ impression: 0, engagement_rate: 0 })), api.popularity(metrics).catch(() => null)]);
  const last = await repo.getLastAnalytics(sql, adId);
  const row = last.code === 200 ? last.data[0] : null;
  let analyticsId;
  if (row && String(row.date).slice(0, 10) >= today()) {
    analyticsId = row.id;
    await repo.updateAnalytics(sql, { likes, comments, shares, hits: toInt(row.hits) + 1, impression: imp.impression, popularity: popToSql(pop) }, analyticsId);
  } else {
    analyticsId = await repo.insertAnalytics(sql, { instagram_ad_id: adId, likes, comments, shares, impression: imp.impression, popularity: popToSql(pop), date: today(), hits: 1 });
  }
  const adUpdate = { likes, comments, shares, impression: imp.impression, popularity: popToSql(pop), default_analytics_id: analyticsId };
  if (n.type === 'VIDEO') adUpdate.views = toInt(n.views);
  await repo.updateInstagramAd(sql, adUpdate, adId).catch(() => {});
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildInstaAdRow(n, ids) {
  const row = {
    category_id: ids.categoryId || 0,
    call_to_action_id: ids.ctaId || 0,
    domain_id: ids.domainId || 0,
    country_id: ids.countryId || 0,
    country_only_id: ids.countryOnlyId || 0,
    post_owner_id: ids.postOwnerId || 0,
    discoverer_user_id: ids.userId || 0,
    likes: toInt(n.likes), comments: toInt(n.comment), shares: toInt(n.share),
    source: n.source ?? 'desktop',
    post_date: epochToDateTime(n.post_date), first_seen: nowDateTime(), last_seen: nowDateTime(),
    days_running: 1,
    lower_age_seen: toInt(n.lower_age), upper_age_seen: toInt(n.upper_age),
    type: ids.type, ad_id: n.ad_id, ad_position: n.ad_position,
    default_ad_url_id: 0, post_owner_updated: 0, language_id: ids.languageId || 0,
    variants_count: 0, l_c_s_status: 0, l_c_s_updated_date: nowDateTime(),
    status: 1, hits: 0, affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    impression: ids.impression || 0, popularity: ids.popularity,
  };
  if (ids.adType) row.ad_type = ids.adType;
  if (ids.isVideo) row.views = toInt(n.views);
  if (String(n.platform) === '10' && n.system_id) row.System_id = n.system_id;
  return row;
}

async function upsertAdUser(tx, adId, userId, platform) {
  const existing = await repo.getAdUser(tx, adId, userId);
  if (existing.code === 200) {
    await repo.bumpAdUserCount(tx, existing.data[0].id);
    if (String(platform) === '3') await repo.setAdUserIdStatus(tx, existing.data[0].id, 1);
    return existing.data[0].id;
  }
  const id = await repo.insertAdUser(tx, { instagram_ad_id: adId, user_id: userId, count: 1 });
  if (String(platform) === '3') await repo.setAdUserIdStatus(tx, id, 1);
  return id;
}

async function insertMetaData(tx, n, adId) {
  if ((await repo.getMetaData(tx, adId)).code === 200) return;
  const src = String(n.source ?? 'desktop').toLowerCase();
  await repo.insertMetaData(tx, {
    instagram_ad_id: adId,
    destination_url: n.destination_url ?? null,
    firstSeenOnDesktop: src === 'desktop' ? nowDateTime() : null,
    firstSeenOnAndroid: src === 'android' ? nowDateTime() : null,
    firstSeenOnIos: src === 'ios' ? nowDateTime() : null,
    screenshot_url: 'processing.gif',
    platform: toInt(n.platform),
    ad_url: n.ad_url ?? null,
    version: n.version ?? null,
  });
}

async function uploadAdMediaAndSaveVariant(sql, n, adId, variantId) {
  const out = {};
  const om = parseOtherMultimedia(n.other_multimedia);
  const [primary, multimedia] = await Promise.all([
    n.type === 'VIDEO'
      ? Promise.all([media.uploadVideo(n.image_video_url, adId, NETWORK).catch(() => null), media.uploadThumbnail(n.thumbnail_url, adId, NETWORK).catch(() => null)]).then(([vid, thumb]) => ({ vid, thumb }))
      : media.uploadImage(n.image_video_url, adId, NETWORK).catch(() => null).then((img) => ({ img })),
    om.present && om.images.length ? media.uploadMultimedia(om.images, n.type, adId, NETWORK).catch(() => null) : Promise.resolve(null),
  ]);
  if (n.type === 'VIDEO') {
    if (primary.vid) out.nas_video_url = primary.vid.drive_video_url;
    if (primary.thumb) out.image_url = primary.thumb.image_video_url;
  } else if (primary.img) {
    out.image_url = primary.img.image_video_url; out.new_nas_image_url = primary.img.nas_path;
  }
  if (out.image_url) await repo.updateVariantByAdId(sql, { image_url: out.image_url, image_url_original: n.image_video_url }, adId).catch(() => {});
  if (multimedia) { out.multimedia = multimedia; await repo.upsertAdImageVideo(sql, multimedia).catch(() => {}); }
  return out;
}

// ── ES ────────────────────────────────────────────────────────────────────────
async function indexAd(ctx, adId, n, result) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, adId);
  const row = joined[0];
  if (!row) return;
  const userCountries = await repo.getUserCountries(db.sql, adId);
  const adCountries = await repo.getAdCountries(db.sql, adId);

  const mp = result.mediaPaths || {};
  const storedImg = row.image_url && !String(row.image_url).includes('DefaultImage') ? row.image_url : null;
  const extra = {
    lang_detect: (result.iso || '').toLowerCase(),
    'instagram_ad.impression': result.imp?.impression ?? row.impression ?? 0,
    image_url_original: n.image_video_url,
    platform: toInt(n.platform),
  };
  if (result.pop) extra['instagram_ad.popularity'] = result.pop;
  if (row.post_owner_image) extra['instagram_ad_post_owners.post_owner_image'] = row.post_owner_image;
  const otherMedia = mp.multimedia?.ad_image_video ?? row.ad_image_video;
  if (otherMedia) extra.othermedia = parseMaybeJson(otherMedia);
  if (n.type === 'VIDEO') {
    extra['instagram_ad.views'] = toInt(n.views);
    extra.thumbnail = mp.image_url ?? storedImg;
    extra.nas_video_url = mp.nas_video_url ?? null;
  } else {
    extra.new_nas_image_url = mp.new_nas_image_url ?? mp.image_url ?? storedImg;
  }
  const carryOver = result.carryOver || {};
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];

  const doc = buildSearchMixDoc(INSTA_INSERT_COLUMNS, row, { index: ES_INDEX, userCountries, adCountries, extra });
  let _id;
  try { _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, adId))); } catch { /* ignore */ }
  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

async function deleteEsDoc(ctx, adId) {
  const { db } = ctx;
  if (!db.elastic) return;
  const _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, adId)));
  if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
}
async function fetchCarryOver(ctx, adId) {
  const { db } = ctx;
  if (!db.elastic) return {};
  try { return extractCarryOver(await db.elastic.search(searchIdQuery(ES_INDEX, adId)), config.insertion.translationField); } catch { return {}; }
}

// ── helpers ─────────────────────────────────────────────────────────────────────
function popToSql(pop) { return pop ? Number(pop.current ?? pop.max ?? 0) || 0 : 0; }
function parseMaybeJson(v) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
function extractDomain(url) { if (!url) return ''; try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; } }
function computeDaysRunning(start, lastSeenEpoch) {
  const p = toEpochSeconds(start); const l = toInt(lastSeenEpoch);
  if (!p || !l || l < p) return 1;
  return Math.max(1, Math.floor((l - p) / 86400));
}
function toEpochSeconds(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : v;
  const s = String(v);
  if (/^\d+$/.test(s)) { const num = parseInt(s, 10); return num > 1e11 ? Math.floor(num / 1000) : num; }
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
function buildAdgptPayload(n, result) { return { ad_id: n.ad_id, instagram_ad_id: result.instagramAdId, type: n.type, platform: toInt(n.platform) }; }

module.exports = { processGramAd };
