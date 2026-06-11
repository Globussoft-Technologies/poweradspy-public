'use strict';

/**
 * Google landers — insert_html_content (BlackhatController@inserHtmlContentToDBO).
 *
 * Request body: an ARRAY of insert objects (PHP $request->all()); the ES existence
 * check uses postdata[0].ad_id. Each object: ad_id, country_iso, destinations,
 * html_path, screen_shot, html_content, status, domain_registered_date, crawled_by,
 * domain_age, outgoing_url[], redirects[], ad_category.
 *
 * Pipeline (faithful to the PHP):
 *   ES check (google_ads_data, flat `id`) → validate (all required) →
 *   status-3 short-circuit → domain upsert (no dod_date) → country normalize →
 *   blackhat/whitehat bookkeeping → outgoing_links upsert (per entry) →
 *   ad_url redirect(R)/destination(D) upsert → html_lander upsert →
 *   google_text_ad.domain_id → meta update → ES doc update (FLAT fields).
 *
 * Returns { code, message, exe_time }. ES doc fields are FLAT (google_ads_data),
 * not dotted like facebook's search_mix.
 *
 * Legacy quirks preserved (commented): html_whitehat_lander_text always null;
 * whitehat html stored under html_dc_blackhat_lander_text; outgoing update filters
 * by the matched row's id.
 */

const repo = require('./repository');

// ── transforms (mirror the PHP string munging) ───────────────────────────────────
function pipeJoin(value) {
  let s = JSON.stringify(value ?? null);
  s = s.replace(/^\[|\]$/g, '').replace(/"/g, '').replace(/\\\//g, '/').replace(/,/g, '||');
  return s;
}
function normalizeCountry(countryIso) {
  return pipeJoin(countryIso).toUpperCase();
}
function splitDbList(dbValue) {
  if (dbValue === null || dbValue === undefined) return [];
  const s = String(dbValue).replace(/^\[|\]$/g, '').replace(/"/g, '');
  if (s === '') return [];
  return [...new Set(s.split(','))];
}
const uniq = (arr) => [...new Set(arr)];
function extractDomain(destinations) {
  if (!destinations) return null;
  let host;
  try { host = new URL(destinations).hostname; }
  catch { host = String(destinations).replace(/^https?:\/\//i, '').split('/')[0]; }
  const m = String(host || '').match(/([a-z0-9][a-z0-9-]{1,63}\.[a-z.]{2,6})$/i);
  return m ? m[1] : null;
}

// ── validator (PHP: all fields required) ─────────────────────────────────────────
function validate(v) {
  if (v === null || typeof v !== 'object') return 'The insert data is invalid.';
  const required = ['ad_id', 'country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content', 'status', 'domain_registered_date'];
  for (const k of required) {
    if (v[k] === undefined || v[k] === null || v[k] === '') return `The ${k} field is required.`;
  }
  if (v.crawled_by !== '.net' && v.crawled_by !== 'python') return 'The selected crawled by is invalid.';
  return null;
}

const ES_DOC_TYPE = 'doc';

function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}

async function insertHtmlContent(req, db, log) {
  const started = Date.now();
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'google_ads_data';

  const body = req.body;
  const postdata = Array.isArray(body) ? body : (body ? [body] : []);
  const date = new Date().toISOString().slice(0, 10);

  // accumulators (mirror PHP locals)
  let start_url = null, redirect_url = null, final_url = null;
  let url_redirect = null, url_destination = null;
  let domain_registered_date = null;
  let domain_name = '';
  let id = ''; // domain_id

  const whitehat = [];        // PHP: never populated → html_whitehat_lander_text stays "[]"
  const res_black_hat = [];   // blackhat html_content (status 1)
  const dc_black_hat = [];    // (PHP quirk) whitehat html_content (status 2) lands here
  let whitehat_screenshot = [], blackhat_screenshot = [], whitehat_zip = [], blackhat_zip = [];

  const update_meta_table = {};

  try {
    if (!postdata.length) {
      response.code = 400;
      response.message = 'Empty PostData provided';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (!sql || !elastic) {
      response.code = 400;
      response.message = 'Empty PostData provided';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    const firstAdId = postdata[0].ad_id;

    // 1. Must exist in Elasticsearch (google_ads_data, flat id).
    const esFound = await elastic.search({
      index: ES_INDEX, type: ES_DOC_TYPE, body: { query: { match: { id: firstAdId } } },
    });
    const hits = esHits(esFound);
    if (!hits.length) {
      response.code = 400;
      response.message = 'ad not found';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    const esId = hits[0]._id;

    for (const value of postdata) {
      update_meta_table.google_text_ad_id = value.ad_id;

      // 2. Validate.
      const verr = validate(value);
      if (verr) {
        log?.warn?.('landers.insertHtml validation failed', { ad_id: value.ad_id, error: verr });
        response.code = 400;
        response.message = verr;
        return response; // PHP returns immediately
      }

      // 3. Current meta snapshot.
      const metaRows = await repo.getMetaDataDetails(sql, value.ad_id);
      const m0 = metaRows[0] || {};
      const blackhat_status = m0.blackhat_status;
      const whitehat_status = m0.white_ad_status;
      const whitehat_screenshot_db = m0.white_ad_screenshot;
      const blackhat_screenshot_db = m0.png_file;
      const whitehat_zip_db = m0.white_ad_lander;
      const blackhat_zip_db = m0.blackhat_path;

      // 4. status === 3 → no response: flip redirect_status only (PHP always returns here).
      if (Number(value.status) === 3) {
        if (blackhat_status != 1 || whitehat_status != 0 || whitehat_status != 2) {
          update_meta_table.redirect_status = value.crawled_by === '.net' ? 3 : 6;
          const upd = await repo.updateMeta(sql, value.ad_id, update_meta_table);
          response.code = upd === 1 ? 200 : 400;
          response.message = upd === 1 ? 'Redirect status updated succesfully' : 'Redirect status updated previously';
          response.exe_time = (Date.now() - started) / 1000;
          return response;
        }
      }

      // 5. Domain upsert (no dod_date for gtext).
      domain_name = extractDomain(value.destinations);
      if (domain_name) {
        const domainRows = await repo.getDomainId(sql, domain_name);
        domain_registered_date = value.domain_registered_date ?? null;
        if (domainRows[0] && domainRows[0].id != null) {
          if (value.domain_registered_date !== undefined && value.domain_registered_date !== null) {
            id = domainRows[0].id;
            await repo.updateDomainRegisterDate(sql, id, value.domain_registered_date);
          }
        } else {
          const insert_domain = { domain: domain_name };
          if (value.domain_registered_date !== undefined && value.domain_registered_date !== null) {
            insert_domain.domain_registered_date = value.domain_registered_date;
          }
          id = await repo.insertDomainName(sql, insert_domain);
        }
      }

      // 6. Country + redirect_status (found case).
      const country = normalizeCountry(value.country_iso);
      update_meta_table.redirect_status = value.crawled_by === '.net' ? 1 : 4;

      // 7. Whitehat (status 2) / Blackhat (status 1) bookkeeping.
      if (Number(value.status) === 2) {
        dc_black_hat.push(value.html_content); // PHP quirk: whitehat html → dc_blackhat
        update_meta_table.white_lander_date = date;
        whitehat_screenshot = uniq([...splitDbList(whitehat_screenshot_db), value.screen_shot]);
        whitehat_zip = uniq([...splitDbList(whitehat_zip_db), value.html_path]);
        update_meta_table.white_ad_status = Number(value.domain_age) === 1 ? 2 : value.status;
      } else if (Number(value.status) === 1) {
        update_meta_table.blackhat_status = value.status;
        res_black_hat.push(value.html_content);
        update_meta_table.blackhat_date = date;
        blackhat_screenshot = uniq([...splitDbList(blackhat_screenshot_db), value.screen_shot]);
        blackhat_zip = uniq([...splitDbList(blackhat_zip_db), value.html_path]);
      }

      // 8. Outgoing links upsert (per entry — gtext processes each inside the loop).
      if (Array.isArray(value.outgoing_url) && value.outgoing_url.length > 0) {
        for (const end of value.outgoing_url) {
          update_meta_table.outgoing_status = 1;
          const outgoing_url_data = {
            google_text_ad_id: value.ad_id,
            country_code: country,
            proxy_lander_status: value.status,
          };
          if (end.start_url !== undefined) {
            outgoing_url_data.source_url = end.start_url;
            start_url = start_url === null ? end.start_url : `${start_url}||${end.start_url}`;
          }
          if (end.redirect_urls !== undefined) {
            const ru = pipeJoin(end.redirect_urls);
            outgoing_url_data.redirect_url = ru;
            redirect_url = redirect_url === null ? ru : `${redirect_url}||${ru}`;
          }
          if (end.destination_url !== undefined) {
            outgoing_url_data.final_url = end.destination_url;
            final_url = final_url === null ? end.destination_url : `${final_url}||${end.destination_url}`;
          }

          const where_urls = {
            source_url: end.start_url,
            redirect_url: outgoing_url_data.redirect_url,
            final_url: end.destination_url,
            google_text_ad_id: value.ad_id,
            proxy_lander_status: value.status,
          };
          const get_details = await repo.getOutgoingDetails(sql, where_urls);
          if (!get_details[0] || get_details[0].country_code === undefined || get_details[0].country_code === null) {
            await repo.insertOutgoing(sql, outgoing_url_data);
          } else {
            let multiple = String(get_details[0].country_code).split('||');
            for (const v of country.split('||')) {
              if (!multiple.includes(v)) multiple.push(v);
            }
            const merged = pipeJoin(multiple).toUpperCase();
            // PHP passes the matched row's id as the where (legacy quirk).
            await repo.updateOutgoingCountry(sql, get_details[0].id, merged);
          }
        }
      }

      // 9. ad_url redirect rows (type R).
      if (Array.isArray(value.redirects) && value.redirects.length > 0 && value.redirects[0] !== 'NA') {
        for (const rval of value.redirects) {
          const existing = await repo.getDestinationDetails(
            sql, { google_text_ad_id: value.ad_id, url_type: 'R', url: rval, proxy_lander_status: rval }, 'google_text_ad_id'
          );
          if (existing.length === 0) {
            await repo.insertAdUrl(sql, {
              google_text_ad_id: value.ad_id, url_type: 'R', country_code: country,
              type: 0, url: rval, proxy_lander_status: value.status,
            });
            url_redirect = url_redirect === null ? rval : `${url_redirect}||${rval}`;
          }
        }
      }

      // 10. ad_url destination row (type D) — update if exists else insert.
      const destRows = await repo.getDestinationDetails(
        sql, { url_type: 'D', google_text_ad_id: value.ad_id, url: value.destinations, proxy_lander_status: value.status },
        ['google_text_ad_id', 'cat_status']
      );
      if (destRows.length > 0) {
        const destination_url_data = { country_code: country };
        // PHP sets cat_status=1 whenever ad_category present (legacy `if(=200)` assignment).
        if (value.ad_category !== undefined && value.ad_category !== null && destRows[0].cat_status != 1) {
          destination_url_data.cat_status = 1;
        }
        await repo.updateAdUrl(sql, value.ad_id, destination_url_data);
      } else {
        const destination_url_data = {
          google_text_ad_id: value.ad_id, url_type: 'D', country_code: country,
          type: 1, url: value.destinations, proxy_lander_status: value.status,
        };
        if (value.ad_category !== undefined && value.ad_category !== null) destination_url_data.cat_status = 1;
        await repo.insertAdUrl(sql, destination_url_data);
      }
      url_destination = value.destinations;
    }

    const firstAdId2 = postdata[0].ad_id;

    // 11. html_lander_content upsert.
    const insert_html_content = {
      google_text_ad_id: firstAdId2,
      html_whitehat_lander_text: whitehat.length > 0 ? JSON.stringify(whitehat) : null,
      html_res_blackhat_lander_text: res_black_hat.length > 0 ? JSON.stringify(res_black_hat) : null,
      html_dc_blackhat_lander_text: dc_black_hat.length > 0 ? JSON.stringify(dc_black_hat) : null,
    };
    const htmlRows = await repo.getHtmlLanderDetails(sql, firstAdId2);
    if (htmlRows.length > 0) {
      const { google_text_ad_id, ...htmlUpdate } = insert_html_content;
      await repo.updateHtmlFile(sql, firstAdId2, htmlUpdate);
    } else {
      await repo.insertHtmlFile(sql, insert_html_content);
    }

    // 12. main google_text_ad.domain_id.
    await repo.updateMainAdDomainId(sql, firstAdId2, id);

    // 13. Fold screenshot/zip JSON into the meta update.
    if (blackhat_zip.length > 0) {
      update_meta_table.png_file = JSON.stringify(blackhat_screenshot);
      update_meta_table.blackhat_path = JSON.stringify(blackhat_zip);
    }
    if (whitehat_screenshot.length > 0) {
      update_meta_table.white_ad_screenshot = JSON.stringify(whitehat_screenshot);
      update_meta_table.white_ad_lander = JSON.stringify(whitehat_zip);
    }

    // 14. Meta update → ES doc update.
    const metaUpd = await repo.updateMeta(sql, firstAdId2, update_meta_table);
    if (metaUpd === 1) {
      await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: esId,
        body: {
          doc: {
            html_whitehat_lander_text: JSON.stringify(whitehat),
            html_dc_blackhat_lander_text: JSON.stringify(dc_black_hat),
            html_res_blackhat_lander_text: JSON.stringify(res_black_hat),
            domain_registered_date: domain_registered_date,
            domain: domain_name,
            source_url: start_url,
            redirect_url: redirect_url,
            final_url: final_url,
            url_redirects: url_redirect,
            url_destination: url_destination,
          },
        },
      });
      response.code = 200;
      response.message = 'Destination Lander updated successfully';
    } else if (metaUpd === 0) {
      response.code = 400;
      response.message = 'No Changes to Update';
    } else {
      response.code = 400;
      response.message = 'Destination Lander not updated';
    }
  } catch (e) {
    log?.error?.('landers.insertHtmlContent failed', { ad_id: postdata[0]?.ad_id, error: e.message });
    response.code = 400;
    response.message = 'Some Error occurred';
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlContent };
