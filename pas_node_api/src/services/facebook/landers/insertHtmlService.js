'use strict';

/**
 * Facebook landers — insertHtmlRedirectCountry.
 *
 * Faithful port of BlackHatController@insertHtmlRedirectCountry (api app).
 *
 * Request body: { ad_id, insertData: { ... } }  (PHP wraps insertData in a 1-element
 * array and loops once). insertData fields: ad_id, country_iso, destinations,
 * html_path, screen_shot, html_content, status, domain_registered_date, crawled_by,
 * domain_age, outgoing_url[], redirects[], ad_category.
 *
 * Pipeline (per the PHP):
 *   ES check (search_mix, facebook_ad.id) → validate → (status 3 short-circuit) →
 *   domain upsert → country normalize → blackhat/whitehat status bookkeeping →
 *   outgoing_links upsert → ad_url redirects/destination upsert → html_lander upsert →
 *   facebook_ad.domain_id → meta update → ES doc update.
 *
 * Returns { code, message, exe_time } — same shape/strings as the PHP JSON.
 *
 * NOTE: several behaviours below are deliberately quirky to match the legacy PHP
 * (e.g. html_whitehat_lander_text is always null; whitehat html lands in the
 * "dc_blackhat" column). Comments flag each one.
 */

const { searchIdQuery, firstHitId } = require('../insertion/esDocBuilder');
const repo = require('./repository');

// ── small transforms (mirror the PHP string munging) ─────────────────────────────

/** JSON-encode, strip the surrounding [], drop quotes, "\/"→"/", join with "||". */
function pipeJoin(value) {
  let s = JSON.stringify(value ?? null);
  s = s.replace(/^\[|\]$/g, '');
  s = s.replace(/"/g, '');
  s = s.replace(/\\\//g, '/');
  s = s.replace(/,/g, '||');
  return s;
}

/** Country string: pipeJoin + uppercase (PHP country_iso handling). */
function normalizeCountry(countryIso) {
  return pipeJoin(countryIso).toUpperCase();
}

/** Trim [], drop quotes, split on "," → unique list (PHP screenshot/zip db parsing). */
function splitDbList(dbValue) {
  if (dbValue === null || dbValue === undefined) return [];
  let s = String(dbValue).replace(/^\[|\]$/g, '').replace(/"/g, '');
  if (s === '') return [];
  return [...new Set(s.split(','))];
}

const uniq = (arr) => [...new Set(arr)];

/**
 * Coerce a "date-ish" input to a real value or null.
 * The scrapers frequently send "" (or the MySQL zero-date sentinels) when they
 * could not resolve a registration date. On a strict-mode connection an empty
 * string in a DATE column throws `Incorrect date value: ''`, so treat every blank
 * form as "no date supplied".
 */
function cleanDate(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '0' || s === '0000-00-00' || s === '0000-00-00 00:00:00') return null;
  return v;
}

/** Registrable domain from a destination URL (PHP parse_url + regex). */
function extractDomain(destinations) {
  if (!destinations) return null;
  let host;
  try {
    host = new URL(destinations).hostname;
  } catch {
    // PHP parse_url falls back to the path when there is no host.
    host = String(destinations).replace(/^https?:\/\//i, '').split('/')[0];
  }
  const m = String(host || '').match(/([a-z0-9][a-z0-9-]{1,63}\.[a-z.]{2,6})$/i);
  return m ? m[1] : null;
}

// ── validator (faithful port of the Laravel rules) ──────────────────────────────
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

// required: key present AND value not null/undefined/empty-string.
const REQUIRED_VALUE_KEYS = ['ad_id', 'status'];
// present|string|nullable: key must exist; if the value is not null, it must be a string.
const PRESENT_STRING_NULLABLE_KEYS = [
  'country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content',
];
// present|nullable: key must exist; value may be anything (incl. null).
const PRESENT_NULLABLE_KEYS = ['domain_registered_date'];

/**
 * Validate the insertData payload.
 * Returns null when valid, otherwise a professional, specific message that names
 * exactly which field is missing, of the wrong type, or has an invalid value.
 */
function validate(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'The "insertData" object is missing or malformed. Expected a JSON object containing the lander details.';
  }

  // 1. required — must be present and non-empty.
  const missingRequired = REQUIRED_VALUE_KEYS.filter(
    (k) => value[k] === undefined || value[k] === null || value[k] === ''
  );
  // 2. present — key must exist in the payload (value may be null).
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

  // 3. string|nullable — when present and not null, the value must be a string.
  for (const k of PRESENT_STRING_NULLABLE_KEYS) {
    if (value[k] !== null && value[k] !== undefined && typeof value[k] !== 'string') {
      return `The "insertData.${k}" field must be a string or null (received ${typeof value[k]}).`;
    }
  }

  // 4. crawled_by => required|in:.net,python
  if (value.crawled_by === undefined || value.crawled_by === null || value.crawled_by === '') {
    return 'The "insertData.crawled_by" field is missing from the payload and is required.';
  }
  if (value.crawled_by !== '.net' && value.crawled_by !== 'python') {
    return `The "insertData.crawled_by" field is invalid (received ${JSON.stringify(value.crawled_by)}). `
      + 'It must be exactly ".net" or "python".';
  }
  return null;
}

const ES_DOC_TYPE = 'doc';

/**
 * Normalise the incoming request body into { ad_id, value } where `value` is the
 * flat lander-detail object. Accepts every shape the legacy scrapers send:
 *   - { ad_id, insertData: { ... } }        (documented Node shape)
 *   - { ad_id, insertData: [ { ... } ] }    (PHP wraps insertData in a 1-element array)
 *   - [ { ad_id, ... } ]                     (PHP destinationLander job — top-level array)
 *   - { ad_id, country_iso, ... }            (flat body — fields at the top level)
 */
function normalizeBody(rawBody) {
  let raw = rawBody;
  if (Array.isArray(raw)) raw = raw[0];
  if (raw === null || typeof raw !== 'object') return { ad_id: undefined, value: null };

  let value = raw.insertData;
  if (Array.isArray(value)) value = value[0];
  // No insertData wrapper → the body itself carries the lander fields.
  if (value === undefined || value === null) {
    value = ('insertData' in raw) ? value : raw;
  }

  const ad_id = raw.ad_id ?? (value && typeof value === 'object' ? value.ad_id : undefined);
  return { ad_id, value };
}

async function insertHtmlRedirectCountry(req, db, log) {
  const started = Date.now();
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'search_mix';

  const { ad_id, value } = normalizeBody(req.body);
  const date = new Date().toISOString().slice(0, 10);

  // Accumulators (mirror PHP locals).
  let start_url = null, redirect_url = null, final_url = null;
  let url_redirect = null, url_destination = null;
  let domain_registered_date = null;
  let domain_name = '';
  let id = ''; // domain_id

  const whitehat = [];          // PHP: never populated → html_whitehat_lander_text stays null
  const res_black_hat = [];     // blackhat html_content
  const dc_black_hat = [];      // (PHP quirk) whitehat html_content lands here
  let whitehat_screenshot = [], blackhat_screenshot = [], whitehat_zip = [], blackhat_zip = [];

  const update_meta_table = {};

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
    const esId = firstHitId(esFound);
    if (!esId) {
      response.code = 400;
      response.message = `Ad "${ad_id}" was not found in the search index (${ES_INDEX}). `
        + 'The ad must be indexed before its destination lander can be stored.';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    update_meta_table.facebook_ad_id = ad_id;

    // 2. Validate.
    const verr = validate(value);
    if (verr) {
      log?.warn?.('landers.insertHtml validation failed', { ad_id, error: verr });
      response.code = 400;
      response.message = verr;
      return response; // PHP returns immediately (no exe_time on this path)
    }

    // 3. Current meta snapshot.
    const metaRows = await repo.getMetaDataDetails(sql, ad_id);
    const meta0 = metaRows[0] || {};
    const blackhat_status = meta0.blackhat_status;
    const whitehat_status = meta0.white_ad_status;
    const whitehat_screenshot_db = meta0.white_ad_screenshot;
    const blackhat_screenshot_db = meta0.png_file;
    const whitehat_zip_db = meta0.white_ad_lander;
    const blackhat_zip_db = meta0.blackhat_path;

    // 4. status === 3 → no response from destination, only flip redirect_status.
    if (Number(value.status) === 3) {
      if (blackhat_status != 1 || whitehat_status != 0 || whitehat_status != 2) {
        update_meta_table.redirect_status = value.crawled_by === '.net' ? 3 : 5;
        const upd = await repo.updateMeta(sql, ad_id, update_meta_table);
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
      response.code = 400;
      response.message = 'Redirect status updated previously';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 5. Domain upsert from the destination URL.
    domain_name = extractDomain(value.destinations);
    if (domain_name) {
      const domainRows = await repo.getDomainId(sql, domain_name);
      // "" / "0" / "0000-00-00" from the scraper → store an explicit NULL, never ''.
      const domain_registerd = cleanDate(value.domain_registered_date);
      domain_registered_date = domain_registerd;

      if (domainRows[0] && domainRows[0].id != null) {
        // Always resolve the domain link so facebook_ad.domain_id is set correctly.
        id = domainRows[0].id;
        // Only write the date column when the scraper actually resolved one — a blank
        // value must not overwrite an existing real registration date with NULL.
        if (domain_registerd !== null) {
          await repo.updateDomainRegisterDate(sql, id, domain_registerd);
        }
      } else {
        // New domain row: pass the date through as-is (null when blank). The repository
        // strips null keys, so the column falls back to its NULL default.
        const insert_domain = { domain: domain_name, domain_registered_date: domain_registerd };
        id = await repo.insertDomainName(sql, insert_domain);
        if (!id) {
          throw new Error(`Insert failed: could not add domain "${domain_name}" to facebook_ad_domains (no row id returned).`);
        }
      }
      // ACK that insertHtmlRedirectCountry touched this domain.
      await repo.setDomainDodDate(sql, domain_name, new Date().toISOString().slice(0, 19).replace('T', ' '));
    }

    // 6. Normalize country + redirect_status for the found case.
    const country = normalizeCountry(value.country_iso);
    update_meta_table.redirect_status = value.crawled_by === '.net' ? 1 : 4;

    // 7. Whitehat (status 2) / Blackhat (status 1) bookkeeping.
    if (Number(value.status) === 2) {
      dc_black_hat.push(value.html_content); // PHP quirk: whitehat html → dc_blackhat column
      update_meta_table.white_lander_date = date;

      whitehat_screenshot = splitDbList(whitehat_screenshot_db);
      whitehat_screenshot.push(value.screen_shot);
      whitehat_screenshot = uniq(whitehat_screenshot);

      whitehat_zip = splitDbList(whitehat_zip_db);
      whitehat_zip.push(value.html_path);
      whitehat_zip = uniq(whitehat_zip);

      update_meta_table.white_ad_status = Number(value.domain_age) === 1 ? 2 : value.status;
    } else if (Number(value.status) === 1) {
      update_meta_table.blackhat_status = value.status;
      res_black_hat.push(value.html_content);
      update_meta_table.blackhat_date = date;

      blackhat_screenshot = splitDbList(blackhat_screenshot_db);
      blackhat_screenshot.push(value.screen_shot);
      blackhat_screenshot = uniq(blackhat_screenshot);

      blackhat_zip = splitDbList(blackhat_zip_db);
      blackhat_zip.push(value.html_path);
      blackhat_zip = uniq(blackhat_zip);
    }

    // 8. Outgoing links upsert.
    if (Array.isArray(value.outgoing_url) && value.outgoing_url.length > 0) {
      let proxy_lander_status = '';
      let facebook_ad_ids = '';
      for (const end of value.outgoing_url) {
        update_meta_table.outgoing_status = 1;
        if (end.start_url) {
          start_url = start_url === null ? end.start_url : `${start_url}||${end.start_url}`;
        }
        if (end.redirect_urls) {
          const ru = pipeJoin(end.redirect_urls);
          redirect_url = redirect_url === null ? ru : `${redirect_url}||${ru}`;
        }
        if (end.destination_url) {
          final_url = final_url === null ? end.destination_url : `${final_url}||${end.destination_url}`;
        }
        proxy_lander_status = value.status;
        facebook_ad_ids = ad_id;
      }

      const where_urls = {
        source_url: start_url,
        redirect_url,
        final_url,
        facebook_ad_id: facebook_ad_ids,
        proxy_lander_status,
        country_code: country,
      };

      const get_details = await repo.getOutgoingDetails(sql, where_urls);
      if (!get_details[0] || get_details[0].country_code === undefined || get_details[0].country_code === null) {
        const outId = await repo.insertOutgoing(sql, where_urls);
        if (!outId) {
          throw new Error('Insert failed: could not add the outgoing-link row to facebook_ad_outgoing_links (no row id returned).');
        }
      } else {
        let multiple = String(get_details[0].country_code).split('||');
        const post_country = country.split('||');
        for (const v of post_country) {
          if (!multiple.includes(v)) multiple.push(v);
        }
        // PHP re-encodes the merged list back into a "||"-joined uppercase string.
        const merged = pipeJoin(multiple).toUpperCase();
        // PHP passes the matched row's id as the "where" (legacy quirk — see repository).
        await repo.updateOutgoingCountry(sql, get_details[0].id, merged);
      }
    }

    // 9. ad_url redirect rows (type R).
    if (Array.isArray(value.redirects) && value.redirects.length > 0 && value.redirects[0] !== 'NA') {
      for (const rval of value.redirects) {
        const existing = await repo.getDestinationDetails(
          sql,
          { facebook_ad_id: ad_id, url_type: 'R', url: rval, proxy_lander_status: rval },
          'facebook_ad_id'
        );
        if (existing.length === 0) {
          const rId = await repo.insertAdUrl(sql, {
            facebook_ad_id: ad_id,
            url_type: 'R',
            country_code: country,
            type: 0,
            url: rval,
            proxy_lander_status: value.status,
          });
          if (!rId) {
            throw new Error(`Insert failed: could not add redirect URL "${rval}" to facebook_ad_url (no row id returned).`);
          }
          url_redirect = url_redirect === null ? rval : `${url_redirect}||${rval}`;
        }
      }
    }

    // 10. ad_url destination row (type D) — insert or update.
    const destWhere = {
      url_type: 'D',
      facebook_ad_id: ad_id,
      url: value.destinations,
      proxy_lander_status: value.status,
    };
    const destRows = await repo.getDestinationDetails(sql, destWhere, ['facebook_ad_id', 'cat_status']);
    if (destRows.length === 0) {
      const destination_url_data = {
        facebook_ad_id: ad_id,
        url_type: 'D',
        country_code: country,
        type: 1,
        url: value.destinations,
        proxy_lander_status: value.status,
      };
      url_destination = value.destinations;
      // PHP sets cat_status=1 whenever ad_category is present (the legacy `if(=200)` is an
      // assignment, not a comparison). The category-table write itself is out of the
      // 3-endpoint landers scope and is not ported here.
      if (value.ad_category !== undefined && value.ad_category !== null) {
        destination_url_data.cat_status = 1;
      }
      const dId = await repo.insertAdUrl(sql, destination_url_data);
      if (!dId) {
        throw new Error(`Insert failed: could not add destination URL "${value.destinations}" to facebook_ad_url (no row id returned).`);
      }
    } else {
      const destination_url_data = { country_code: country };
      if (value.ad_category !== undefined && value.ad_category !== null && destRows[0].cat_status != 1) {
        destination_url_data.cat_status = 1;
      }
      await repo.updateAdUrl(sql, ad_id, destination_url_data);
    }

    // 11. html_lander_content upsert.
    const insert_html_content = {
      facebook_ad_id: ad_id,
      html_whitehat_lander_text: whitehat.length > 0 ? JSON.stringify(whitehat) : null,
      html_res_blackhat_lander_text: res_black_hat.length > 0 ? JSON.stringify(res_black_hat) : null,
      html_dc_blackhat_lander_text: dc_black_hat.length > 0 ? JSON.stringify(dc_black_hat) : null,
    };
    const htmlRows = await repo.getHtmlLanderDetails(sql, ad_id);
    if (htmlRows.length > 0) {
      const { facebook_ad_id, ...htmlUpdate } = insert_html_content;
      await repo.updateHtmlFile(sql, ad_id, htmlUpdate);
    } else {
      const hId = await repo.insertHtmlFile(sql, insert_html_content);
      if (!hId) {
        throw new Error(`Insert failed: could not add the lander HTML row for ad "${ad_id}" to facebook_ad_html_lander_content (no row id returned).`);
      }
    }

    // 12. facebook_ad.domain_id.
    await repo.updateFacebookAd(sql, ad_id, { domain_id: id });

    // 13. Fold screenshot/zip JSON into the meta update.
    if (blackhat_zip.length > 0) {
      update_meta_table.png_file = JSON.stringify(blackhat_screenshot);
      update_meta_table.blackhat_path = JSON.stringify(blackhat_zip);
    }
    if (whitehat_screenshot.length > 0) {
      update_meta_table.screenshot_url = value.screen_shot;
      update_meta_table.white_ad_screenshot = JSON.stringify(whitehat_screenshot);
      update_meta_table.screenshot_url_status = 2;
      update_meta_table.white_ad_lander = JSON.stringify(whitehat_zip);
    }

    // 14. Meta update → then ES doc update.
    const metaUpd = await repo.updateMeta(sql, ad_id, update_meta_table);
    if (metaUpd === 1) {
      // Resolve nicenames for every country_code stored on this ad's urls.
      const ccRows = await repo.getCountryCodes(sql, ad_id);
      let country_code = [];
      for (const row of ccRows) {
        const cc = row.country_code;
        if (cc !== undefined && cc !== null && cc !== '') {
          const nice = await repo.getNicenameByIso(sql, cc);
          if (nice !== null && nice !== undefined) country_code.push(nice);
        }
      }
      country_code = uniq(country_code);

      await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: esId,
        body: {
          doc: {
            'facebook_ad_html_lander_content.html_whitehat_lander_text': JSON.stringify(whitehat),
            'facebook_ad_html_lander_content.html_dc_blackhat_lander_text': JSON.stringify(dc_black_hat),
            'facebook_ad_html_lander_content.html_res_blackhat_lander_text': JSON.stringify(res_black_hat),
            'facebook_ad_domains.domain_registered_date': domain_registered_date,
            'facebook_ad_outgoing_links.source_url': start_url,
            'facebook_ad_outgoing_links.redirect_url': redirect_url,
            'facebook_ad_outgoing_links.final_url': final_url,
            'facebook_ad_url.url_redirects': url_redirect,
            'facebook_ad_url.url_destination': url_destination,
            'facebook_ad_url.country_code': country_code,
          },
        },
      });

      response.code = 200;
      response.message = 'Destination Lander updated successfully';
    } else {
      response.code = 400;
      response.message = `Update failed: the facebook_ad_meta_data update for ad "${ad_id}" affected 0 rows. `
        + 'Either no meta record exists for this ad or the submitted values were already current — nothing was changed, '
        + 'and the search index was not updated.';
    }
  } catch (e) {
    log?.error?.('landers.insertHtmlRedirectCountry failed', { ad_id, error: e.message, stack: e.stack });
    response.code = 400;
    response.message = `Failed to store the destination lander for ad "${ad_id}": ${e.message}`;
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlRedirectCountry };
