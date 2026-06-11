'use strict';

/**
 * apiClients — shared external-API clients used by the insertion pipeline.
 *
 * COMMON helper (all networks). Thin wrappers over httpClient that encapsulate
 * the request payload + response parsing for each upstream service, so the
 * pipelines never deal with raw HTTP. Endpoints come from config.insertion.api
 * (config.json → env). Each client returns a normalized, never-throwing result.
 *
 * Mirrors the PHP calls in adsDataController:
 *   - translate()      → env(LANGUAGE_TRANSLATION_API)            (helper::postApiCall)
 *   - impression()     → impression API (get_impressions_and_popularity)  (calculateImpression)
 *   - popularity()     → env(API_IMPRESSION_POPULARITY)           (calculatePopularity)
 *   - adgptInsert()    → env(ADGPT_INSERTION_API)  fire-and-forget (Guzzle postAsync)
 */

const { postJson, postFireAndForget } = require('./httpClient');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('insertion-api');

/**
 * Language translation + detection.
 * PHP: success requires HTTP 200 AND body.code == 200; then body is used
 * (detected_language, language_name, call_to_action, translated copy).
 *
 * @returns {{ ok:boolean, data?:Object, error?:string }}
 */
async function translate({ call_to_action = '', text = '', title = '', newsfeed_description = '' }) {
  const url = config.insertion.api.translationUrl;
  if (!url) return { ok: false, error: 'translationUrl not configured' };

  const res = await postJson(
    url,
    { call_to_action, text, title, newsfeed_description },
    { timeoutMs: config.insertion.api.timeoutMs, verifyTls: false }
  );

  if (res.statusCode === 200 && res.data && res.data.code === 200) {
    const data = { ...res.data };
    delete data.code;
    return { ok: true, data };
  }
  return { ok: false, error: res.message || 'translation api failure', raw: res };
}

/**
 * Impression + engagement-rate calculation.
 * PHP calculateImpression POSTs the ad metrics and reads impressions + engagement_rate.
 *
 * @returns {{ impression:number, engagement_rate:number }}
 */
async function impression(params) {
  // PHP zero-engagement short-circuit: no API call when all metrics are 0.
  if (isZeroEngagement(params)) return { impression: 0, engagement_rate: 0 };

  const url = config.insertion.api.impressionUrl;
  if (!url) return { impression: 0, engagement_rate: 0 };

  const res = await postJson(url, buildImpressionPayload(params), {
    timeoutMs: config.insertion.api.timeoutMs,
    verifyTls: false,
  });

  const body = res.statusCode === 200 ? res.data : null;
  if (!body) return { impression: 0, engagement_rate: 0 };

  // PHP calculateImpression reads res.impressions + res.engagement_rate.
  return {
    impression: num(body.impressions ?? body.impression ?? 0),
    engagement_rate: num(body.engagement_rate ?? 0),
  };
}

/**
 * Popularity score. PHP calculatePopularity returns a JSON object {max, current}.
 * @returns {{ max:number, current:number } | null}
 */
async function popularity(params) {
  // PHP zero-engagement short-circuit → {max:0, current:0}.
  if (isZeroEngagement(params)) return { max: 0, current: 0 };

  const url = config.insertion.api.popularityUrl;
  if (!url) return { max: 0, current: 0 };

  const res = await postJson(url, buildImpressionPayload(params), {
    timeoutMs: config.insertion.api.timeoutMs,
    verifyTls: false,
  });

  const body = res.statusCode === 200 ? res.data : null;
  if (!body) return { max: 0, current: 0 };

  // PHP calculatePopularity reads res.popularity_percentage and returns {max,current} both = that value.
  const pct = num(body.popularity_percentage ?? body.max ?? 0);
  return { max: pct, current: num(body.current ?? pct) };
}

/**
 * Fire-and-forget ADGPT insertion (Guzzle postAsync, ~100ms timeout). Never awaited
 * for its result — failures are swallowed. Returns the in-flight promise.
 */
function adgptInsert(combinedData) {
  const url = config.insertion.api.adgptInsertionUrl;
  if (!url) return Promise.resolve(null);
  return postFireAndForget(url, combinedData, {
    timeoutMs: config.insertion.api.adgptTimeoutMs,
    verifyTls: false,
  }).catch((e) => {
    log.debug('adgpt insert failed (ignored)', { error: e?.message });
    return null;
  });
}

// ── Shared payload builder for impression + popularity (identical params) ──
function buildImpressionPayload(p = {}) {
  return {
    ad_running_days: num(p.ad_running_days),
    ad_call_to_action: p.ad_call_to_action ?? '',
    ad_iso: Array.isArray(p.ad_iso) ? p.ad_iso : [],
    ad_type: p.ad_type ?? '',
    ad_position: p.ad_position ?? '',
    ad_likes: num(p.ad_likes),
    ad_comments: num(p.ad_comments),
    ad_shares: num(p.ad_shares),
    ad_views: num(p.ad_views),
  };
}

function isZeroEngagement(p = {}) {
  return num(p.ad_likes) === 0 && num(p.ad_comments) === 0 && num(p.ad_shares) === 0 && num(p.ad_views) === 0;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeJson(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { translate, impression, popularity, adgptInsert };
