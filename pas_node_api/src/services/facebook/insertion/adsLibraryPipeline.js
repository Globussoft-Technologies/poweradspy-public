'use strict';

/**
 * Facebook adsLibrary pipeline — port of adsDataController::adsLibraryInsert().
 * See docs/insertion/PHP-SPEC-adsLibrary.md. Reuses the same repository / media /
 * esDocBuilder as metaAds; only the Ad-Library-specific bits are here (lib page
 * detail, ISO→name countries, avg-impression, library field defaults).
 *
 * processAdsLibrary(ad, ctx) → { code, message, data? }. ctx = { db, log, network }.
 * INSERT writes happen inside ONE transaction, committed together (PHP awaited its
 * async pool after commit — we await before commit). ES + ADGPT run after commit.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateAdsLibrary } = require('./validate');
const { urldecode, parseOtherMultimedia } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver } = require('./esDocBuilder');
const { LIBRARY_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, epochToDateTime, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');

const ES_INDEX = 'search_mix';

async function processAdsLibrary(ad, ctx) {
  const { db, log, network = 'facebook' } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  // validation
  const v = validateAdsLibrary(ad);
  if (v.code !== 200) return v;

  // VIDEO thumbnail check
  if (ad.type === 'VIDEO' && (!ad.thumbnail_url || String(ad.thumbnail_url).trim() === '')) {
    return rejected(400, 'A video ad requires a thumbnail_url.', {
      field: 'thumbnail_url',
      hint: 'Include a non-empty thumbnail_url for VIDEO ads and resend.',
    });
  }

  // requested-status side effect
  if (ad.user_request_id && ad.user_request_value) {
    await updateRequestedStatus(sql, ad).catch((e) => log.warn('updateRequestedStatus failed', { error: e.message }));
  }

  // existence
  const existing = await repo.getAdByAdId(sql, ad.ad_id);

  // translation — BEST-EFFORT here (unlike metaAds where it is critical)
  const translation = await api.translate({
    call_to_action: ad.call_to_action ?? '',
    text: ad.ad_text ?? '',
    title: ad.ad_title ?? '',
    newsfeed_description: ad.news_feed_description ?? '',
  }).catch(() => ({ ok: false }));
  const tdata = translation.ok ? translation.data : null;

  const n = normalizeLibrary(ad);

  try {
    if (existing.code === 400) {
      return await insertPath(ctx, n, { translation: tdata, network });
    }
    return await updatePath(ctx, n, { translation: tdata, existingId: existing.data[0].id, network });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('adsLibrary pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── normalize (library-specific) ────────────────────────────────────────────────
function normalizeLibrary(ad) {
  const n = { ...ad };
  if (n.post_owner_image === 'null') n.post_owner_image = null;
  for (const f of ['destination_url', 'initial_url', 'ad_title', 'news_feed_description', 'ad_text', 'meta_ad_url', 'post_owner_image']) {
    if (n[f] !== undefined && n[f] !== null) n[f] = urldecode(n[f]);
  }
  if (typeof n.post_owner_image === 'string') n.post_owner_image = n.post_owner_image.replace(/=v1:/g, '=v1%3A');
  n.meta_ad_url = n.meta_ad_url ?? '';
  for (const f of ['ad_title', 'news_feed_description', 'ad_text']) {
    if (typeof n[f] === 'string') n[f] = n[f].replace(/&amp;/g, '&');
  }
  // dates: UNIX → datetime, default now
  n.first_seen = n.first_seen ? epochToDateTime(n.first_seen) : nowDateTime();
  n.last_seen = n.last_seen ? epochToDateTime(n.last_seen) : nowDateTime();
  n.post_date = n.post_date ? epochToDateTime(n.post_date) : n.first_seen;
  // numeric nulls
  if (n.meta_ad_id === undefined || n.meta_ad_id === null || n.meta_ad_id === '') n.meta_ad_id = null;
  n.views = toInt(n.views, 0);
  n.est_audience_size_low = toInt(n.est_audience_size_low, 0);
  n.est_audience_size_high = toInt(n.est_audience_size_high, 0);
  n.impressions_low = toInt(n.impressions_low, 0);
  n.impressions_high = toInt(n.impressions_high, 0);
  if (n.platform === undefined || n.platform === null || n.platform === '') n.platform = 15;
  return n;
}

// ── INSERT path ──────────────────────────────────────────────────────────────────
async function insertPath(ctx, n, { translation, network }) {
  // Media gate: download the primary media up-front and REJECT the ad if the image
  // (IMAGE) or thumbnail (VIDEO) can't be fetched — we won't store a DefaultImage
  // placeholder. The bytes are reused after commit (no second download).
  const primaryUrl = n.image_video_url ?? n.ad_image;
  const fetched = await media.fetchPrimaryMedia(
    { type: n.type, imageUrl: primaryUrl, videoUrl: primaryUrl, thumbnailUrl: n.thumbnail_url },
    network,
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
    return await insertPathInner(ctx, n, { translation, network, fetched });
  } catch (err) {
    media.cleanupFetched(fetched); // free pre-downloaded temp bytes if the insert threw before they were consumed
    throw err;
  }
}

async function insertPathInner(ctx, n, { translation, network, fetched }) {
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

  // country ISO → names (unless 'ALL')
  const countryNames = await resolveCountryNames(sql, n.country);

  // impression = avg(high, low); popularity null
  const finalImpression = avg(n.impressions_high, n.impressions_low);

  const result = await repo.withTransaction(sql, async (tx) => {
    // post owner row only — image upload deferred to after commit (parallel)
    const postOwnerId = await upsertPostOwner(tx, n, network, { skipImage: true });

    // lib page detail (Ad-Library specific)
    if (!(await repo.libPageExists(tx, n.ad_id))) {
      await repo.insertLibPage(tx, {
        ad_id: n.ad_id,
        post_owner_id: postOwnerId,
        gender_details: JSON.stringify(n.gender ?? null),
        age_details: JSON.stringify(n.age ?? null),
        page_name: n.post_owner ?? null,
        platform_used: typeof n.ad_run_platforms === 'string' ? n.ad_run_platforms : JSON.stringify(n.ad_run_platforms ?? null),
        impression_low: n.impressions_low,
        impression_high: n.impressions_high,
        page_category: n.page_details?.page_category ?? null,
      });
    }

    // cta
    let ctaId = 0;
    if (n.call_to_action) {
      const c = await repo.getCallToAction(tx, n.call_to_action);
      if (c.code === 200) { ctaId = c.data[0].id; await repo.bumpCallToActionCount(tx, ctaId); }
      else ctaId = await repo.insertCallToAction(tx, n.call_to_action);
    }

    // category (from page_category)
    let categoryId = 0;
    const catName = n.page_details?.page_category;
    if (catName) {
      const cat = await repo.getCategory(tx, catName);
      categoryId = cat.code === 200 ? cat.data[0].id : await repo.insertCategory(tx, catName);
    }

    // country_only
    const countryOnly = await repo.upsertCountryOnly(tx, countryNames);

    // domain
    let domainId = 0;
    const domain = extractDomain(n.destination_url);
    if (domain) {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    // facebook_ad row
    const adRow = buildLibraryAdRow(n, { ctaId, domainId, postOwnerId, categoryId, languageId, impression: finalImpression });
    const facebookAdId = await repo.insertFacebookAd(tx, adRow);
    if (!facebookAdId) {
      const e = new Error(`This ad_id "${n.ad_id}" already exists (duplicate).`);
      e.insertionCode = 402;
      e.insertionHint = 'No action needed unless you expected an update — the ad is already stored.';
      throw e;
    }

    // variant row only — media upload deferred to after commit (parallel)
    const variantId = await repo.insertVariant(tx, {
      facebook_ad_id: facebookAdId, title: n.ad_title, text: n.ad_text,
      newsfeed_description: n.news_feed_description, image_url_original: n.image_video_url ?? n.ad_image,
    });

    // analytics
    const analyticsId = await repo.insertAnalytics(tx, {
      facebook_ad_id: facebookAdId, likes: 0, comments: 0, shares: 0, popularity: null,
      impression: finalImpression, engagement_rate: 0, date: today(), hits: 1,
    });
    await repo.updateFacebookAd(tx, { default_variant_id: variantId, default_analytics_id: analyticsId }, facebookAdId);

    // budget
    if (n.meta_ad_id) {
      await repo.insertBudget(tx, { facebook_ad_id: facebookAdId, meta_ad_id: n.meta_ad_id, lowerBudget: n.lowerBudget, upperBudget: n.upperBudget });
    }

    // child rows: countries
    if (countryOnly.length) {
      // Library ads target many countries with no single city/state/country row,
      // so country_id stays NULL (matches PHP, which omits it). NULL — not 0 —
      // is required: facebook_ad_countries.index1 is UNIQUE(facebook_ad_id,
      // country_id), and MySQL allows multiple NULLs but only one literal 0,
      // so a 0 here collides ("Duplicate entry '<id>-0'") on the 2nd country.
      await repo.insertAdCountries(tx, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId, country_id: null })));
      await repo.insertAdCountriesOnly(tx, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId })));
    }

    // meta_data
    if ((await repo.getMetaData(tx, facebookAdId)).code !== 200) {
      await repo.insertMetaData(tx, {
        facebook_ad_id: facebookAdId,
        destination_url: n.destination_url ?? null,
        initial_url: n.initial_url ?? null,
        screenshot_url: 'processing.gif',
        platform: toInt(n.platform),
        firstSeenOnDesktop: nowDateTime(),
        meta_ad_url: n.meta_ad_url ?? '',
        est_audience_size_low: n.est_audience_size_low,
        est_audience_size_high: n.est_audience_size_high,
        active_status: n.active_status ?? null,
        ad_run_platforms: typeof n.ad_run_platforms === 'string' ? n.ad_run_platforms : JSON.stringify(n.ad_run_platforms ?? null),
        EUT: n.EUT ?? null,
      });
    }

    // translation
    if (translation) {
      await repo.upsertTranslation(tx, {
        facebook_ad_id: facebookAdId,
        news_feed_description: translation.newsfeed_description ?? n.news_feed_description,
        ad_title: translation.title ?? n.ad_title,
        ad_text: translation.text ?? n.ad_text,
      });
    }

    // back-reference lib page → facebook_ad_id
    await repo.setLibPageAdId(tx, n.ad_id, facebookAdId).catch(() => {});

    return { facebookAdId, variantId, postOwnerId, finalImpression, iso };
  });

  if (!result.facebookAdId || result.facebookAdId <= 0) {
    return serverError(500, 'The ad could not be inserted (no id was generated).', {
      hint: 'This is a server-side issue, not your data. Please retry.',
    });
  }

  // After commit: post-owner image + ad media (image/video + carousel) in PARALLEL, off the transaction.
  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, network).catch(() => null),
    uploadAdMediaAndSaveVariant(sql, n, result.facebookAdId, result.variantId, network, fetched),
  ]);
  result.mediaPaths = mediaPaths;

  await indexAd(ctx, result.facebookAdId, n, result, network).catch((e) => log.warn('ES index failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, result));

  const warning = media.mediaIssueWarning(mediaPaths, n.type);
  return ok(result.facebookAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE path ──────────────────────────────────────────────────────────────────
async function updatePath(ctx, n, { translation, existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const facebookAdId = existingId;

  const joined = await repo.getJoinedAd(sql, 'facebook_ad.id', facebookAdId);
  const cur = joined[0] || {};

  // last_seen / days_running / hits
  const lastSeenEpoch = Math.floor(Date.parse(n.last_seen) / 1000) || Math.floor(Date.now() / 1000);
  const postEpoch = Math.floor(Date.parse(cur.post_date) / 1000) || lastSeenEpoch;
  const daysRunning = Math.max(1, Math.floor((lastSeenEpoch - postEpoch) / 86400));
  await repo.updateFacebookAd(sql, { last_seen: n.last_seen, days_running: daysRunning, hits: toInt(cur.hits) + 1 }, facebookAdId);

  // post owner verified
  if (n.verified === 1 || n.verified === '1') {
    await repo.updatePostOwner(sql, { verified: 1 }, toInt(cur.post_owner_id)).catch(() => {});
  }

  // budget (new meta_ad_id)
  if (n.meta_ad_id && !(await repo.budgetExists(sql, n.meta_ad_id))) {
    await repo.insertBudget(sql, { facebook_ad_id: facebookAdId, meta_ad_id: n.meta_ad_id, lowerBudget: n.lowerBudget, upperBudget: n.upperBudget });
  }

  // country_only + countries_only upsert
  const countryNames = await resolveCountryNames(sql, n.country);
  const countryOnly = await repo.upsertCountryOnly(sql, countryNames);
  if (countryOnly.length) await repo.upsertAdCountriesOnly(sql, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId })));

  // translation
  if (translation) {
    await repo.upsertTranslation(sql, {
      facebook_ad_id: facebookAdId,
      news_feed_description: translation.newsfeed_description ?? n.news_feed_description,
      ad_title: translation.title ?? n.ad_title,
      ad_text: translation.text ?? n.ad_text,
    });
  }

  // meta initial_url refresh on update (so existing ads populate too)
  if (n.initial_url) await repo.updateMetaInitialUrl(sql, facebookAdId, n.initial_url).catch(() => {});

  const carryOver = await fetchCarryOver(ctx, facebookAdId);

  // Re-attempt the VIDEO on re-seen if the stored video is missing / DefaultImage (legacy DefaultImage.mp4).
  // Reads the old ES doc (carryOver); only when broken — a good video is left untouched (just stats). The
  // worker re-downloads + writes nas_video_url to ES. (Library update does no other media re-upload.)
  if (n.type === 'VIDEO' && (n.image_video_url ?? n.ad_image)) {
    const sv = String(carryOver.nas_video_url || '');
    if (!sv || sv.includes('DefaultImage')) {
      delete carryOver.nas_video_url;
      media.uploadVideo(n.image_video_url ?? n.ad_image, facebookAdId, network);
    }
  }
  await deleteEsDoc(ctx, facebookAdId).catch(() => {});
  await indexAd(ctx, facebookAdId, n, { facebookAdId, carryOver }, network).catch((e) => log.warn('ES reindex failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, { facebookAdId }));

  return updated(facebookAdId);
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildLibraryAdRow(n, ids) {
  const adPosition = String(n.ad_position) === 'VIDEO FEED' ? 'VIDEOFEED' : n.ad_position;
  const row = {
    call_to_action_id: ids.ctaId || 0,
    domain_id: ids.domainId || 0,
    country_id: 0,
    country_only_id: 0,
    post_owner_id: ids.postOwnerId || 0,
    default_variant_id: 0,
    default_analytics_id: 0,
    post_date: n.post_date, first_seen: n.first_seen, last_seen: n.last_seen,
    source: 'desktop',
    days_running: 1,
    lower_age_seen: 18, upper_age_seen: 65,
    type: n.type, platform: toInt(n.platform), ad_id: n.ad_id, ad_position: adPosition,
    default_ad_url_id: 0, post_owner_updated: 0, language_id: ids.languageId || 0,
    variants_count: 0, destination_scraper_status: 0, l_c_s_status: 0, l_c_s_updated_date: nowDateTime(),
    status: 1, affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    hits: 1, impression: ids.impression || 0,
    category_id: ids.categoryId || 0,
    collation_id: n.collation_id ?? null,
  };
  if (n.type === 'VIDEO') row.views = toInt(n.views); else row.views = 0;
  return row;
}

// `fetched` (from media.fetchPrimaryMedia) is passed on the INSERT path so the primary
// media is uploaded from the already-downloaded temp bytes (no second download).
async function uploadAdMedia(n, facebookAdId, network, fetched) {
  const out = {};
  const primaryUrl = n.image_video_url ?? n.ad_image;
  const om = parseOtherMultimedia(n.other_multimedia);

  const [primary, multimedia] = await Promise.all([
    fetched
      ? media.storePrimaryFromTemp(fetched, facebookAdId, network)
      : n.type === 'VIDEO'
        ? Promise.all([
            media.uploadVideo(primaryUrl, facebookAdId, network).catch(() => null),
            media.uploadThumbnail(n.thumbnail_url, facebookAdId, network).catch(() => null),
          ]).then(([vid, thumb]) => ({ vid, thumb }))
        : media.uploadImage(primaryUrl, facebookAdId, network).catch(() => null).then((img) => ({ img })),
    om.present && om.images.length
      ? media.uploadMultimedia(om.images, n.type, facebookAdId, network).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (fetched) {
    Object.assign(out, primary);
  } else if (n.type === 'VIDEO') {
    if (primary.vid) out.nas_video_url = primary.vid.drive_video_url;
    if (primary.thumb) out.image_url = primary.thumb.image_video_url;
  } else if (primary.img) {
    out.image_url = primary.img.image_video_url;
    out.new_nas_image_url = primary.img.nas_path;
  }
  if (multimedia) out.multimedia = multimedia;
  return out;
}

/** Upload ad media (after commit) + persist variant image_url + carousel images. */
async function uploadAdMediaAndSaveVariant(sql, n, facebookAdId, variantId, network, fetched) {
  const mediaPaths = await uploadAdMedia(n, facebookAdId, network, fetched);
  if (mediaPaths.image_url) {
    await repo.updateVariant(sql, { image_url: mediaPaths.image_url, image_url_original: n.image_video_url ?? n.ad_image }, variantId).catch(() => {});
  }
  if (mediaPaths.multimedia) await repo.upsertAdImageVideo(sql, mediaPaths.multimedia).catch(() => {});
  return mediaPaths;
}

async function indexAd(ctx, facebookAdId, n, result, network) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'facebook_ad.id', facebookAdId);
  const row = joined[0];
  if (!row) return;
  const userCountries = await repo.getUserCountries(db.sql, facebookAdId);
  const adCountries = await repo.getAdCountries(db.sql, facebookAdId);

  const extra = {
    lang_detect: (result.iso || '').toLowerCase(),
    'facebook_lib_page_details.data': n.page_details ?? null,
    'facbook_ad.impression': result.finalImpression ?? 0, // (sic) PHP key kept for parity
    'facebook_ad.impression': result.finalImpression ?? 0,
    'facebook_ad.location': n.location ?? null,
    'facebook_ad.status': 1,
    'facebook_ad.ad_category': n.page_details?.page_category ? [n.page_details.page_category] : [],
    platform: toInt(n.platform),
  };
  if (n.lowerBudget !== undefined || n.upperBudget !== undefined) {
    extra['facebook.averagebudget'] = avg(n.upperBudget, n.lowerBudget);
  }
  const mp = result.mediaPaths || {};
  const storedImg = row.image_url && !String(row.image_url).includes('DefaultImage') ? row.image_url : null;
  if (n.type === 'VIDEO') { extra.Thumbnail = mp.image_url ?? storedImg; extra['facebook_ad.views'] = toInt(n.views); extra.nas_video_url = mp.nas_video_url ?? null; }
  else { const img = mp.image_url ?? storedImg; extra['facebook_ad.s3_path'] = img; extra.new_nas_image_url = mp.new_nas_image_url ?? img; }
  if ((n.image_video_url ?? n.ad_image)) extra.image_url_original = n.image_video_url ?? n.ad_image;
  if (row.post_owner_image) extra['facebook_ad_post_owners.post_owner_image'] = row.post_owner_image;
  const otherMedia = result.mediaPaths?.multimedia?.ad_image_video ?? row.ad_image_video;
  if (otherMedia) extra.othermedia = parseMaybeJson(otherMedia);

  const carryOver = result.carryOver || {};
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];
  const doc = buildSearchMixDoc(LIBRARY_INSERT_COLUMNS, row, { index: ES_INDEX, userCountries, adCountries, extra });
  let _id;
  try { _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId))); } catch { /* ignore */ }
  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

async function deleteEsDoc(ctx, facebookAdId) {
  const { db } = ctx;
  if (!db.elastic) return;
  const _id = firstHitId(await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId)));
  if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
}

/** Read the old ES doc's cron-populated fields to carry over on UPDATE re-index. */
async function fetchCarryOver(ctx, facebookAdId) {
  const { db } = ctx;
  if (!db.elastic) return {};
  try {
    const found = await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId));
    return extractCarryOver(found, config.insertion.translationField);
  } catch { return {}; }
}

// ── small helpers ─────────────────────────────────────────────────────────────
async function resolveCountryNames(sql, country) {
  if (!Array.isArray(country)) return country ? [country] : [];
  if (country.map(String).map((c) => c.toUpperCase()).includes('ALL')) return country;
  const names = await repo.getNamesByIso(sql, country).catch(() => []);
  return names.length ? names : country;
}
function parseMaybeJson(v) {
  if (Array.isArray(v) || typeof v === 'object') return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}
function avg(a, b) {
  const x = toInt(a); const y = toInt(b);
  if (!x && !y) return 0;
  return Math.round((x + y) / 2);
}
function extractDomain(url) {
  if (!url) return '';
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function buildAdgptPayload(n, result) {
  return { ad_id: n.ad_id, facebook_ad_id: result.facebookAdId, type: n.type, platform: toInt(n.platform) };
}
async function updateRequestedStatus(sql, ad) {
  const r = await repo.getUserRequest(sql, ad.user_request_id);
  if (!r.length) return;
  const row = r[0];
  const code = toInt(ad.code);
  const codeToUpdate = code === 200 ? 1 : code === 400 ? 5 : 0;
  const colMap = { 1: 'keyword_status', 2: 'advertiser_status', 3: 'url_status' };
  const col = colMap[String(ad.user_request_value)];
  if (!col) return;
  if (toInt(row.sent_status) === 9) await repo.bumpMetaSyncCount(sql, ad.user_request_id);
  else if (toInt(row.sent_status) === 5) {
    if (codeToUpdate === 1) await repo.setSentStatus(sql, 6, ad.user_request_id);
    else if (codeToUpdate === 5) await repo.setSentStatus(sql, 7, ad.user_request_id);
  }
  await repo.setUserRequestColumn(sql, col, codeToUpdate, ad.user_request_id);
}

module.exports = { processAdsLibrary };
