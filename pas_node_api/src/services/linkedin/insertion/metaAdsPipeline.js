'use strict';

/**
 * LinkedIn lnAdsData pipeline — port of adsDataController::adsdata()
 * (api_linkedin lines 78-1879). See ../../../../KT-LINKEDIN-MIGRATION.md.
 *
 * processMetaAd(ad, ctx) handles ONE ad → { code, message, data? }.
 * ctx = { db:{sql,elastic}, log, network:'linkedin' }. Shared InsertionEngine batches.
 *
 * Faithful-but-fixed (MANIFEST §0.5): all INSERT writes in ONE transaction (PHP committed
 * mid-way at line 860 then again at 1293); media uploaded AFTER commit named by the internal
 * linkedin_ad.id; ES doc is FLAT into linkedin_ads_data with the internal id as _id and
 * dates as UNIX epoch ints.
 *
 * Hybrid shape: SQL resolution like GDN (post_owner / call_to_action / category / domain /
 * country_only FK ids + child tables), ES like gtext (flat, in-memory).
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateMetaAds } = require('./validate');
const { normalizeLinkedinAd, checkGates } = require('./normalize');
const { buildDoc, ES_INDEX } = require('./esDocBuilder');
const { META_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today, toInt } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');

const DEFAULT_AD_IMAGE = '/bydefault_ads.jpg';
const DEFAULT_OWNER_IMAGE = '/DefaultImage.jpg';

async function processMetaAd(ad, ctx) {
  const { db, log } = ctx;
  const network = ctx.network || 'linkedin';
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  // ad_id guard
  if (ad.ad_id === undefined || ad.ad_id === null || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', { field: 'ad_id', hint: 'Add the platform ad_id and resend.' });
  }

  // version / side-ad gates
  const gate = checkGates(ad);
  if (gate) return { code: 400, status: 'rejected', message: gate.message, error: gate.error };

  // validation
  const v = validateMetaAds(ad);
  if (v.code !== 200) return v;

  // discoverer (user) resolution — mirrors PHP linkedin_id handling
  let userId = null;
  let userIdStatus = false;
  const platform = String(ad.platform);
  if (ad.linkedin_id !== undefined && ad.linkedin_id !== null && ad.linkedin_id !== '') {
    const u = await repo.getUserByLinkedinId(sql, ad.linkedin_id);
    if (u.code !== 200) return rejected(401, 'The linkedin_id does not match any known user.', { field: 'linkedin_id', hint: 'Send a valid linkedin_id (a registered discoverer).' });
    userId = u.data[0].id;
  } else if (platform === '3') {
    userIdStatus = true; // resolved from country downstream (best-effort, like PHP)
  } else if (platform !== '15') {
    return rejected(400, 'please provide linkedin_id', { field: 'linkedin_id', hint: 'linkedin_id is required for this platform.' });
  }

  try {
    const existing = await repo.getAdByAdId(sql, ad.ad_id);
    if (existing.code === 400) {
      return await insertPath(ctx, ad, { network, userId, userIdStatus });
    }
    return await updatePath(ctx, ad, { network, existingId: existing.data[0].id, userId });
  } catch (err) {
    log.error('linkedin lnAdsData pipeline error', { error: err.message, ad_id: ad.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── INSERT path ─────────────────────────────────────────────────────────────────
async function insertPath(ctx, rawAd, { network, userId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeLinkedinAd(rawAd);

  const source = String(n.source || 'desktop').toLowerCase();
  const postOwnerLower = String(n.post_owner ?? '').toLowerCase();
  const domain = extractDomain(n.destination_url);

  // external APIs in parallel (best-effort): translation + impression + popularity
  const imprParams = {
    ad_running_days: 1, ad_position: n.ad_position, ad_type: n.type,
    ad_likes: n.likes, ad_comments: n.comment, ad_shares: 0, ad_views: 0,
  };
  const [translationRes, impr, pop] = await Promise.all([
    api.translate({ call_to_action: n.call_to_action ?? '', text: n.ad_text ?? '', title: n.ad_title ?? '', newsfeed_description: n.news_feed_description ?? '' }),
    api.impression(imprParams),
    api.popularity(imprParams),
  ]);
  const translation = translationRes.ok ? translationRes.data : null;

  // language detect (skipped in dev, like GDN's APP_ENV check)
  let languageId = 0;
  if (!config.isDev && translation?.detected_language) {
    languageId = (await repo.getLanguageId(sql, String(translation.detected_language).slice(0, 2))) || 0;
  }
  const popularityObj = pop || { max: 0, current: 0 };

  // platform 15 = ads-library LinkedIn. Impression comes from the payload's
  // impression_low/impression_high ((low+high)/2) instead of the impression API,
  // and impression_low/high/country are stored on linkedin_ad (PHP 833-851).
  const isLib = String(n.platform) === '15';
  let impressionVal;
  let impressionLow = null;
  let impressionHigh = null;
  let impressionCountry = null;
  if (isLib && n.impression_low !== undefined && n.impression_low !== null && n.impression_high !== undefined && n.impression_high !== null) {
    impressionVal = Math.round((Number(n.impression_low) + Number(n.impression_high)) / 2) || 0;
    impressionLow = toInt(n.impression_low);
    impressionHigh = toInt(n.impression_high);
  } else {
    impressionVal = toInt(impr?.impression, 0);
  }
  if (isLib && n.impression_country !== undefined && n.impression_country !== null && n.impression_country !== '') {
    impressionCountry = typeof n.impression_country === 'string' ? n.impression_country : JSON.stringify(n.impression_country);
  }

  const result = await repo.withTransaction(sql, async (tx) => {
    // post owner (dedup by name, case-insensitive)
    let postOwnerId;
    const po = await repo.getPostOwner(tx, postOwnerLower);
    if (po.code === 200) {
      postOwnerId = po.data[0].id;
      await repo.updatePostOwner(tx, { ads_count: toInt(po.data[0].ads_count) + 1 }, postOwnerId);
    } else {
      postOwnerId = await repo.insertPostOwner(tx, {
        post_owner_name: n.post_owner, post_owner_image: DEFAULT_OWNER_IMAGE,
        original_post_owner_image: n.post_owner_image ?? null, ads_count: 1,
        verified: n.verified,
      });
    }

    // call_to_action (dedup by action, bump count)
    let callToActionId = null;
    const cta = await repo.getCallToAction(tx, n.call_to_action || '');
    if (cta.code === 200) { callToActionId = cta.data[0].id; await repo.bumpCallToActionCount(tx, callToActionId); }
    else callToActionId = await repo.insertCallToAction(tx, n.call_to_action || '');

    // category (dedup by name)
    let categoryId = null;
    const cat = await repo.getCategory(tx, n.ad_category || '');
    categoryId = cat.code === 200 ? cat.data[0].id : await repo.insertCategory(tx, n.ad_category || '');

    // country_only (shared table). Platform 15 (ads library): `country` may be a
    // comma list → one country_only row per country; linkedin_ad.country_only_id = the
    // LAST one (PHP 638-674). multipleCountryId feeds linkedin_ad_countries_only below.
    let countryOnlyId = null;
    const multipleCountryId = [];
    if (isLib) {
      const countries = String(n.country || '').split(',').map((c) => c.trim()).filter(Boolean);
      for (const c of countries) {
        const cc = await repo.getCountryOnly(tx, c);
        const id = cc.code === 200 ? cc.data[0].id : await repo.insertCountryOnly(tx, c);
        countryOnlyId = id;
        multipleCountryId.push(id);
      }
      if (countryOnlyId === null) {
        const cc = await repo.getCountryOnly(tx, n.country);
        countryOnlyId = cc.code === 200 ? cc.data[0].id : await repo.insertCountryOnly(tx, n.country);
      }
    } else {
      const co = await repo.getCountryOnly(tx, n.country);
      countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(tx, n.country);
    }

    // domain
    let domainId = null;
    let domainRow = null;
    if (domain && domain.trim() !== '') {
      const d = await repo.getDomain(tx, domain);
      if (d.code === 200) { domainId = d.data[0].id; domainRow = d.data[0]; }
      else domainId = await repo.insertDomain(tx, domain);
    }

    // linkedin_ad
    const adRow = buildLinkedinAdRow(n, {
      categoryId, callToActionId, domainId, countryOnlyId, postOwnerId, userId, languageId,
      impression: impressionVal, popularity: JSON.stringify(popularityObj), source,
      impressionLow, impressionHigh, impressionCountry,
    });
    const linkedinAdId = await repo.insertLinkedinAd(tx, adRow);
    if (!linkedinAdId) throw new Error(`Failed to insert linkedin_ad for ad_id ${n.ad_id}`);

    // variant (image_url set after commit)
    const variantId = await repo.insertVariant(tx, {
      linkedin_ad_id: linkedinAdId,
      title: n.ad_title, text: n.ad_text, newsfeed_description: n.news_feed_description,
      image_url_original: n.image_video_url ?? null, image_url: null,
    });

    // analytics
    await repo.insertAnalytics(tx, { linkedin_ad_id: linkedinAdId, likes: n.likes, comments: n.comment, followers: n.followers, date: today(), hits: 1 });

    // ad_countries_only. Platform 15: one row per country in multipleCountryId (PHP 1048-1078);
    // otherwise a single row for countryOnlyId (PHP 1083-1112).
    if (isLib && multipleCountryId.length > 0) {
      for (const countId of multipleCountryId) {
        const lac = await repo.getAdCountryOnly(tx, linkedinAdId, countId);
        if (lac.code !== 200) await repo.insertAdCountryOnly(tx, { linkedin_ad_id: linkedinAdId, country_only_id: countId, count: 1 });
      }
    } else {
      const lac = await repo.getAdCountryOnly(tx, linkedinAdId, countryOnlyId);
      if (lac.code !== 200) await repo.insertAdCountryOnly(tx, { linkedin_ad_id: linkedinAdId, country_only_id: countryOnlyId, count: 1 });
    }

    // ad_users (if discoverer known)
    if (userId) {
      const lau = await repo.getAdUser(tx, linkedinAdId, userId);
      if (lau.code === 200) await repo.bumpAdUserCount(tx, lau.data[0].id);
      else await repo.insertAdUser(tx, { linkedin_ad_id: linkedinAdId, user_id: userId, count: 1, platform: toInt(n.platform) });
    }

    // meta_data
    await repo.insertMetaData(tx, buildMetaRow(n, linkedinAdId, source));

    // built_with (status 4 only when there is no destination)
    const hasDest = n.destination_url && String(n.destination_url).trim() !== '' && String(n.destination_url) !== 'null';
    await repo.insertBuiltWith(tx, hasDest ? { linkedin_ad_id: linkedinAdId } : { linkedin_ad_id: linkedinAdId, built_with_status: 4 });

    // skeleton rows + ocr
    await repo.insertLanderContent(tx, linkedinAdId);
    await repo.insertLander(tx, linkedinAdId);
    const ocr = await repo.getOcr(tx, linkedinAdId);
    if (ocr.code !== 200) await repo.insertOcr(tx, linkedinAdId);

    // comments (only when provided)
    if (rawAd.comments_data !== undefined && rawAd.comments_data !== null && rawAd.comments_data !== '') {
      const cd = typeof rawAd.comments_data === 'string' ? rawAd.comments_data : JSON.stringify(rawAd.comments_data);
      await repo.insertComments(tx, { linkedin_ad_id: linkedinAdId, comment_data: cd });
    }

    return { linkedinAdId, variantId, postOwnerId, domainId, domainRow, countryOnlyId };
  });

  // ── media AFTER commit (named by internal linkedin_ad.id) ──
  // post-owner image (named by post_owner id — one image per advertiser)
  let postOwnerImage = DEFAULT_OWNER_IMAGE;
  if (n.post_owner_image && /^https?:\/\//i.test(n.post_owner_image)) {
    const up = await media.uploadPostOwner(n.post_owner_image, result.postOwnerId, network).catch(() => null);
    postOwnerImage = up && up.post_owner_image && !String(up.post_owner_image).includes('DefaultImage') ? up.post_owner_image : DEFAULT_OWNER_IMAGE;
    if (postOwnerImage !== DEFAULT_OWNER_IMAGE) {
      await repo.updatePostOwner(sql, { post_owner_image: postOwnerImage, original_post_owner_image: n.post_owner_image, image_updated: 1 }, result.postOwnerId).catch(() => {});
    }
  }

  // ad image / video thumbnail
  const isVideo = n.type === 'VIDEO';
  let imageUrl = DEFAULT_AD_IMAGE;
  if (n.image_video_url && /^https?:\/\//i.test(n.image_video_url)) {
    if (isVideo) {
      const src = (rawAd.thumbnail_url && String(rawAd.thumbnail_url).trim()) ? rawAd.thumbnail_url : n.image_video_url;
      const up = await media.uploadThumbnail(src, result.linkedinAdId, network).catch(() => null);
      imageUrl = up && up.image_video_url && !String(up.image_video_url).includes('DefaultImage') ? up.image_video_url : DEFAULT_AD_IMAGE;
    } else {
      const up = await media.uploadImage(n.image_video_url, result.linkedinAdId, network).catch(() => null);
      imageUrl = up && up.nas_path && !String(up.nas_path).includes('DefaultImage') ? up.nas_path : DEFAULT_AD_IMAGE;
    }
    if (imageUrl !== DEFAULT_AD_IMAGE) {
      await repo.updateVariantByAdId(sql, { image_url: imageUrl }, result.linkedinAdId).catch(() => {});
    }
  }

  // other_multimedia (carousel) → linkedin_ad_image_video
  if (Array.isArray(n.other_multimedia_list) && n.other_multimedia_list.length) {
    const mm = await media.uploadMultimedia(n.other_multimedia_list, n.type, result.linkedinAdId, network).catch(() => null);
    if (mm && mm.ad_image_video) {
      await repo.insertAdImageVideo(sql, { linkedin_ad_id: result.linkedinAdId, ad_type: n.type, ad_image_video: mm.ad_image_video }).catch(() => {});
    }
  }

  // platform 10 → account activity (is_unique = 1 for new)
  if (String(n.platform) === '10' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, linkedin_ad_id: result.linkedinAdId, account_id: rawAd.linkedin_id ?? null, platform: 10, is_unique: 1 }).catch(() => {});
  }

  // ES index (flat doc into linkedin_ads_data, _id = internal id)
  await indexAd(ctx, result.linkedinAdId, n, { translation, imageUrl, postOwnerImage, impressionVal, popularityObj, source, impressionLow, impressionHigh, impressionCountry }, network)
    .catch((e) => log.warn('linkedin ES index failed', { error: e.message }));

  api.adgptInsert(buildAdgptPayload(n, result, imageUrl));

  const warning = (!imageUrl || String(imageUrl).includes('Default')) ? 'Image storage issue: the ad was saved, but its image could not be stored.' : null;
  return ok(result.linkedinAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE path ─────────────────────────────────────────────────────────────────
async function updatePath(ctx, rawAd, { network, existingId, userId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const n = normalizeLinkedinAd(rawAd);

  const joined = await repo.getJoinedAd(sql, 'linkedin_ad.id', existingId);
  const cur = joined[0] || { id: existingId };
  const linkedinAdId = cur.id || existingId;

  // last_seen / days_running
  const lastSeen = nowDateTime();
  const daysRunning = computeDaysRunning(cur.first_seen, lastSeen);
  const adUpdate = { last_seen: lastSeen, days_running: daysRunning, likes: n.likes, comments: n.comment, followers: n.followers };
  await repo.updateLinkedinAd(sql, adUpdate, linkedinAdId);

  // analytics (new daily row)
  await repo.insertAnalytics(sql, { linkedin_ad_id: linkedinAdId, likes: n.likes, comments: n.comment, followers: n.followers, date: today(), hits: 1 }).catch(() => {});

  // country_only + countries_only (bump-or-insert)
  let countryOnlyId = null;
  const co = await repo.getCountryOnly(sql, n.country);
  countryOnlyId = co.code === 200 ? co.data[0].id : await repo.insertCountryOnly(sql, n.country);
  const lac = await repo.getAdCountryOnly(sql, linkedinAdId, countryOnlyId);
  if (lac.code === 200) await repo.bumpAdCountryOnlyCount(sql, lac.data[0].id);
  else await repo.insertAdCountryOnly(sql, { linkedin_ad_id: linkedinAdId, country_only_id: countryOnlyId, count: 1 });

  // ad_users bump-or-insert
  if (userId) {
    const lau = await repo.getAdUser(sql, linkedinAdId, userId);
    if (lau.code === 200) await repo.bumpAdUserCount(sql, lau.data[0].id);
    else await repo.insertAdUser(sql, { linkedin_ad_id: linkedinAdId, user_id: userId, count: 1, platform: toInt(n.platform) });
  }

  // NOTE: linkedin_ad.source is an ENUM('desktop','android','ios') — a single value, NOT a
  // '||'-joined list. So we do NOT mutate the DB source on update (appending would be an
  // invalid enum and silently rejected under strict sql_mode). The multi-valued `source`
  // lives only in the ES doc (array).

  // platform 10 → account activity (is_unique = 0 for existing)
  if (String(n.platform) === '10' && n.system_id) {
    await repo.insertAccountActivity(sql, { system_id: n.system_id, linkedin_ad_id: linkedinAdId, account_id: rawAd.linkedin_id ?? null, platform: 10, is_unique: 0 }).catch(() => {});
  }

  // ES update (flat partial doc; recover by re-indexing if the doc is missing)
  await updateEsDoc(ctx, linkedinAdId, n, { cur, lastSeen, daysRunning, network })
    .catch((e) => log.warn('linkedin ES update failed', { error: e.message }));

  return updated(linkedinAdId);
}

// ── ES index (INSERT) — build flat doc from the joined row ─────────────────────
async function indexAd(ctx, linkedinAdId, n, extras, network) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'linkedin_ad.id', linkedinAdId);
  const row = joined[0];
  if (!row) return;
  const data = await buildFlatData(db, row, linkedinAdId, n, extras);
  const doc = buildDoc(META_INSERT_COLUMNS, data, { extra: buildEsExtra(n, row, extras) });
  await db.elastic.index({ index: doc.index, type: doc.type, id: String(linkedinAdId), body: doc.body });
}

// ── ES update (UPDATE) — partial doc addressed by _id = internal id ────────────
async function updateEsDoc(ctx, linkedinAdId, n, { cur, lastSeen, daysRunning, network }) {
  const { db } = ctx;
  if (!db.elastic) return;

  const countriesCsv = await repo.getCountriesCsv(db.sql, linkedinAdId);
  const { toEpoch, splitPipes, splitCsv } = require('./esDocBuilder');
  const doc = {
    last_seen: toEpoch(lastSeen),
    duration: daysRunning,
    reactions: { likes: n.likes },
    comments: n.comment,
    countries: countriesCsv ? splitCsv(countriesCsv) : splitCsv(n.country),
    state: splitCsv(n.state),
    city: splitCsv(n.city),
    source: splitPipes(n.source),
  };

  try {
    await db.elastic.update({ index: ES_INDEX, type: 'doc', id: String(linkedinAdId), body: { doc } });
  } catch (err) {
    // No doc yet (SQL already updated) → index a fresh, complete one.
    const joined = await repo.getJoinedAd(db.sql, 'linkedin_ad.id', linkedinAdId);
    const row = joined[0];
    if (!row) return;
    const data = await buildFlatData(db, row, linkedinAdId, n, { imageUrl: row.image_url, postOwnerImage: row.post_owner_image, source: n.source });
    const full = buildDoc(META_INSERT_COLUMNS, data, { extra: { ...buildEsExtra(n, row, {}), ...doc } });
    await db.elastic.index({ index: full.index, type: full.type, id: String(linkedinAdId), body: full.body });
  }
}

// ── building blocks ─────────────────────────────────────────────────────────────
function buildLinkedinAdRow(n, ids) {
  const now = nowDateTime();
  const row = {
    category_id: ids.categoryId ?? null,
    call_to_action_id: ids.callToActionId ?? null,
    domain_id: ids.domainId ?? null,
    country_only_id: ids.countryOnlyId ?? null,
    post_owner_id: ids.postOwnerId ?? null,
    discoverer_user_id: ids.userId ?? null,
    likes: toInt(n.likes), comments: toInt(n.comment), followers: toInt(n.followers),
    source: ids.source || 'desktop',
    post_date: n.post_date || now, first_seen: now, last_seen: now,
    type: n.type, ad_id: n.ad_id, ad_position: n.ad_position, days_running: 1,
    language_id: ids.languageId || 0,
    impression: ids.impression ?? 0,
    popularity: ids.popularity ?? null,
  };
  // NOTE: linkedin_ad has NO `status` column (verified live) — do not set it.
  // country_id is NOT-NULL with no default; PHP omits it → relaxed sql_mode defaults it to 0.
  if (String(n.platform) === '10' && n.system_id) row.System_id = n.system_id;
  // platform 15 (ads library): impression range + per-country impression breakdown
  if (ids.impressionLow !== null && ids.impressionLow !== undefined) row.impression_low = ids.impressionLow;
  if (ids.impressionHigh !== null && ids.impressionHigh !== undefined) row.impression_high = ids.impressionHigh;
  if (ids.impressionCountry !== null && ids.impressionCountry !== undefined) row.impression_country = ids.impressionCountry;
  return row;
}

function buildMetaRow(n, linkedinAdId, source) {
  const now = nowDateTime();
  const sentinel = '0001-01-01 01:01:01';
  const row = {
    linkedin_ad_id: linkedinAdId,
    destination_url: (n.destination_url && String(n.destination_url).trim() !== '') ? n.destination_url : null,
    firstSeenOnIos: source === 'ios' ? now : sentinel, lastSeenOnIos: source === 'ios' ? now : sentinel,
    firstSeenOnDesktop: (source === 'desktop' || !n.source) ? now : sentinel, lastSeenOnDesktop: (source === 'desktop' || !n.source) ? now : sentinel,
    firstSeenOnAndroid: source === 'android' ? now : sentinel, lastSeenOnAndroid: source === 'android' ? now : sentinel,
    screenshot_url: 'processing.gif',
    platform: toInt(n.platform),
    ad_url: (n.ad_url === undefined || n.ad_url === null) ? (String(n.ad_position) === 'SIDE' ? '' : null) : n.ad_url,
    version: n.version ?? null,
  };
  return row;
}

/** Map the joined SQL row → flat ES data object (the keys esDocBuilder consumes). */
async function buildFlatData(db, row, linkedinAdId, n, extras) {
  const redirectUrls = await repo.getRedirectUrls(db.sql, linkedinAdId).catch(() => []);
  const countriesCsv = await repo.getCountriesCsv(db.sql, linkedinAdId).catch(() => null);
  return {
    ad_id: linkedinAdId,
    post_owner: row.post_owner_name ?? null,
    post_owner_id: row.post_owner_table_id ?? null,
    post_owner_image: extras.postOwnerImage ?? row.post_owner_image ?? null,
    verified: row.verified ?? null,
    ad_title: row.title ?? null,
    ad_text: row.text ?? null,
    newsfeed_description: row.newsfeed_description ?? null,
    call_to_action: row.call_to_action ?? null,
    ad_url: row.ad_url ?? null,
    ad_video: extras.imageUrl ?? row.image_url ?? null,
    image_url_original: row.image_url_original ?? n.image_video_url ?? null,
    ad_image: row.ad_image_video ?? null,
    first_seen: row.firstSeenOnDesktop ?? row.first_seen ?? null,
    last_seen: row.last_seen ?? null,
    post_date: row.post_date ?? null,
    reactions: { likes: toInt(row.likes) },
    comments: toInt(row.comments),
    impression: row.impression ?? extras.impressionVal ?? 0,
    popularity: safeJson(row.popularity) ?? extras.popularityObj ?? { max: 0, current: 0 },
    destination_url: row.destination_url ?? null,
    platform: toInt(row.platform),
    redirect_urls: redirectUrls,
    html_text: row.html_whitehat_lander_text ?? null,
    image_ocr: row.image_ocr ?? null,
    image_object: row.image_object ?? null,
    image_brand: row.image_brand_logo ?? null,
    image_celebrity: row.image_celebrity ?? null,
    countries: countriesCsv ?? row.country ?? null,
    ad_type: row.type ?? null,
    ad_position: row.ad_position ?? null,
    ad_language: row.ad_language ?? null,
    affiliate_networks: row.affiliate_data ?? null,
    ecommerce_platform: row.built_with ?? null,
    funnel: row.built_with_analytics_tracking ?? null,
    source: row.source ?? n.source ?? null,
    domain_registration_date: row.domain_registered_date ?? null,
  };
}

function buildEsExtra(n, row, extras) {
  const extra = {
    state: splitCsvLocal(n.state),
    city: splitCsvLocal(n.city),
    duration: computeDaysRunning(row.first_seen, row.last_seen || nowDateTime()),
    new_nas_image_url: (extras && extras.imageUrl && extras.imageUrl !== DEFAULT_AD_IMAGE) ? extras.imageUrl : null,
  };
  // platform 15 (ads library): impression range + per-country breakdown in the ES doc
  if (extras && extras.impressionLow !== null && extras.impressionLow !== undefined) extra.impression_low = extras.impressionLow;
  if (extras && extras.impressionHigh !== null && extras.impressionHigh !== undefined) extra.impression_high = extras.impressionHigh;
  if (extras && extras.impressionCountry !== null && extras.impressionCountry !== undefined) {
    try { extra.impression_country = typeof extras.impressionCountry === 'string' ? JSON.parse(extras.impressionCountry) : extras.impressionCountry; }
    catch { extra.impression_country = extras.impressionCountry; }
  }
  if (extras && extras.translation) {
    const t = extras.translation;
    if (t.localization_en || t.en) extra.localization_en = t.localization_en ?? t.en;
    if (t.localization_ar || t.ar) extra.localization_ar = t.localization_ar ?? t.ar;
    if (t.localization_fr || t.fr) extra.localization_fr = t.localization_fr ?? t.fr;
    if (t.localization_pt || t.pt) extra.localization_pt = t.localization_pt ?? t.pt;
  }
  return extra;
}

function buildAdgptPayload(n, result, imageUrl) {
  return {
    ad_id: result.linkedinAdId, network: 'LinkedIn', type: n.type, platform: toInt(n.platform),
    source: n.source, ad_position: n.ad_position, ad_title: n.ad_title,
    newsfeed_description: n.news_feed_description, destination_url: n.destination_url,
    [`ad-${String(n.type || '').toLowerCase()}`]: imageUrl ?? null,
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
function splitCsvLocal(v) {
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(',').map((x) => x.trim()).filter((x) => x.length);
}
function extractDomain(url) {
  if (!url) return '';
  const s = String(url).trim();
  // PHP parse_url('null') / '' → no host → domain ''. Treat the literal "null" (common in
  // ads-library payloads with no destination) and unparseable values as no-domain.
  if (s === '' || s.toLowerCase() === 'null') return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
    const h = (u.hostname || '').replace(/^www\./i, '');
    return h.toLowerCase() === 'null' ? '' : h;
  } catch { return ''; }
}
function safeJson(s) {
  if (s === undefined || s === null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { processMetaAd };
