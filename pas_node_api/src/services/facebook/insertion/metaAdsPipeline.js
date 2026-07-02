'use strict';

/**
 * Facebook metaAdsData pipeline — port of adsDataController::adsdata().
 * See docs/insertion/PHP-SPEC-metaAdsData.md for the authoritative behaviour.
 *
 * processMetaAd(ad, ctx) handles ONE ad and returns { code, message, data? }.
 * ctx = { db:{sql,elastic}, log, network }. The InsertionEngine batches/parallelizes.
 *
 * Faithful-but-fixed: all DB writes for the INSERT path happen inside ONE
 * transaction and are committed together (PHP committed early + did async work
 * after — we await everything before commit). ES indexing + ADGPT run after commit.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateMetaAds } = require('./validate');
const { normalizeMetaAds, parseOtherMultimedia, checkVersion } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery, firstHitId, extractCarryOver } = require('./esDocBuilder');
const { META_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, epochToDateTime, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');

const ES_INDEX = 'search_mix';

async function processMetaAd(ad, ctx) {
  const { db, log, network = 'facebook' } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  // 1. ad_id null guard
  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', {
      field: 'ad_id',
      hint: 'Add the platform ad_id to the payload and resend. Without it the ad cannot be identified or de-duplicated.',
    });
  }

  // 2. validation (skipped when socionator == 1)
  const socionator = toInt(ad.socionator, 0);
  if (socionator !== 1) {
    const v = validateMetaAds(ad);
    if (v.code !== 200) return v;
  }

  // 3. VIDEO LCS + thumbnail checks
  if (ad.type === 'VIDEO') {
    const lcs = toInt(ad.likes) + toInt(ad.comment) + toInt(ad.share);
    if (lcs > toInt(ad.views)) {
      return rejected(404, `Likes+comments+shares (${lcs}) cannot exceed views (${toInt(ad.views)}) for a video ad.`, {
        field: 'views',
        hint: 'Send the correct `views` count (must be ≥ likes+comment+share), then resend.',
      });
    }
    if (!ad.thumbnail_url || String(ad.thumbnail_url).trim() === '') {
      return rejected(400, 'A video ad requires a thumbnail_url.', {
        field: 'thumbnail_url',
        hint: 'Include a non-empty thumbnail_url for VIDEO ads and resend.',
      });
    }
  }

  // 4. requested-status side effect
  if (ad.user_request_id && ad.user_request_value) {
    await updateRequestedStatus(sql, ad).catch((e) => log.warn('updateRequestedStatus failed', { error: e.message }));
  }

  // 7. version checks
  const versionErr = checkVersion(ad.platform, ad.version);
  if (versionErr) return versionErr;

  // 9-11. user resolve + existence + translation run in PARALLEL (independent):
  //   - resolveUser / getAdByAdId hit the DB pool (separate connections)
  //   - translate is an external HTTP call
  const [userRes, existing, translation] = await Promise.all([
    resolveUser(sql, ad, log),
    repo.getAdByAdId(sql, ad.ad_id),
    api.translate({
      call_to_action: ad.call_to_action ?? '',
      text: ad.ad_text ?? '',
      title: ad.ad_title ?? '',
      newsfeed_description: ad.news_feed_description ?? '',
    }).catch(() => ({ ok: false })),
  ]);
  if (userRes.code !== 200) return userRes;
  const userId = userRes.userId;

  // Translation is best-effort here, matching facebook's own adsLibrary pipeline
  // (adsLibraryPipeline.js) and the instagram pipeline: a slow/down translation
  // upstream must NOT 503 the insert — we store the ORIGINAL copy instead. The
  // downstream upsertTranslation already falls back to n.ad_title/ad_text/etc.
  // when translationData is null, so the only effect is "no translated copy".
  const translationData = translation.ok ? translation.data : null;

  // 14. branch
  try {
    if (existing.code === 400) {
      return await insertPath(ctx, ad, { userId, translation: translationData, network });
    }
    return await updatePath(ctx, ad, { userId, translation: translationData, existingId: existing.data[0].id, network });
  } catch (err) {
    // typed business failures (e.g. duplicate) carry insertionCode
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('metaAds pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── Discovering user resolution (PHP lines 284-333) ─────────────────────────────
async function resolveUser(sql, ad, log) {
  if (ad.facebook_id) {
    const u = await repo.getUserByFacebookId(sql, ad.facebook_id);
    if (u.code !== 200) {
      return rejected(401, `The facebook_id "${ad.facebook_id}" is not registered as a discovering user.`, {
        field: 'facebook_id',
        hint: 'Send a facebook_id that exists in facebook_users, or register it first. The ad was not inserted because its discovering user is unknown.',
      });
    }
    const row = u.data[0];
    if (String(ad.platform) === '11' && String(row.ads_info_status) !== '11') {
      await repo.updateUser(sql, { ads_info_status: 11 }, ad.facebook_id).catch(() => {});
    }
    return { code: 200, userId: row.id };
  }
  // platform 3: resolve a facebook_id by country
  if (String(ad.platform) === '3') {
    const fbId = await repo.getUserFacebookIdByCountry(sql, ad.country);
    if (fbId) {
      const u = await repo.getUserByFacebookId(sql, fbId);
      if (u.code === 200) return { code: 200, userId: u.data[0].id, userIdStatus: true };
    }
    return rejected(401, 'No discovering user found for the given country (platform 3).', {
      field: 'country',
      hint: 'Provide a country that maps to a known facebook_users row, or send an explicit facebook_id.',
    });
  }
  return rejected(400, 'Missing facebook_id — the discovering user is required.', {
    field: 'facebook_id',
    hint: 'Include facebook_id in the payload (or use platform 3 with a resolvable country).',
  });
}

// ── INSERT path (PHP 371-1613) ──────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { userId, translation, network }) {
  const n = normalizeMetaAds(rawAd);

  // Media gate: download the primary media up-front and REJECT the ad if the image
  // (IMAGE) or thumbnail (VIDEO) can't be fetched — we won't store a DefaultImage
  // placeholder. The bytes are reused after commit (no second download); cleaned up
  // by storePrimaryFromTemp on success, or by cleanupFetched on any error/reject path.
  const fetched = await media.fetchPrimaryMedia(
    { type: n.type, imageUrl: n.image_video_url, videoUrl: n.image_video_url, thumbnailUrl: n.thumbnail_url },
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
    return await insertPathInner(ctx, n, { userId, translation, network, fetched });
  } catch (err) {
    media.cleanupFetched(fetched); // free pre-downloaded temp bytes if the insert threw before they were consumed
    throw err;
  }
}

async function insertPathInner(ctx, n, { userId, translation, network, fetched }) {
  const { db, log } = ctx;
  const sql = db.sql;

  // language detect (skipped in dev, like PHP APP_ENV check)
  let languageId = 0;
  let iso = null;
  if (!config.isDev && translation?.detected_language) {
    iso = translation.detected_language;
    languageId = (await repo.getLanguageId(sql, iso)) || (await repo.insertLanguage(sql, iso, translation.language_name));
  }
  // CTA translation override
  if (translation?.call_to_action) n.call_to_action = translation.call_to_action;

  // impression + popularity (external; throws → caught by caller)
  const isoList = await repo.getIsoByNames(sql, n.country).catch(() => []);
  const metricsParams = {
    ad_running_days: 1,
    ad_call_to_action: n.call_to_action ?? '',
    ad_iso: isoList,
    ad_type: n.type,
    ad_position: n.ad_position,
    ad_likes: toInt(n.likes), ad_comments: toInt(n.comment), ad_shares: toInt(n.share), ad_views: toInt(n.views),
  };
  // impression + popularity run in parallel (independent external calls)
  const [imp, pop] = await Promise.all([
    ad_impression(n) ? Promise.resolve(ad_impression(n)) : api.impression(metricsParams),
    api.popularity(metricsParams),
  ]);

  const result = await repo.withTransaction(sql, async (tx) => {
    // post owner row only — the image upload is deferred and runs after commit, in parallel
    const postOwnerId = await upsertPostOwner(tx, n, network, { skipImage: true });

    // call_to_action
    let ctaId = 0;
    if (n.call_to_action) {
      const c = await repo.getCallToAction(tx, n.call_to_action);
      if (c.code === 200) { ctaId = c.data[0].id; await repo.bumpCallToActionCount(tx, ctaId); }
      else ctaId = await repo.insertCallToAction(tx, n.call_to_action);
    }

    // category
    let categoryId = 0;
    if (n.category) {
      const cat = await repo.getCategory(tx, n.category);
      categoryId = cat.code === 200 ? cat.data[0].id : await repo.insertCategory(tx, n.category);
    }

    // country_only + country
    const countryOnly = await repo.upsertCountryOnly(tx, n.country);
    const countryOnlyId = countryOnly[0]?.country_only_id ?? null;
    let countryId = 0;
    const cExisting = await repo.getCountry(tx, { city: n.city, state: n.state, country: arr1(n.country) });
    countryId = cExisting.code === 200
      ? cExisting.data[0].id
      : await repo.insertCountry(tx, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId });

    // domain
    let domainId = 0;
    const domain = extractDomain(n.destination_url);
    if (domain) {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    // facebook_ad row
    const adRow = buildFacebookAdRow(n, {
      categoryId, ctaId, domainId, countryId, countryOnlyId, postOwnerId, userId, languageId,
      impression: imp.impression, popularity: popToSql(pop),
    });
    const facebookAdId = await repo.insertFacebookAd(tx, adRow);
    if (!facebookAdId) {
      const e = new Error(`This ad_id "${n.ad_id}" already exists (duplicate).`);
      e.insertionCode = 402;
      e.insertionHint = 'No action needed unless you expected an update — the ad is already stored.';
      throw e;
    }

    // budget
    if (n.meta_ad_id) {
      await repo.insertBudget(tx, { facebook_ad_id: facebookAdId, meta_ad_id: n.meta_ad_id, lowerBudget: n.lowerBudget, upperBudget: n.upperBudget });
    }

    // variant row only — media upload is deferred to after commit (runs in parallel)
    const variantId = await repo.insertVariant(tx, {
      facebook_ad_id: facebookAdId, title: n.ad_title, text: n.ad_text,
      newsfeed_description: n.news_feed_description, image_url_original: n.image_video_url,
    });

    // analytics
    const analyticsId = await repo.insertAnalytics(tx, {
      facebook_ad_id: facebookAdId, likes: toInt(n.likes), comments: toInt(n.comment), shares: toInt(n.share),
      popularity: popToSql(pop), impression: imp.impression, engagement_rate: imp.engagement_rate, date: today(), hits: 1,
    });

    // default variant/analytics back-references
    await repo.updateFacebookAd(tx, { default_variant_id: variantId, default_analytics_id: analyticsId }, facebookAdId);

    // comments
    if (n.comments_data) await repo.insertComment(tx, facebookAdId, n.comments_data);

    // child rows: countries
    if (countryOnly.length) {
      await repo.insertAdCountries(tx, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId, country_id: countryId })));
      await repo.insertAdCountriesOnly(tx, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId })));
    }

    // ad_users
    await upsertAdUser(tx, facebookAdId, userId, n.platform);

    // meta_data
    await insertMetaData(tx, n, facebookAdId);

    // translation
    await repo.upsertTranslation(tx, {
      facebook_ad_id: facebookAdId,
      news_feed_description: translation?.newsfeed_description ?? n.news_feed_description,
      ad_title: translation?.title ?? n.ad_title,
      ad_text: translation?.text ?? n.ad_text,
    });

    // platform 10 activity log
    if (String(n.platform) === '10' && n.system_id) {
      await repo.insertAccountActivity(tx, { system_id: n.system_id, facebook_ad_id: facebookAdId, platform: 10, is_unique: 1 }).catch(() => {});
    }

    return { facebookAdId, variantId, postOwnerId, imp, pop, iso };
  });

  // After commit: media uploads run in PARALLEL (post-owner image + ad image/video),
  // off the transaction connection. This is the biggest latency win.
  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, network).catch(() => null),
    uploadAdMediaAndSaveVariant(sql, n, result.facebookAdId, result.variantId, network, fetched),
  ]);
  result.mediaPaths = mediaPaths;

  // ES index + ADGPT (non-transactional)
  await indexAd(ctx, result.facebookAdId, n, result, network).catch((e) => log.warn('ES index failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, result));

  const warning = media.mediaIssueWarning(mediaPaths, n.type);
  return ok(result.facebookAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

/** Upload ad media (after commit) and persist variant image_url. Returns the media paths. */
async function uploadAdMediaAndSaveVariant(sql, n, facebookAdId, variantId, network, fetched) {
  const mediaPaths = await uploadAdMedia(n, facebookAdId, network, fetched);
  if (mediaPaths.image_url) {
    await repo.updateVariant(sql, { image_url: mediaPaths.image_url, image_url_original: n.image_video_url }, variantId).catch(() => {});
  }
  // persist carousel / other-multimedia into facebook_ad_image_video
  if (mediaPaths.multimedia) await repo.upsertAdImageVideo(sql, mediaPaths.multimedia).catch(() => {});
  return mediaPaths;
}

// ── UPDATE path (PHP 1615-2463) ─────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { userId, translation, existingId, network }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeMetaAds(rawAd);
  const facebookAdId = existingId;

  // joined row for current values
  const joined = await repo.getJoinedAd(sql, 'facebook_ad.id', facebookAdId);
  const cur = joined[0] || {};

  // ── country (city/state/country) upsert ──
  if (n.city || n.state || (Array.isArray(n.country) && n.country.length)) {
    const existingC = await repo.getCountry(sql, { city: n.city, state: n.state, country: arr1(n.country) });
    if (existingC.code !== 200) {
      const countryOnlyId = (await repo.upsertCountryOnly(sql, n.country))[0]?.country_only_id ?? null;
      await repo.insertCountry(sql, { city: n.city, state: n.state, country: n.country, country_only_id: countryOnlyId }).catch(() => {});
    }
  }

  // ── media: re-upload only if the stored image is missing / DefaultImage ──
  const mediaPaths = await reuploadMediaIfNeeded(cur, n, facebookAdId, network);
  if (mediaPaths.image_url) {
    await repo.updateVariantByAdId(sql, { image_url: mediaPaths.image_url, image_url_original: n.image_video_url }, facebookAdId).catch(() => {});
  } else if (n.type === 'VIDEO') {
    // PHP always refreshes the original for video
    await repo.updateVariantByAdId(sql, { image_url_original: n.image_video_url }, facebookAdId).catch(() => {});
  }

  // ── last_seen / days_running ──
  const lastSeenEpoch = toInt(n.last_seen) || Math.floor(Date.now() / 1000);
  const daysRunning = computeDaysRunning(cur.first_seen ?? cur.post_date, lastSeenEpoch);
  // post_date write-once backfill: set only if DB has none and the crawler now sends a real one.
  const curPostEpoch = Date.parse(cur.post_date);
  const backfillPostDate = !(Number.isFinite(curPostEpoch) && curPostEpoch > 0) && n.post_date;
  await repo.updateFacebookAd(sql, {
    last_seen: epochToDateTime(lastSeenEpoch),
    days_running: daysRunning,
    ...(backfillPostDate ? { post_date: epochToDateTime(n.post_date) } : {}),
  }, facebookAdId);

  // ── post_owner verified ──
  if ((n.verified === 1 || n.verified === '1') && toInt(cur.post_owner_id)) {
    await repo.updatePostOwner(sql, { verified: 1 }, toInt(cur.post_owner_id)).catch(() => {});
  }

  // ── analytics (last-row tolerance → update today's row OR insert a new one) + facebook_ad LCS ──
  if (String(n.platform) !== '11' && ['FEED', 'VIDEOFEED', 'SIDE'].includes(String(n.ad_position).replace(/\s/g, '').toUpperCase())) {
    await updateAnalyticsAndAd(sql, facebookAdId, n, daysRunning);
  }

  // ── budget (new meta_ad_id) ──
  if (n.meta_ad_id && !(await repo.budgetExists(sql, n.meta_ad_id))) {
    await repo.insertBudget(sql, { facebook_ad_id: facebookAdId, meta_ad_id: n.meta_ad_id, lowerBudget: n.lowerBudget, upperBudget: n.upperBudget });
  }

  // ── hits (PHP: recompute from analytics when hits is 0/1, else +1) ──
  const curHits = toInt(cur.hits);
  const hits = (curHits === 0 || curHits === 1) ? await repo.sumHits(sql, facebookAdId) : curHits + 1;
  await repo.updateFacebookAd(sql, { hits }, facebookAdId).catch(() => {});

  // ── ad_users count (+ userid_status for platform 3) ──
  if (userId) await upsertAdUser(sql, facebookAdId, userId, n.platform);

  // ── meta built_with_status = 4 when no destination_url ──
  if (!n.destination_url) await repo.updateMetaBuiltWith(sql, facebookAdId, 4).catch(() => {});

  // ── meta initial_url refresh on update (so existing ads populate too) ──
  if (n.initial_url) await repo.updateMetaInitialUrl(sql, facebookAdId, n.initial_url).catch(() => {});

  // ── country_only + countries_only upsert ──
  const countryOnly = await repo.upsertCountryOnly(sql, n.country);
  if (countryOnly.length) await repo.upsertAdCountriesOnly(sql, countryOnly.map((c) => ({ ...c, facebook_ad_id: facebookAdId })));

  // ── translation ──
  await repo.upsertTranslation(sql, {
    facebook_ad_id: facebookAdId,
    news_feed_description: translation?.newsfeed_description ?? n.news_feed_description,
    ad_title: translation?.title ?? n.ad_title,
    ad_text: translation?.text ?? n.ad_text,
  });

  // ── ES: carry over cron-populated fields from the old doc, then delete + re-index ──
  const carryOver = await fetchCarryOver(ctx, facebookAdId);

  // Re-attempt the VIDEO on re-seen if the stored video is missing / DefaultImage (e.g. legacy
  // DefaultImage.mp4). Reads the old ES doc (carryOver); only when the image gate didn't already
  // re-upload, and only when broken — a good video is left untouched (just stats, no re-download). The
  // background download-queue re-downloads + writes nas_video_url to ES (no SQL schema change).
  if (n.type === 'VIDEO' && n.image_video_url && !Object.keys(mediaPaths).length) {
    const sv = String(carryOver.nas_video_url || '');
    if (!sv || sv.includes('DefaultImage')) {
      delete carryOver.nas_video_url;                // don't re-persist the placeholder on reindex
      media.uploadVideo(n.image_video_url, facebookAdId, network);
    }
  }

  await deleteEsDoc(ctx, facebookAdId).catch(() => {});
  await indexAd(ctx, facebookAdId, n, { facebookAdId, mediaPaths, carryOver }, network).catch((e) => log.warn('ES reindex failed', { error: e.message }));
  api.adgptInsert(buildAdgptPayload(n, { facebookAdId }));

  // Only warn if we actually attempted a re-upload that failed; an empty mediaPaths
  // means the existing image was already stored fine (no re-upload needed).
  const warning = Object.keys(mediaPaths).length ? media.mediaIssueWarning(mediaPaths, n.type) : null;
  return updated(facebookAdId, warning);
}

/**
 * Update the latest analytics row (or insert a new one for a new day), applying
 * PHP's 10% tolerance, then push the resulting LCS / impression / popularity onto
 * facebook_ad. Faithful to adsdata() lines 1963-2099.
 */
async function updateAnalyticsAndAd(sql, facebookAdId, n, daysRunning) {
  const last = await repo.getLastAnalytics(sql, facebookAdId);
  const row = last.code === 200 ? last.data[0] : null;

  // tolerance: accept the new value if it's within -10% of the stored value or higher
  const tol = (incoming, stored) => (toInt(incoming) >= stored - stored / 10 ? toInt(incoming) : stored);
  const likes = row ? tol(n.likes, toInt(row.likes)) : toInt(n.likes);
  const comments = row ? tol(n.comment, toInt(row.comments)) : toInt(n.comment);
  const shares = row ? tol(n.share, toInt(row.shares)) : toInt(n.share);

  // impression + popularity (external; tolerate failure)
  const isoList = await repo.getIsoByNames(sql, n.country).catch(() => []);
  const metrics = {
    ad_running_days: daysRunning, ad_call_to_action: n.call_to_action ?? '', ad_iso: isoList,
    ad_type: n.type, ad_position: n.ad_position,
    ad_likes: likes, ad_comments: comments, ad_shares: shares, ad_views: toInt(n.views),
  };
  const imp = await api.impression(metrics).catch(() => ({ impression: 0, engagement_rate: 0 }));
  const pop = await api.popularity(metrics).catch(() => null);

  const todayStr = today();
  const dbDate = row ? String(row.date).slice(0, 10) : null;
  let analyticsId;

  if (row && dbDate && todayStr <= dbDate) {
    // same/most-recent day → update the last row
    analyticsId = row.id;
    await repo.updateAnalytics(sql, {
      likes, comments, shares, hits: toInt(row.hits) + 1,
      impression: imp.impression, popularity: popToSql(pop), engagement_rate: imp.engagement_rate,
    }, analyticsId);
  } else {
    // new day → insert a fresh row
    analyticsId = await repo.insertAnalytics(sql, {
      facebook_ad_id: facebookAdId, likes, comments, shares,
      impression: imp.impression, popularity: popToSql(pop), engagement_rate: imp.engagement_rate,
      date: todayStr, hits: 1,
    });
  }

  // push LCS / impression / popularity / default_analytics_id (+ views for VIDEO) onto facebook_ad
  const adUpdate = {
    likes, comments, shares, impression: imp.impression,
    popularity: popToSql(pop), default_analytics_id: analyticsId,
  };
  if (n.type === 'VIDEO') adUpdate.views = toInt(n.views);
  await repo.updateFacebookAd(sql, adUpdate, facebookAdId).catch(() => {});
}

/** Re-upload ad media only when the stored image is missing or a DefaultImage placeholder. */
async function reuploadMediaIfNeeded(cur, n, facebookAdId, network) {
  const stored = String(cur.image_url || '');
  const needs = !stored || stored.includes('DefaultImage');
  if (!needs) return {};
  return uploadAdMedia(n, facebookAdId, network);
}

// ── building blocks ─────────────────────────────────────────────────────────────

function buildFacebookAdRow(n, ids) {
  const adPosition = String(n.ad_position) === 'VIDEO FEED' ? 'VIDEOFEED' : n.ad_position;
  const row = {
    category_id: ids.categoryId || 0,
    call_to_action_id: ids.ctaId || 0,
    domain_id: ids.domainId || 0,
    country_id: ids.countryId || 0,
    country_only_id: ids.countryOnlyId || 0,
    post_owner_id: ids.postOwnerId || 0,
    default_variant_id: 0,
    default_analytics_id: 0,
    discoverer_user_id: ids.userId || 0,
    likes: toInt(n.likes), comments: toInt(n.comment), shares: toInt(n.share),
    source: n.source ?? 'desktop',
    // facebook_ad.post_date/first_seen/last_seen are DATETIME columns → store as 'YYYY-MM-DD HH:MM:SS'
    post_date: n.post_date ? epochToDateTime(n.post_date) : null, first_seen: epochToDateTime(n.first_seen), last_seen: epochToDateTime(n.last_seen),
    days_running: 1,
    lower_age_seen: n.lower_age ?? null, upper_age_seen: n.upper_age ?? null,
    type: n.type, platform: toInt(n.platform), ad_id: n.ad_id, ad_position: adPosition,
    default_ad_url_id: 0, post_owner_updated: 0, language_id: ids.languageId || 0,
    variants_count: 0, destination_scraper_status: 0, l_c_s_status: 0, l_c_s_updated_date: nowDateTime(),
    status: toInt(n.status, 1), affiliate_ad: 0, redirect_destination_url_source: 0, reward_status: 0,
    hits: 1, impression: ids.impression || 0, proxy_status: n.country_status ?? null, popularity: ids.popularity,
  };
  if (n.type === 'VIDEO') row.views = toInt(n.views);
  if (String(n.platform) === '10' && n.system_id) row.System_id = n.system_id;
  return row;
}

async function upsertAdUser(tx, facebookAdId, userId, platform) {
  const existing = await repo.getAdUser(tx, facebookAdId, userId);
  if (existing.code === 200) {
    await repo.bumpAdUserCount(tx, existing.data[0].id);
    if (String(platform) === '3') await repo.setAdUserIdStatus(tx, existing.data[0].id, 1);
    return existing.data[0].id;
  }
  const id = await repo.insertAdUser(tx, { facebook_ad_id: facebookAdId, user_id: userId, count: 1, platform: toInt(platform) });
  if (String(platform) === '3') await repo.setAdUserIdStatus(tx, id, 1);
  return id;
}

async function insertMetaData(tx, n, facebookAdId) {
  const exists = await repo.getMetaData(tx, facebookAdId);
  if (exists.code === 200) return;
  const builtWithStatus = n.destination_url ? 0 : 4;
  await repo.insertMetaData(tx, {
    facebook_ad_id: facebookAdId,
    destination_url: n.destination_url ?? null,
    initial_url: n.initial_url ?? null,
    built_with_status: builtWithStatus,
    firstSeenOnDesktop: sourceIs(n, 'desktop') ? nowDateTime() : null,
    firstSeenOnAndroid: sourceIs(n, 'android') ? nowDateTime() : null,
    firstSeenOnIos: sourceIs(n, 'ios') ? nowDateTime() : null,
    screenshot_url: 'processing.gif',
    platform: toInt(n.platform),
    ad_url: n.ad_url ?? null,
    version: n.version ?? null,
    lcs_status: 5,
  });
}

// `fetched` (from media.fetchPrimaryMedia) is passed on the INSERT path so the primary
// media is uploaded from the already-downloaded temp bytes (no second download). The
// UPDATE path calls this without `fetched`, so it downloads as before.
async function uploadAdMedia(n, facebookAdId, network, fetched) {
  const out = {};
  const om = parseOtherMultimedia(n.other_multimedia);

  // primary media + carousel/other-multimedia run in PARALLEL
  const [primary, multimedia] = await Promise.all([
    fetched
      ? media.storePrimaryFromTemp(fetched, facebookAdId, network)
      : n.type === 'VIDEO'
        ? Promise.all([
            media.uploadVideo(n.image_video_url, facebookAdId, network).catch(() => null),
            media.uploadThumbnail(n.thumbnail_url, facebookAdId, network).catch(() => null),
          ]).then(([vid, thumb]) => ({ vid, thumb }))
        : media.uploadImage(n.image_video_url, facebookAdId, network).catch(() => null).then((img) => ({ img })),
    om.present && om.images.length
      ? media.uploadMultimedia(om.images, n.type, facebookAdId, network).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (fetched) {
    // storePrimaryFromTemp already returns the mapped { image_url, new_nas_image_url } /
    // { nas_video_url, image_url } shape.
    Object.assign(out, primary);
  } else if (n.type === 'VIDEO') {
    if (primary.vid) out.nas_video_url = primary.vid.drive_video_url;
    if (primary.thumb) out.image_url = primary.thumb.image_video_url;
  } else if (primary.img) {
    out.image_url = primary.img.image_video_url;
    out.new_nas_image_url = primary.img.nas_path;
  }
  if (multimedia) out.multimedia = multimedia; // persisted by the caller into facebook_ad_image_video
  return out;
}

// ── ES indexing ─────────────────────────────────────────────────────────────────
async function indexAd(ctx, facebookAdId, n, result, network) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'facebook_ad.id', facebookAdId);
  const row = joined[0];
  if (!row) return;

  const userCountries = await repo.getUserCountries(db.sql, facebookAdId);
  const adCountries = await repo.getAdCountries(db.sql, facebookAdId);

  const extra = buildEsExtra(n, result, row);
  // fill in cron-populated fields carried over from the old doc (UPDATE) without overriding fresh values
  const carryOver = result.carryOver || {};
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];
  const doc = buildSearchMixDoc(META_INSERT_COLUMNS, row, { index: ES_INDEX, userCountries, adCountries, extra });

  // de-dup: reuse existing _id if a doc already exists for this ad
  let _id;
  try {
    const found = await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId));
    _id = firstHitId(found);
  } catch { /* ignore */ }

  await db.elastic.index({ index: doc.index, type: doc.type, id: _id || undefined, body: doc.body });
}

function buildEsExtra(n, result, row = {}) {
  // Fall back to the image already stored on the variant (joined row) when we
  // didn't freshly upload this time (e.g. UPDATE path with the image already on NAS),
  // so the ES doc never loses the image.
  const storedImg = row.image_url && !String(row.image_url).includes('DefaultImage') ? row.image_url : null;
  const mp = result.mediaPaths || {};
  const extra = { lang_detect: (result.iso || '').toLowerCase(), platform: toInt(n.platform), 'facebook_ad.impression': result.imp?.impression ?? 0 };
  if (n.type === 'VIDEO') {
    extra.Thumbnail = mp.image_url ?? storedImg;
    extra['facebook_ad.views'] = toInt(n.views);
    extra.nas_video_url = mp.nas_video_url ?? null;
  } else {
    const img = mp.image_url ?? storedImg;
    extra['facebook_ad.s3_path'] = img;
    extra.new_nas_image_url = mp.new_nas_image_url ?? img;
  }
  if (result.pop) extra['facebook_ad.popularity'] = result.pop;
  if (result.imp?.engagement_rate !== undefined) extra.engagement_rate = result.imp.engagement_rate;
  // post owner image (stored NAS path from the joined row) so search results can show it
  if (row.post_owner_image) extra['facebook_ad_post_owners.post_owner_image'] = row.post_owner_image;
  // carousel / other multimedia → ES `othermedia` (PHP _source['othermedia']); fresh upload else stored
  const otherMedia = result.mediaPaths?.multimedia?.ad_image_video ?? row.ad_image_video;
  if (otherMedia) extra.othermedia = parseMaybeJson(otherMedia);
  if (n.image_video_url) extra.image_url_original = n.image_video_url;
  if (n.category_id) extra.category_id = n.category_id;
  if (n.subcategory_id) extra.subcategory_id = n.subcategory_id;
  return extra;
}

async function deleteEsDoc(ctx, facebookAdId) {
  const { db } = ctx;
  if (!db.elastic) return;
  const found = await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId));
  const _id = firstHitId(found);
  if (_id) await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: _id });
}

/** Read the old ES doc's cron-populated fields (outgoing links, url redirects, translations, nas_video_url). */
async function fetchCarryOver(ctx, facebookAdId) {
  const { db } = ctx;
  if (!db.elastic) return {};
  try {
    const found = await db.elastic.search(searchIdQuery(ES_INDEX, facebookAdId));
    return extractCarryOver(found, config.insertion.translationField);
  } catch { return {}; }
}

// ── small helpers ─────────────────────────────────────────────────────────────
// SQL popularity column is numeric (the popularity_percentage). ES keeps the full
// {max,current} object separately. Returns a number for the DB.
function popToSql(pop) {
  if (!pop) return 0;
  return Number(pop.current ?? pop.max ?? 0) || 0;
}

// Parse a JSON-string array (e.g. ad_image_video) into an array for ES; pass arrays/values through.
function parseMaybeJson(v) {
  if (Array.isArray(v) || typeof v === 'object') return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function ad_impression(n) {
  // PHP: if payload.impression present, use it directly (skip API).
  if (n.impression !== undefined && n.impression !== null && n.impression !== '') {
    return { impression: toInt(n.impression), engagement_rate: 0 };
  }
  return null;
}
function sourceIs(n, kind) {
  const s = String(n.source ?? 'desktop').toLowerCase();
  return s === kind;
}
function arr1(v) { return Array.isArray(v) ? v[0] : v; }
function extractDomain(url) {
  if (!url) return '';
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function computeDaysRunning(postDate, lastSeenEpoch) {
  // postDate may be a DATETIME string (from DB) or an epoch; lastSeenEpoch is epoch seconds.
  const p = toEpochSeconds(postDate);
  const l = toInt(lastSeenEpoch);
  if (!p || !l || l < p) return 1;
  return Math.max(1, Math.floor((l - p) / 86400));
}
function toEpochSeconds(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : v;
  const s = String(v);
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e11 ? Math.floor(n / 1000) : n; }
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
function buildAdgptPayload(n, result) {
  return { ad_id: n.ad_id, facebook_ad_id: result.facebookAdId, type: n.type, platform: toInt(n.platform) };
}

// ── updateRequestedStatus (Users_Request) ───────────────────────────────────────
async function updateRequestedStatus(sql, ad) {
  const r = await repo.getUserRequest(sql, ad.user_request_id);
  if (!r.length) return;
  const row = r[0];
  const code = toInt(ad.code);
  const codeToUpdate = code === 200 ? 1 : code === 400 ? 5 : 0;
  const colMap = { 1: 'keyword_status', 2: 'advertiser_status', 3: 'url_status' };
  const col = colMap[String(ad.user_request_value)];
  if (!col) return;

  if (toInt(row.sent_status) === 9) {
    await repo.bumpMetaSyncCount(sql, ad.user_request_id);
  } else if (toInt(row.sent_status) === 5) {
    if (codeToUpdate === 1) await repo.setSentStatus(sql, 6, ad.user_request_id);
    else if (codeToUpdate === 5) await repo.setSentStatus(sql, 7, ad.user_request_id);
  }
  await repo.setUserRequestColumn(sql, col, codeToUpdate, ad.user_request_id);
}

module.exports = { processMetaAd };
