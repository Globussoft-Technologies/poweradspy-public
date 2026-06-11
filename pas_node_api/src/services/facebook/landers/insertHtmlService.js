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

// ── lightweight validator (mirrors the Laravel rules) ────────────────────────────

function validate(value) {
  const presentKeys = ['country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content', 'domain_registered_date'];
  if (value === null || typeof value !== 'object') return 'The insert data is invalid.';
  if (value.ad_id === undefined || value.ad_id === null || value.ad_id === '') return 'The ad id field is required.';
  if (value.status === undefined || value.status === null || value.status === '') return 'The status field is required.';
  for (const k of presentKeys) {
    if (!(k in value)) return `The ${k} field must be present.`;
  }
  if (value.crawled_by !== '.net' && value.crawled_by !== 'python') {
    return 'The selected crawled by is invalid.';
  }
  return null;
}

const ES_DOC_TYPE = 'doc';

async function insertHtmlRedirectCountry(req, db, log) {
  const started = Date.now();
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'search_mix';

  const body = req.body || {};
  const ad_id = body.ad_id;
  const value = body.insertData;
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
    if (value === undefined || value === null) {
      response.code = 400;
      response.message = 'Some Error occurred';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (!sql || !elastic) {
      response.code = 400;
      response.message = 'Some Error occurred';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 1. Must exist in Elasticsearch.
    const esFound = await elastic.search(searchIdQuery(ES_INDEX, ad_id));
    const esId = firstHitId(esFound);
    if (!esId) {
      response.code = 400;
      response.message = 'ad not found';
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
      domain_registered_date = value.domain_registered_date ?? null;
      const domain_registerd = value.domain_registered_date;

      if (domainRows[0] && domainRows[0].id != null) {
        if (value.domain_registered_date !== undefined && value.domain_registered_date !== null) {
          id = domainRows[0].id;
          await repo.updateDomainRegisterDate(sql, id, domain_registerd);
        }
      } else {
        const insert_domain = { domain: domain_name };
        if (value.domain_registered_date !== undefined && value.domain_registered_date !== null) {
          insert_domain.domain_registered_date = value.domain_registered_date;
        }
        id = await repo.insertDomainName(sql, insert_domain);
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
        await repo.insertOutgoing(sql, where_urls);
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
          await repo.insertAdUrl(sql, {
            facebook_ad_id: ad_id,
            url_type: 'R',
            country_code: country,
            type: 0,
            url: rval,
            proxy_lander_status: value.status,
          });
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
      await repo.insertAdUrl(sql, destination_url_data);
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
      await repo.insertHtmlFile(sql, insert_html_content);
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
      response.message = 'Destination Lander not updated';
    }
  } catch (e) {
    log?.error?.('landers.insertHtmlRedirectCountry failed', { ad_id, error: e.message });
    response.code = 400;
    response.message = 'Some Error occurred';
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlRedirectCountry };
