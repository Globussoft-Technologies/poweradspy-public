'use strict';

const { getLastUrlHostname } = require('../../common/helpers/urlDomain');

/**
 * ChatGPT Ads insertion pipeline — processChatgptAd: INSERT + UPDATE branches.
 *
 * No PHP to port (see MANIFEST §0) — structured directly on facebook's
 * adsLibraryPipeline.js shape (closest real reference: single ad in, media-gated insert,
 * post-commit parallel media+ES), trimmed to this network's own simpler schema and the one
 * real sample payload (MANIFEST §1). Only ONE insertion endpoint for this network (not
 * facebook's metaAdsData+adsLibrary pair) — the real sample payload matches the simpler
 * `metaAdsData` shape (a scraper event, not an Ads-Library audience/budget record); see
 * MANIFEST §6 open item #4 if that assumption turns out wrong.
 */

const repo = require('./repository');
const { validateChatgptAd } = require('./validate');
const { normalize } = require('./normalize');
const { buildChatgptSearchMixDoc, searchIdQuery, extractCarryOver } = require('./esDocBuilder');
const { CHATGPTADS_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, today } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');

const ES_INDEX = 'chatgpt_search_mix';
// The literal network slug passed into every shared NAS/mediaUpload call — NOT the
// payload's own "network":"chatgpt" field. See normalize.js's n.network comment and
// nasClient.js's NAS_KEY_PREFIX.chatgptads entry.
const NETWORK = 'chatgptads';

async function processChatgptAd(ad, ctx) {
  const { db, log } = ctx;
  const sql = db.sql;
  if (!sql) return serverError(503, 'Database connection is not available, so the ad could not be saved.');

  const v = validateChatgptAd(ad);
  if (v.code !== 200) return v;

  const n = normalize(ad);

  // VIDEO requires BOTH the video URL itself AND a thumbnail (same product rule as every
  // other network — see MEDIA-UPLOAD-FLOW.md: "IMAGE ads gate on the image; VIDEO ads gate
  // on the THUMBNAIL" — the video URL requirement is this network's own addition, since
  // without it there is nothing to upload at all, only a thumbnail). Field names UNCONFIRMED
  // for this network (MANIFEST §6 #1) — assumed facebook's `thumbnail_url` until a real
  // VIDEO sample proves otherwise.
  if (n.type === 'VIDEO') {
    if (!n.image_url_original) {
      return rejected(400, 'A video ad requires a video URL (image_video_url or image_url_original).', {
        field: 'image_video_url',
        hint: 'Include a non-empty source video URL and resend.',
      });
    }
    if (!n.thumbnail_url) {
      return rejected(400, 'A video ad requires a thumbnail_url.', {
        field: 'thumbnail_url',
        hint: 'Include a non-empty thumbnail_url for VIDEO ads and resend.',
      });
    }
  }
  // IMAGE must have a source image somewhere (image_video_url or image_url_original —
  // normalize() already collapsed both into n.image_url_original).
  if (n.type === 'IMAGE' && !n.image_url_original) {
    return rejected(400, 'An image ad requires image_video_url or image_url_original.', {
      field: 'image_video_url',
      hint: 'Include a non-empty source image URL and resend.',
    });
  }

  const existing = await repo.getAdByAdId(sql, n.ad_id);

  // Best-effort translation (not critical/blocking) — same posture as facebook's adsLibrary,
  // not its metaAdsData (which aborts 400 on translation failure). This network has no
  // product requirement stated for blocking on translation.
  const translation = await api.translate({
    text: n.ad_text ?? '',
    title: n.ad_title ?? '',
    newsfeed_description: n.newsfeed_description ?? '',
  }).catch(() => ({ ok: false }));
  const tdata = translation.ok ? translation.data : null;

  try {
    if (existing.code === 400) return await insertPath(ctx, n, { translation: tdata });
    return await updatePath(ctx, n, { translation: tdata, existingId: existing.data[0].id });
  } catch (err) {
    if (err.insertionCode) return rejected(err.insertionCode, err.message, { hint: err.insertionHint });
    log.error('chatgptads pipeline error', { error: err.message, ad_id: n.ad_id });
    return serverError(500, 'The ad could not be inserted because of a server error while saving.', { error: err.message });
  }
}

// ── INSERT path ──────────────────────────────────────────────────────────────────
async function insertPath(ctx, n, { translation }) {
  // Explicit product decision: a VIDEO ad's reachability gate is the THUMBNAIL only (checked
  // by fetchPrimaryMedia below), never the video URL itself — a broken/expired video link must
  // NOT reject the ad as long as the thumbnail is present and downloadable. The video file is
  // deliberately never downloaded/verified here (would block the insert for ~40s on a large
  // file); it's fetched later via the background NAS queue, and if THAT fails, it fails
  // silently there (same posture as every other network) rather than rejecting the whole ad
  // retroactively. (An earlier version of this file added a checkReachable() pre-check on the
  // video URL — removed per explicit instruction: thumbnail-working is sufficient to accept.)

  // Media gate: download the primary media up-front and REJECT the ad if it can't be
  // fetched — we don't store a DefaultImage placeholder for a brand-new ad. Bytes are
  // reused after commit (no second download) — same pattern as facebook's insertPath.
  const fetched = await media.fetchPrimaryMedia(
    { type: n.type, imageUrl: n.image_url_original, videoUrl: n.image_url_original, thumbnailUrl: n.thumbnail_url },
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
    media.cleanupFetched(fetched);
    throw err;
  }
}

async function insertPathInner(ctx, n, { translation, fetched }) {
  const { db, log } = ctx;
  const sql = db.sql;

  const result = await repo.withTransaction(sql, async (tx) => {
    const postOwnerId = await upsertPostOwner(tx, n, NETWORK, { skipImage: true });

    // null (not 0) when unresolved — domain_id/country_only_id are NULLable FK columns
    // precisely because destination_url/country are optional fields (validate.js), and a
    // literal 0 would violate the FK (no id=0 row exists). See chatgptads_schema.sql's
    // comment on this column for the bug this fixes.
    let domainId = null;
    const domain = extractDomain(n.destination_url);
    if (domain) {
      const d = await repo.getDomain(tx, domain);
      domainId = d.code === 200 ? d.data[0].id : await repo.insertDomain(tx, domain);
    }

    // country_only_id on the main row is just the FIRST country (ES/single-value field,
    // backward-compat) — the FULL list (n.countries, may be >1) is persisted below into
    // chatgptads_ad_countries, which already appends new countries alongside old ones and
    // increments the sighting count on a repeat (ON DUPLICATE KEY UPDATE count = count + 1)
    // instead of erroring or duplicating a row — no dedup step needed here.
    let countryOnlyId = null;
    let countryRows = [];
    if (n.countries.length) {
      countryRows = await repo.upsertCountryOnly(tx, n.countries);
      if (countryRows.length) countryOnlyId = countryRows[0].country_only_id;
    }

    const adRow = {
      ad_id: n.ad_id, uid: n.uid, type: n.type, platform: n.platform, network: n.network,
      post_owner_id: postOwnerId, domain_id: domainId, country_only_id: countryOnlyId,
      destination_url: n.destination_url, ad_position: n.ad_position, version: n.version,
      first_seen: n.first_seen || nowDateTime(), last_seen: n.last_seen || nowDateTime(),
      days_running: 1, hits: 1, status: 1,
    };
    const chatgptadsAdId = await repo.insertChatgptAd(tx, adRow);
    if (!chatgptadsAdId) {
      const e = new Error(`This ad_id "${n.ad_id}" already exists (duplicate).`);
      e.insertionCode = 402;
      e.insertionHint = 'No action needed unless you expected an update — the ad is already stored.';
      throw e;
    }

    const variantId = await repo.insertVariant(tx, {
      chatgptads_ad_id: chatgptadsAdId, title: n.ad_title, text: n.ad_text,
      newsfeed_description: n.newsfeed_description, image_url_original: n.image_url_original,
    });

    await repo.upsertAnalyticsForDate(tx, chatgptadsAdId, today(), 0);

    if (countryRows.length) {
      await repo.insertAdCountries(tx, countryRows.map((c) => ({ chatgptads_ad_id: chatgptadsAdId, country_only_id: c.country_only_id, count: 1 })));
    }

    if (translation) {
      // null, never a fallback to the original untranslated text — the facebook/instagram
      // pipelines do `translation.title ?? n.ad_title`, which silently stores the RAW copy
      // in a column meant to hold the TRANSLATED copy whenever the API returns a field
      // untranslated/empty, making it indistinguishable from a real translation (a known,
      // still-unfixed issue there). Explicitly not repeated here per product instruction.
      await repo.upsertTranslation(tx, {
        chatgptads_ad_id: chatgptadsAdId,
        ad_title: translation.title ?? null,
        ad_text: translation.text ?? null,
        newsfeed_description: translation.newsfeed_description ?? null,
        // SQL keeps BOTH: the short code (detected_language, e.g. 'en') and the full name
        // (language_name, e.g. 'English') — the translation API returns both already.
        detected_language: translation.detected_language ?? null,
        language_name: translation.language_name ?? null,
      });
    }

    return { chatgptadsAdId, variantId, postOwnerId };
  });

  if (!result.chatgptadsAdId || result.chatgptadsAdId <= 0) {
    return serverError(500, 'The ad could not be inserted (no id was generated).', {
      hint: 'This is a server-side issue, not your data. Please retry.',
    });
  }

  // After commit: post-owner image + ad media (image/video + carousel) in PARALLEL.
  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, n.post_owner_image, NETWORK).catch(() => null),
    uploadAdMediaAndSaveVariant(sql, n, result.chatgptadsAdId, fetched),
  ]);
  result.mediaPaths = mediaPaths;

  await indexAd(ctx, result.chatgptadsAdId, n, result).catch(async (e) => {
    log.warn('ES index failed — queued for retry', { error: e.message, id: result.chatgptadsAdId });
    // MUST be awaited — a fire-and-forget write here could lose the retry row entirely if
    // the request ends (or process restarts) before it lands (found during live testing).
    await repo.queueEsOutbox(sql, result.chatgptadsAdId, 'index', e.message).catch(() => {});
  });

  const warning = media.mediaIssueWarning(mediaPaths, n.type);
  return ok(result.chatgptadsAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

// ── UPDATE path ──────────────────────────────────────────────────────────────────
async function updatePath(ctx, n, { translation, existingId }) {
  const { db, log } = ctx;
  const sql = db.sql;
  const chatgptadsAdId = existingId;

  const joined = await repo.getJoinedAd(sql, 'chatgptads_ad.id', chatgptadsAdId);
  const cur = joined[0] || {};

  // Re-upload primary image/thumbnail on re-seen if the stored variant image is missing or
  // a placeholder — same re-seen gate as every other network (MEDIA-UPLOAD-FLOW.md §"Re-seen").
  let mediaPaths = {};
  const storedImg = String(cur.image_url || '');
  if (!storedImg || storedImg.includes('DefaultImage')) {
    mediaPaths = await uploadAdMedia(n, chatgptadsAdId).catch(() => ({}));
    if (mediaPaths.image_url) {
      await repo.updateVariantByAdId(sql, { image_url: mediaPaths.image_url, image_url_original: n.image_url_original }, chatgptadsAdId).catch(() => {});
    }
    if (mediaPaths.multimedia) await repo.upsertAdImageVideo(sql, mediaPaths.multimedia).catch(() => {});
  }

  const lastSeenEpoch = Math.floor(Date.parse(n.last_seen) / 1000) || Math.floor(Date.now() / 1000);
  const firstSeenEpoch = Math.floor(Date.parse(cur.first_seen) / 1000) || lastSeenEpoch;
  const daysRunning = Math.max(1, Math.floor((lastSeenEpoch - firstSeenEpoch) / 86400));
  await repo.updateChatgptAd(sql, {
    last_seen: n.last_seen,
    days_running: daysRunning,
    hits: (cur.hits || 0) + 1,
  }, chatgptadsAdId);

  // Append-not-replace: new countries are added alongside whatever was already recorded for
  // this ad; a repeat country just increments its sighting count (ON DUPLICATE KEY UPDATE in
  // insertAdCountries) rather than being skipped or erroring — no dedup needed on our side.
  if (n.countries.length) {
    const co = await repo.upsertCountryOnly(sql, n.countries);
    if (co.length) await repo.insertAdCountries(sql, co.map((c) => ({ chatgptads_ad_id: chatgptadsAdId, country_only_id: c.country_only_id, count: 1 })));
  }
  await repo.upsertAnalyticsForDate(sql, chatgptadsAdId, today(), 0);

  if (translation) {
    // null, not a fallback to raw text — see insertPathInner's upsertTranslation call for why.
    await repo.upsertTranslation(sql, {
      chatgptads_ad_id: chatgptadsAdId,
      ad_title: translation.title ?? null,
      ad_text: translation.text ?? null,
      newsfeed_description: translation.newsfeed_description ?? null,
      detected_language: translation.detected_language ?? null,
      language_name: translation.language_name ?? null,
    });
  }

  // Re-attempt the VIDEO on re-seen if the stored video is missing/DefaultImage, same gate
  // as facebook's updatePath — reads the old ES doc's carry-over, only acts when broken.
  if (n.type === 'VIDEO' && n.image_url_original && !Object.keys(mediaPaths).length) {
    const carryOverPeek = await fetchCarryOver(ctx, chatgptadsAdId);
    const sv = String(carryOverPeek.nas_video_url || '');
    if (!sv || sv.includes('DefaultImage')) media.uploadVideo(n.image_url_original, chatgptadsAdId, NETWORK);
  }

  const carryOver = await fetchCarryOver(ctx, chatgptadsAdId);
  // No separate delete-then-reindex step: indexAd() now writes to a deterministic _id
  // (the internal chatgptads_ad.id), so a plain index() call already fully overwrites
  // whatever was there — a delete first only reintroduced the refresh_interval race
  // indexAd()'s own comment explains (and added a pointless extra round-trip).
  await indexAd(ctx, chatgptadsAdId, n, { chatgptadsAdId, carryOver, mediaPaths })
    .then(async () => { await repo.clearEsOutbox(sql, chatgptadsAdId).catch(() => {}); }) // a fresh successful reindex makes any earlier-queued retry stale
    .catch(async (e) => {
      log.warn('ES reindex failed — queued for retry', { error: e.message, id: chatgptadsAdId });
      await repo.queueEsOutbox(sql, chatgptadsAdId, 'index', e.message).catch(() => {});
    });

  return updated(chatgptadsAdId);
}

// ── media helpers ─────────────────────────────────────────────────────────────
async function uploadAdMedia(n, chatgptadsAdId, fetched) {
  const out = {};
  const primaryUrl = n.image_url_original;
  // Carousel — UNCONFIRMED shape (MANIFEST §6 #2). n.other_multimedia is assumed to be an
  // array of URLs, matching facebook's other_multimedia, until a real sample proves otherwise.
  const om = Array.isArray(n.other_multimedia) ? n.other_multimedia : [];

  const [primary, multimedia] = await Promise.all([
    fetched
      ? media.storePrimaryFromTemp(fetched, chatgptadsAdId, NETWORK)
      : n.type === 'VIDEO'
        ? Promise.all([
            media.uploadVideo(primaryUrl, chatgptadsAdId, NETWORK).catch(() => null),
            media.uploadThumbnail(n.thumbnail_url, chatgptadsAdId, NETWORK).catch(() => null),
          ]).then(([vid, thumb]) => ({ vid, thumb }))
        : media.uploadImage(primaryUrl, chatgptadsAdId, NETWORK).catch(() => null).then((img) => ({ img })),
    om.length ? media.uploadMultimedia(om, n.type, chatgptadsAdId, NETWORK).catch(() => null) : Promise.resolve(null),
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

// `chatgptads_ad_variants` is 1:1 on chatgptads_ad_id (UNIQUE key in the schema), so updating
// by ad id is sufficient — unlike facebook's variantId-keyed update, no separate variantId
// lookup is needed.
async function uploadAdMediaAndSaveVariant(sql, n, chatgptadsAdId, fetched) {
  const mediaPaths = await uploadAdMedia(n, chatgptadsAdId, fetched);
  if (mediaPaths.image_url) {
    await repo.updateVariantByAdId(sql, { image_url: mediaPaths.image_url, image_url_original: n.image_url_original }, chatgptadsAdId).catch(() => {});
  }
  if (mediaPaths.multimedia) await repo.upsertAdImageVideo(sql, mediaPaths.multimedia).catch(() => {});
  return mediaPaths;
}

async function indexAd(ctx, chatgptadsAdId, n, result) {
  const { db } = ctx;
  if (!db.elastic) return;
  const joined = await repo.getJoinedAd(db.sql, 'chatgptads_ad.id', chatgptadsAdId);
  const row = joined[0];
  if (!row) return;

  const mp = result.mediaPaths || {};
  const storedImg = row.image_url && !String(row.image_url).includes('DefaultImage') ? row.image_url : null;
  const extra = {};
  if (n.type === 'VIDEO') {
    extra.Thumbnail = mp.image_url ?? storedImg ?? null;
    extra.nas_video_url = mp.nas_video_url ?? null;
  } else {
    const img = mp.image_url ?? storedImg;
    extra.new_nas_image_url = mp.new_nas_image_url ?? img ?? null;
  }
  if (n.image_url_original) extra.image_url_original = n.image_url_original;
  if (row.post_owner_image) extra.post_owner_image = row.post_owner_image;
  const otherMedia = result.mediaPaths?.multimedia?.ad_image_video ?? row.ad_image_video;
  if (otherMedia) extra.othermedia = parseMaybeJson(otherMedia);
  // Sourced from chatgptads_translation via getJoinedAd (SQL, durable) — NOT ES carry-over,
  // which never actually carried this (CARRY_OVER_KEYS never included lang_detect), so this
  // field was always landing null in ES regardless of a successful translation. Fixed.
  // ES gets the FULL language name ('English'), never the short code ('en') — the code is
  // kept in SQL only (chatgptads_translation.detected_language), for anything that needs
  // exact programmatic matching; ES is for display/filtering, where the full word reads
  // better and is what a search/filter UI would show.
  extra.lang_detect = row.language_name ?? null;
  // Full country list (all countries this ad has been seen in, appended across requests — see
  // insertPathInner/updatePath's countryRows handling), not just the primary one `row.country`
  // already holds. ES `country` is a `keyword` field, which natively accepts an array with no
  // mapping change. Falls back to the single primary country if the join table is somehow
  // empty (shouldn't happen — insertAdCountries runs whenever n.countries is non-empty).
  extra.country = row.all_countries ? row.all_countries.split('||') : (row.country ? [row.country] : []);

  const carryOver = result.carryOver || {};
  for (const k of Object.keys(carryOver)) if (extra[k] == null) extra[k] = carryOver[k];

  const doc = buildChatgptSearchMixDoc(CHATGPTADS_COLUMNS, row, { index: ES_INDEX, extra });
  // Deterministic _id = the internal chatgptads_ad.id — NOT a search-then-reuse-found-_id
  // pattern (what facebook/instagram's equivalent still does). That pattern races against
  // the index's refresh_interval (30s): two updates close together (or a delete immediately
  // followed by a reindex) can have the search miss the still-not-yet-refreshed prior write,
  // get back no _id, and `index()` without an id then creates a SECOND, duplicate document —
  // found live while testing back-to-back updates (country/hits silently went stale in ES
  // because the "latest" search hit returned was the stale duplicate, not the real update).
  // A fixed _id makes index() an atomic, unconditional overwrite — no search, no race.
  await db.elastic.index({ index: doc.index, type: doc.type, id: String(chatgptadsAdId), body: doc.body });
}

async function deleteEsDoc(ctx, chatgptadsAdId) {
  const { db } = ctx;
  if (!db.elastic) return;
  // Same deterministic-_id reasoning as indexAd() above — delete directly by id, no search.
  // 404 (already gone / never indexed) is expected and harmless, not an error.
  try {
    await db.elastic.delete({ index: ES_INDEX, type: 'doc', id: String(chatgptadsAdId) });
  } catch (e) {
    if (e?.statusCode !== 404 && e?.meta?.statusCode !== 404) throw e;
  }
}

async function fetchCarryOver(ctx, chatgptadsAdId) {
  const { db } = ctx;
  if (!db.elastic) return {};
  try {
    const found = await db.elastic.search(searchIdQuery(ES_INDEX, chatgptadsAdId));
    return extractCarryOver(found);
  } catch { return {}; }
}

function extractDomain(url) {
  if (!url) return '';
  return getLastUrlHostname(url).replace(/^www\./, '');
}
function parseMaybeJson(v) {
  if (Array.isArray(v) || typeof v === 'object') return v;
  if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

module.exports = { processChatgptAd };
