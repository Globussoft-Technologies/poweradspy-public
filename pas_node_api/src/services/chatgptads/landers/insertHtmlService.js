'use strict';

/**
 * ChatGPT Ads landers — insertHtmlRedirectCountry.
 *
 * Mirrors facebook/landers/insertHtmlService.js, reshaped for this network's schema.
 *
 * Request body: { ad_id, insertData: { ... } } (same accepted shapes as facebook — see
 * normalizeBody). `ad_id` is the INTERNAL chatgptads_ad.id (the `id` getAdwithCountryCode
 * returned). insertData fields: ad_id, country_iso, destinations, html_path, screen_shot,
 * html_content, status, domain_registered_date, crawled_by, outgoing_url[], redirects[].
 *
 * Pipeline:
 *   ES existence check (index from config, term on `id`) → validate →
 *   status 3 (no response from destination) → lander_status = 5, done.
 *   otherwise → domain_registered_date on chatgptads_ad_domains →
 *               upsert chatgptads_ad_landers + chatgptads_ad_html_lander_content
 *               (html_content) → lander_status = 4 →
 *               ES overlay (domain_registered_date, outgoing_source_url / outgoing_redirect_url /
 *               outgoing_final_url, redirect_url — see buildLanderEsDoc).
 *
 * Differences from facebook (this network's schema has no such tables/columns):
 *   - no ad_url / outgoing_links / blackhat-whitehat list bookkeeping — the lander goes into
 *     the single chatgptads_ad_landers row; the domain step only records
 *     domain_registered_date (no dod_date column, and chatgptads_ad.domain_id is left to the
 *     insertion pipeline);
 *   - ES fields are FLAT keyword arrays (chatgpt_search_mix convention), not facebook's dotted
 *     pipe-joined strings; the doc is updated by _id, not search-then-update. These keys are in
 *     esDocBuilder.CARRY_OVER_KEYS so an insertion re-index keeps them.
 *
 * Returns { code, message, exe_time }.
 */

const { getLastUrlHostname } = require('../../common/helpers/urlDomain');
const { searchIdQuery, firstHitId } = require('../insertion/esDocBuilder');
const repo = require('./repository');

// lander_status values (chatgptads_ad) — see getAdsService.js.
const SUCCESS = 4;
const NOT_FOUND = 5;

// ── validator (same rules as facebook) ──────────────────────────────────────────
//
//   ad_id                  => required
//   country_iso            => present|string|nullable
//   destinations           => present|string|nullable
//   html_path              => present|string|nullable
//   screen_shot            => present|string|nullable
//   html_content           => present|string|nullable
//   status                 => required
//   domain_registered_date => present|nullable
//   crawled_by             => required|in:.net,python

const REQUIRED_VALUE_KEYS = ['ad_id', 'status'];
const PRESENT_STRING_NULLABLE_KEYS = [
  'country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content',
];
const PRESENT_NULLABLE_KEYS = ['domain_registered_date'];

/**
 * Validate the insertData payload.
 * Returns null when valid, otherwise a message naming exactly which field is
 * missing, of the wrong type, or has an invalid value.
 */
function validate(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'The "insertData" object is missing or malformed. Expected a JSON object containing the lander details.';
  }

  const missingRequired = REQUIRED_VALUE_KEYS.filter(
    (k) => value[k] === undefined || value[k] === null || value[k] === ''
  );
  const missingPresent = [...PRESENT_STRING_NULLABLE_KEYS, ...PRESENT_NULLABLE_KEYS].filter(
    (k) => !(k in value)
  );
  const missing = [...missingRequired, ...missingPresent];
  if (missing.length === 1) {
    return `The "insertData.${missing[0]}" field is missing from the payload and is required.`;
  }
  if (missing.length > 1) {
    return `The following required fields are missing from insertData: ${missing.map((k) => `"${k}"`).join(', ')}.`;
  }

  for (const k of PRESENT_STRING_NULLABLE_KEYS) {
    if (value[k] !== null && value[k] !== undefined && typeof value[k] !== 'string') {
      return `The "insertData.${k}" field must be a string or null (received ${typeof value[k]}).`;
    }
  }

  if (value.crawled_by === undefined || value.crawled_by === null || value.crawled_by === '') {
    return 'The "insertData.crawled_by" field is missing from the payload and is required.';
  }
  if (value.crawled_by !== '.net' && value.crawled_by !== 'python') {
    return `The "insertData.crawled_by" field is invalid (received ${JSON.stringify(value.crawled_by)}). `
      + 'It must be exactly ".net" or "python".';
  }
  return null;
}

/**
 * Normalise the incoming request body into { ad_id, value } where `value` is the
 * flat lander-detail object. Accepts the same shapes as facebook:
 *   - { ad_id, insertData: { ... } }
 *   - { ad_id, insertData: [ { ... } ] }
 *   - [ { ad_id, ... } ]
 *   - { ad_id, country_iso, ... }            (flat body)
 */
function normalizeBody(rawBody) {
  let raw = rawBody;
  if (Array.isArray(raw)) raw = raw[0];
  if (raw === null || typeof raw !== 'object') return { ad_id: undefined, value: null };

  let value = raw.insertData;
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) {
    value = ('insertData' in raw) ? value : raw;
  }

  const ad_id = raw.ad_id ?? (value && typeof value === 'object' ? value.ad_id : undefined);
  return { ad_id, value };
}

/** JSON column value for a crawler list, or null when there is nothing to store. */
function jsonList(list, { skipNA = false } = {}) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (skipNA && list[0] === 'NA') return null;
  return JSON.stringify(list);
}

/** '' → null for the nullable text columns. */
function emptyToNull(v) {
  return v === undefined || v === null || v === '' ? null : v;
}

/**
 * Coerce a "date-ish" input to a real value or null (same as facebook): scrapers send ""
 * or the MySQL zero-date sentinels when they could not resolve a registration date, and a
 * strict-mode connection rejects '' in a DATE column.
 */
function cleanDate(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '0' || s === '0000-00-00' || s === '0000-00-00 00:00:00') return null;
  return v;
}

/**
 * Domain from the final URL in `destinations` — same rule as the insertion pipeline
 * (chatgptadsPipeline.extractDomain: hostname without "www."), so both write the same
 * chatgptads_ad_domains row.
 */
function extractDomain(destinations) {
  if (!destinations) return null;
  return getLastUrlHostname(destinations).replace(/^www\./, '') || null;
}

// ── ES overlay (lander fields on the chatgpt_search_mix doc) ─────────────────────

/** Unique, non-empty strings from a value that may be an array, a string, or missing. */
function toUrlList(v) {
  const list = Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v]);
  return [...new Set(list.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))];
}

/** 'yyyy-MM-dd' for the ES date field, or null when the value is not a usable date. */
function esDate(v) {
  const m = v === null || v === undefined ? null : String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Partial doc for the lander fields. Lists are always written (null when empty) so the doc
 * reflects the latest crawl — same as the SQL row. domain_registered_date is only written
 * when the crawl resolved one, so a blank value never wipes a known date (same as SQL).
 */
function buildLanderEsDoc(value) {
  const outgoing = Array.isArray(value.outgoing_url) ? value.outgoing_url.filter((o) => o && typeof o === 'object') : [];
  const redirects = Array.isArray(value.redirects) && value.redirects[0] === 'NA' ? [] : toUrlList(value.redirects);
  const orNull = (list) => (list.length ? list : null);

  const doc = {
    outgoing_source_url: orNull(toUrlList(outgoing.map((o) => o.start_url))),
    outgoing_redirect_url: orNull(toUrlList(outgoing.flatMap((o) => toUrlList(o.redirect_urls)))),
    outgoing_final_url: orNull(toUrlList(outgoing.map((o) => o.destination_url))),
    redirect_url: orNull(redirects),
  };
  const regDate = esDate(cleanDate(value.domain_registered_date));
  if (regDate) doc.domain_registered_date = regDate;
  return doc;
}

async function insertHtmlRedirectCountry(req, db, log) {
  const started = Date.now();
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'chatgpt_search_mix';

  const { ad_id, value } = normalizeBody(req.body);

  try {
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      response.code = 400;
      response.message = 'Request body is empty. Expected a JSON body with the lander fields '
        + '(either flat, or nested under an "insertData" object).';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
      response.code = 400;
      response.message = 'No lander details were found in the request body. Send the fields either at the top '
        + 'level or nested under a non-null "insertData" object.';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (ad_id === undefined || ad_id === null || ad_id === '') {
      response.code = 400;
      response.message = 'The "ad_id" field is missing. Provide it at the top level of the request body '
        + 'or inside "insertData".';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (!sql || !elastic) {
      response.code = 500;
      response.message = `A backend dependency is not available (${!sql ? 'database' : 'search'} connection not initialised). `
        + 'The request was not processed; please retry shortly.';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 1. Must exist in Elasticsearch.
    const esFound = await elastic.search(searchIdQuery(ES_INDEX, ad_id));
    if (!firstHitId(esFound)) {
      response.code = 400;
      response.message = `Ad "${ad_id}" was not found in the search index (${ES_INDEX}). `
        + 'The ad must be indexed before its destination lander can be stored.';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 2. Validate.
    const verr = validate(value);
    if (verr) {
      log?.warn?.('chatgptads.landers.insertHtml validation failed', { ad_id, error: verr });
      response.code = 400;
      response.message = verr;
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 3. status === 3 → no response from destination, only flip lander_status.
    if (Number(value.status) === 3) {
      const upd = await repo.updateLanderStatus(sql, ad_id, NOT_FOUND);
      if (upd === 1) {
        response.code = 200;
        response.message = 'Redirect status updated succesfully';
      } else {
        response.code = 400;
        response.message = 'Redirect status updated previously';
      }
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 4. Domain registration date → chatgptads_ad_domains (find-or-create by domain;
    //    a blank date never overwrites a stored one).
    const domain = extractDomain(value.destinations);
    if (domain) {
      await repo.upsertDomainRegisteredDate(sql, domain, cleanDate(value.domain_registered_date));
    }

    // 5. Upsert the lander row, and the page text in its own table.
    await repo.upsertLanderContent(sql, {
      chatgptads_ad_id: ad_id,
      html_path: emptyToNull(value.html_path),
      screenshot_url: emptyToNull(value.screen_shot),
      out_going_url: jsonList(value.outgoing_url),
      redirect_url: jsonList(value.redirects, { skipNA: true }),
      scrapper_name: value.crawled_by,
    });
    await repo.upsertHtmlLanderContent(sql, ad_id, emptyToNull(value.html_content));

    // 6. Mark the ad's lander as captured.
    await repo.updateLanderStatus(sql, ad_id, SUCCESS);

    // 7. ES overlay — best-effort, by _id = internal chatgptads_ad.id (same deterministic
    //    _id the insertion pipeline indexes with). An ES failure is logged; SQL stands.
    try {
      await elastic.update({ index: ES_INDEX, type: 'doc', id: String(ad_id), body: { doc: buildLanderEsDoc(value) } });
    } catch (esErr) {
      log?.error?.('chatgptads.landers.insertHtml ES update failed', { ad_id, error: esErr.message });
    }

    response.code = 200;
    response.message = 'Destination Lander updated successfully';
  } catch (e) {
    log?.error?.('chatgptads.landers.insertHtmlRedirectCountry failed', { ad_id, error: e.message, stack: e.stack });
    response.code = 400;
    response.message = `Failed to store the destination lander for ad "${ad_id}": ${e.message}`;
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlRedirectCountry };
