'use strict';

/**
 * Instagram adsLibrary pipeline — port of InstagramUserController::adsLibraryInsert.
 * Optimized like Facebook (media after commit, parallel). Instagram specifics:
 * writes instagram_page_details + instagram_ad_cost_usage_benefit_analysis; country
 * ISO→name via country_data.instagram_country_iso; impression = avg(high,low);
 * NO discoverer user, NO instagram_ad_users, NO instagram_country (city/state) write.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateAdsLibrary } = require('./validate');
const { urldecode, parseOtherMultimedia } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver } = require('./esDocBuilder');
const { ES_INDEX, LIBRARY_INSERT_COLUMNS } = require('./esColumns');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, epochToDateTime, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const NETWORK = 'instagram';

async function processAdsLibrary(ad, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  const v = validateAdsLibrary(ad);
  if (v.code !== 200) return v;

  const existing = await repo.getAdByAdId(sql, ad.ad_id);
  const translation = await api.translate({ call_to_action: ad.call_to_action ?? '', text: ad.ad_text ?? '', title: ad.ad_title ?? '', newsfeed_description: ad.news_feed_description ?? '' }).catch(() => ({ ok: false }));
  const n = normalizeLibrary(ad);
  // country ISO → name (unless 'ALL') via country_data.instagram_country_iso
  n.countryNames = await resolveCountryNames(sql, ad.country);

  try {
    if (existing.code === 400) return await insertPath(ctx, n, { translation: translation.ok ? translation.data : null });
    return await updatePath(ctx, n, { translation: translation.ok ? translation.data : null, existingId: existing.data[0].id });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('instagram adsLibrary error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

function normalizeLibrary(ad) {
  const n = { ...ad };
  if (n.post_owner_image === 'null') n.post_owner_image = null;
  for (const f of ['destination_url', 'ad_title', 'news_feed_description', 'ad_text', 'meta_ad_url', 'post_owner_image']) {
    if (n[f] !== undefined && n[f] !== null) n[f] = urldecode(n[f]);
  }
  n.meta_ad_url = n.meta_ad_url ?? '';
  for (const f of ['ad_title', 'news_feed_description', 'ad_text']) {
    if (typeof n[f] === 'string') n[f] = n[f].replace(/&amp;/g, '&');
  }
  n.first_seen = toDateTime(n.first_seen) || nowDateTime();
  n.last_seen = toDateTime(n.last_seen) || nowDateTime();
  // PHP: post_date = payload or '0000-00-00 00:00:00'
  n.post_date = (n.post_date !== undefined && n.post_date !== null && n.post_date !== '') ? toDateTime(n.post_date) : '0000-00-00 00:00:00';
  n.views = toInt(n.views, 0);
  n.impressions_low = toInt(n.impressions_low, 0);
  n.impressions_high = toInt(n.impressions_high, 0);
  if (n.platform === undefined || n.platform === null || n.platform === '') n.platform = 15;
  return n;
}

// ── INSERT ───────────────────────────────────────────────────────────────────────
async function insertPath(ctx, n, { translation }) {
  // Media gate: download the primary media up-front and REJECT the ad if the image
  // (IMAGE) or thumbnail (VIDEO) can't be fetched — we won't store a DefaultImage
  // placeholder. The bytes are reused after commit (no second download).
  const primaryUrl = n.image_video_url ?? n.ad_image;
  const fetched = await media.fetchPrimaryMedia(
    { type: n.type, imageUrl: primaryUrl, videoUrl: primaryUrl, thumbnailUrl: n.thumbnail_url },
    NETWORK,
  );
  if (!fetched.ok) {
    return rejected(422, fetched.reason === 'thumbnail'
      ? 'The video thumbnail could not be downloaded, so the ad was not inserted.'
      : 'The ad image could not be downloaded, so the ad was not inserted.', {
      field: fetched.reason === 'thumbnail' ? 'thumbnail_url' : 'image_video_url',
      hint: 'The source media URL is unreachable or expired — re-capture the ad with a fresh media URL and resend.',
    });
  }
  try {
    return await insertPathInner(ctx, n, { translation, fetched });
  } catch (err) {
    media.cleanupFetched(fetched); // free pre-downloaded temp bytes if the insert threw before they were consumed
    throw err;
  }
}

async function insertPathInner(ctx, n, { translation, fetched }) {
  const { db, log } = ctx;
  const sql = db.sql;

  // language detect (best-effort). Default 0 (= unknown / no language) when detection is
  // absent or fails — do NOT default to 1 (English); an undetected ad must stay language-less
  // so the read side returns null, not a misleading "English". Matches every other pipeline.
  let languageId = 0;
  let iso = null;
  if (translation?.detected_language) {
    iso = translation.detected_language;
    languageId = (await repo.getLanguageId(sql, iso)) || (await repo.insertLanguage(sql, iso, translation.language_name)) || 0;
  }
  if (translation?.call_to_action) n.call_to_action = translation.call_to_action;

  const finalImpression = n.impressions_high !== 0 ? Math.round((n.impressions_high + n.impressions_low) / 2) : 0;

  const result = await repo.withTransaction(sql, async (tx) => {
    const postOwnerId = await upsertPostOwner(tx, n, NETWORK, { skipImage: true });

    // page details
    if (!(await repo.libPageExists(tx, n.ad_id))) {
      await repo.insertLibPage(tx, {
        ...(n.page_details || {}),
        gender_details: JSON.stringify(n.gender ?? null),
        age_details: JSON.stringify(n.age ?? null),
        page_name: n.post_owner ?? null,
        platform_used: typeof n.ad_run_platforms === 'string' ? n.ad_run_platforms : JSON.stringify(n.ad_run_platforms ?? null),
        ad_id: n.ad_id,
        post_owner_id: postOwnerId,
        impression_low: n.impressions_low,
        impression_high: n.impressions_high,
        page_category: n.page_details?.page_category ?? null,
      });
    }

    let ctaId = 0;
    // instagram_ad.call_to_action_id is a NOT NULL FK with no id=0 sentinel (unlike facebook's
    // DEFAULT 0), so even a CTA-less ad must resolve to a real row — fall back to a '(none)' placeholder.
    const ctaText = n.call_to_action || '(none)';
    if (ctaText) {
      const c = await repo.getCallToAction(tx, ctaText);
      if (c.code === 200) { ctaId = c.data[0].id; await repo.bumpCallToActionCount(tx, ctaId); }
      else ctaId = await repo.insertCallToAction(tx, ctaText);
    }

    let categoryId = 0;
    const catName = n.page_details?.page_category;
    if (catName) {
      const cat = await repo.getCategory(tx, catName);
      categoryId = cat.code === 200 ? cat.data[0].id : await repo.insertCategory(tx, catName);
    }

    const countryOnly = await repo.upsertCountryOnly(tx, n.countryNames);

    let domainId = 0;
    // instagram_ad.domain_id is a NOT NULL FK with no id=0 sentinel row (unlike
    // facebook_ad.domain_id DEFAULT 0), so a domainless ad must resolve to a real
    // domain row. Use a stable placeholder so the FK is satisfied.
    const domain = extractDomain(n.destination_url) || '(none)';
    if (domain) {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    const adRow = buildLibraryAdRow(n, { ctaId, domainId, postOwnerId, categoryId, languageId, impression: finalImpression });
    const instagramAdId = await repo.insertInstagramAd(tx, adRow);
    if (!instagramAdId) { const e = new Error(`This ad_id "${n.ad_id}" already exists (duplicate).`); e.insertionCode = 402; throw e; }

    const variantId = await repo.insertVariant(tx, { instagram_ad_id: instagramAdId, title: n.ad_title, text: n.ad_text, newsfeed_description: n.news_feed_description, image_url_original: n.image_video_url ?? n.ad_image });
    const analyticsId = await repo.insertAnalytics(tx, { instagram_ad_id: instagramAdId, likes: 0, comments: 0, shares: 0, popularity: null, impression: finalImpression, date: today(), hits: 1, initial_url: n.initial_url ?? null });
    await repo.updateInstagramAd(tx, { default_variant_id: variantId, default_analytics_id: analyticsId }, instagramAdId);

    // cost-usage (audience/EUT)
    await repo.insertCostUsage(tx, {
      instagram_ad_id: instagramAdId,
      meta_ad_url: n.meta_ad_url ?? '',
      est_audience_size_low: toInt(n.est_audience_size_low),
      est_audience_size_high: toInt(n.est_audience_size_high),
      ad_run_platforms: typeof n.ad_run_platforms === 'string' ? n.ad_run_platforms : JSON.stringify(n.ad_run_platforms ?? null),
      EUT: n.EUT ?? null,
    }).catch(() => {});

    // meta_data
    if ((await repo.getMetaData(tx, instagramAdId)).code !== 200) {
      // initial_url now stored on instagram_ad_analytics (see insertAnalytics), not meta.
      await repo.insertMetaData(tx, { instagram_ad_id: instagramAdId, destination_url: n.destination_url ?? 'null', screenshot_url: 'processing.gif', platform: toInt(n.platform), ad_url: n.meta_ad_url ?? '' });
    }

    // child countries (array form)
    if (countryOnly.length) {
      await repo.insertAdCountries(tx, countryOnly.map((c) => ({ ...c, instagram_ad_id: instagramAdId, country_id: 0 })));
      await repo.insertAdCountriesOnly(tx, countryOnly.map((c) => ({ ...c, instagram_ad_id: instagramAdId })));
    }

    if (translation) {
      await repo.upsertTranslation(tx, { instagram_ad_id: instagramAdId, news_feed_description: translation.newsfeed_description ?? n.news_feed_description, ad_title: translation.title ?? n.ad_title, ad_text: translation.text ?? n.ad_text });
    }

    await repo.setLibPageAdId(tx, n.ad_id, instagramAdId).catch(() => {});
    return { instagramAdId, variantId, postOwnerId, finalImpression, iso };
  });

  if (!result.instagramAdId || result.instagramAdId <= 0) {
    return serverError(500, 'The ad could not be inserted (no id was generated).');
  }

  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, NETWORK).catch(() => null),
    uploadAdMediaAndSaveVariant(sql, n, result.instagramAdId, result.variantId, fetched),
  ]);
  result.mediaPaths = mediaPaths;

  await indexAd(ctx, result.instagramAdId, n, result).catch((e) => log.warn('ES index failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, result));

  const warning = media.mediaIssueWarning(mediaPaths, n.type);
  return ok(result.instagramAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE ───────────────────────────────────────────────────────────────────────
async function updatePath(ctx, n, { translation, existingId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const adId = existingId;
  const joined = await repo.getJoinedAd(sql, adId);
  const cur = joined[0] || {};

  const lastSeenEpoch = Math.floor(Date.parse(n.last_seen) / 1000) || Math.floor(Date.now() / 1000);
  const postEpoch = Math.floor(Date.parse(cur.post_date) / 1000) || lastSeenEpoch;
  const daysRunning = Math.max(1, Math.floor((lastSeenEpoch - postEpoch) / 86400));
  await repo.updateInstagramAd(sql, { last_seen: n.last_seen, days_running: daysRunning, hits: toInt(cur.hits) + 1 }, adId);

  if (n.verified === 1 || n.verified === '1') await repo.updatePostOwner(sql, { verified: 1 }, toInt(cur.post_owner_id)).catch(() => {});

  const countryOnly = await repo.upsertCountryOnly(sql, n.countryNames);
  if (countryOnly.length) await repo.upsertAdCountriesOnly(sql, countryOnly.map((c) => ({ ...c, instagram_ad_id: adId })));

  if (translation) {
    await repo.upsertTranslation(sql, { instagram_ad_id: adId, news_feed_description: translation.newsfeed_description ?? n.news_feed_description, ad_title: translation.title ?? n.ad_title, ad_text: translation.text ?? n.ad_text });
  }

  let mediaPaths = {};
  const storedImg = String(cur.image_url || '');
  if (!storedImg || storedImg.includes('DefaultImage')) {
    mediaPaths = await uploadAdMediaAndSaveVariant(sql, n, adId, null).catch(() => ({}));
  } else if (n.type === 'IMAGE') {
    // image already stored → still refresh the carousel (PHP update path stores other_multimedia)
    const om = parseOtherMultimedia(n.other_multimedia);
    if (om.present && om.images.length) {
      const mm = await media.uploadMultimedia(om.images, n.type, adId, NETWORK).catch(() => null);
      if (mm) { await repo.upsertAdImageVideo(sql, mm).catch(() => {}); mediaPaths.multimedia = mm; }
    }
  }

  // initial_url refresh on update (now on analytics, so existing ads populate too)
  if (n.initial_url) await repo.updateAnalyticsInitialUrl(sql, adId, n.initial_url).catch(() => {});

  const carryOver = await fetchCarryOver(ctx, adId);
  await deleteEsDoc(ctx, adId).catch(() => {});
  await indexAd(ctx, adId, n, { instagramAdId: adId, mediaPaths, carryOver, finalImpression: n.impressions_high !== 0 ? Math.round((n.impressions_high + n.impressions_low) / 2) : 0 }).catch((e) => log.warn('ES reindex failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, { instagramAdId: adId }));

  const warning = Object.keys(mediaPaths).length ? media.mediaIssueWarning(mediaPaths, n.type) : null;
  return updated(adId, warning);
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildLibraryAdRow(n, ids) {
  const adPosition = String(n.ad_position) === 'VIDEO FEED' ? 'VIDEOFEED' : n.ad_position;
  const row = {
    call_to_action_id: ids.ctaId || 0,
    domain_id: ids.domainId || 0,
    country_id: 0, country_only_id: 0,
    post_owner_id: ids.postOwnerId || 0,
    default_variant_id: 0, default_analytics_id: 0,
    post_date: n.post_date, first_seen: n.first_seen, last_seen: n.last_seen,
    source: 'desktop', days_running: 1, lower_age_seen: 18, upper_age_seen: 65,
    type: n.type, ad_id: n.ad_id, ad_position: adPosition,
    default_ad_url_id: 0, post_owner_updated: 0, language_id: ids.languageId || 0, variants_count: 0,
    l_c_s_status: 0, l_c_s_updated_date: nowDateTime(), status: 1,
    affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    hits: 1, impression: ids.impression || 0, category_id: ids.categoryId || 0,
    views: n.type === 'VIDEO' ? toInt(n.views) : 0,
    collation_id: n.collation_id ?? null,
  };
  return row;
}

// `fetched` (from media.fetchPrimaryMedia) is passed on the INSERT path so the primary
// media is uploaded from the already-downloaded temp bytes (no second download). The
// UPDATE path calls this without `fetched`, so it downloads as before.
async function uploadAdMediaAndSaveVariant(sql, n, adId, _variantId, fetched) {
  const out = {};
  const primaryUrl = n.image_video_url ?? n.ad_image;
  const om = parseOtherMultimedia(n.other_multimedia);
  // PHP: other_multimedia is stored ONLY for type IMAGE (VIDEO branch is commented out).
  const doMultimedia = n.type === 'IMAGE' && om.present && om.images.length;
  const [primary, multimedia] = await Promise.all([
    fetched
      ? media.storePrimaryFromTemp(fetched, adId, NETWORK)
      : n.type === 'VIDEO'
        ? Promise.all([media.uploadVideo(primaryUrl, adId, NETWORK).catch(() => null), media.uploadThumbnail(n.thumbnail_url, adId, NETWORK).catch(() => null)]).then(([vid, thumb]) => ({ vid, thumb }))
        : media.uploadImage(primaryUrl, adId, NETWORK).catch(() => null).then((img) => ({ img })),
    doMultimedia ? media.uploadMultimedia(om.images, n.type, adId, NETWORK).catch(() => null) : Promise.resolve(null),
  ]);
  if (fetched) {
    Object.assign(out, primary);
  } else if (n.type === 'VIDEO') {
    if (primary.vid) out.nas_video_url = primary.vid.drive_video_url;
    if (primary.thumb) out.image_url = primary.thumb.image_video_url;
  } else if (primary.img) { out.image_url = primary.img.image_video_url; out.new_nas_image_url = primary.img.nas_path; }
  if (out.image_url) await repo.updateVariantByAdId(sql, { image_url: out.image_url, image_url_original: primaryUrl }, adId).catch(() => {});
  if (multimedia) { out.multimedia = multimedia; await repo.upsertAdImageVideo(sql, multimedia).catch(() => {}); }
  return out;
}

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
    'instagram_page_details.data': n.page_details ?? null,
    'instagram_ad.impression': result.finalImpression ?? 0,
    'instagram_ad.views': toInt(n.views),
    'instagram_ad.location': n.location ?? null,
    'instagram_ad.status': 1,
    'instagram_ad.ad_category': n.page_details?.page_category ? [n.page_details.page_category] : [],
    'instagram_ad_translation.ad_text': n.ad_text ?? null,
    'instagram_ad_translation.news_feed_description': n.news_feed_description ?? null,
    image_url_original: n.image_video_url ?? n.ad_image ?? null,
    platform: toInt(n.platform),
  };
  if (n.meta_ad_id) extra.meta_ad_id = n.meta_ad_id;
  if (row.post_owner_image) extra['instagram_ad_post_owners.post_owner_image'] = row.post_owner_image;
  const otherMedia = mp.multimedia?.ad_image_video ?? row.ad_image_video;
  if (otherMedia) extra.othermedia = parseMaybeJson(otherMedia);
  if (n.type === 'VIDEO') { extra.thumbnail = mp.image_url ?? storedImg; extra.nas_video_url = mp.nas_video_url ?? null; }
  else extra.new_nas_image_url = mp.new_nas_image_url ?? mp.image_url ?? storedImg;

  const carryOver = result.carryOver || {};
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];

  const doc = buildSearchMixDoc(LIBRARY_INSERT_COLUMNS, row, { index: ES_INDEX, userCountries, adCountries, extra });
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
async function resolveCountryNames(sql, country) {
  if (!Array.isArray(country)) return country ? [country] : [];
  if (country.map(String).map((c) => c.toUpperCase()).includes('ALL')) return country;
  try {
    const list = country.filter(Boolean);
    if (!list.length) return country;
    const placeholders = list.map(() => '?').join(',');
    const r = await sql.query(`SELECT name FROM country_data WHERE instagram_country_iso IN (${placeholders})`, list);
    const names = (Array.isArray(r) ? r : []).map((row) => row.name).filter(Boolean);
    return names.length ? names : country;
  } catch { return country; }
}
function toDateTime(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (/^\d+$/.test(s)) return epochToDateTime(s);        // epoch → datetime
  return s;                                              // assume already 'YYYY-MM-DD HH:MM:SS'
}
function parseMaybeJson(v) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
function extractDomain(url) { if (!url) return ''; try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; } }
function buildAdgptPayload(n, result) { return { ad_id: n.ad_id, instagram_ad_id: result.instagramAdId, type: n.type, platform: toInt(n.platform) }; }

module.exports = { processAdsLibrary };
