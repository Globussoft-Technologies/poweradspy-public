'use strict';

/**
 * GDN landers — insert_html_content (BlackhatController@inserHtmlContentToDB).
 *
 * Request body: an ARRAY of insert objects (PHP $request->all()); the ES existence
 * check uses postdata[0].ad_id. Each object: ad_id, country_iso, destinations,
 * html_path, screen_shot, html_content, status, domain_registered_date, crawled_by,
 * domain_age, outgoing_url[], redirects[], ad_category.
 *
 * Pipeline (faithful to the PHP):
 *   ES check (gdn_search_mix, dotted `gdn_ad.id`) → validate → status-3 short-circuit
 *   → domain upsert (no dod_date) → country normalize → blackhat/whitehat bookkeeping
 *   → outgoing_links upsert (per entry) → ad_url redirect(R)/destination(D) upsert →
 *   html_lander upsert → gdn_ad.domain_id → meta update → ES doc update (DOTTED fields).
 *
 * Returns { code, message, exe_time }. ES doc fields are DOTTED (gdn_search_mix,
 * search_mix-style), not flat like google_ads_data.
 *
 * Legacy quirks preserved (commented): html_whitehat_lander_text always null;
 * whitehat html stored under html_dc_blackhat_lander_text; outgoing update filters
 * by the matched row's id. GDN's meta column is plain `blackhat_date` (no hyphen).
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

// ── validator ────────────────────────────────────────────────────────────────────
// html_path & domain_registered_date are OPTIONAL (may be omitted or null).
function validate(v) {
  if (v === null || typeof v !== 'object') return 'The insert data is invalid.';
  const required = ['ad_id', 'country_iso', 'destinations', 'screen_shot', 'html_content', 'status'];
  for (const k of required) {
    if (v[k] === undefined || v[k] === null || v[k] === '') return `The ${k} field is required.`;
  }
  if (v.crawled_by !== '.net' && v.crawled_by !== 'python') return 'The selected crawled by is invalid.';
  return null;
}

// Append html_path to an existing zip list only when it was actually provided
// (optional field — never inject null/undefined into the stored array).
function appendZip(dbValue, htmlPath) {
  const base = splitDbList(dbValue);
  if (htmlPath === undefined || htmlPath === null || htmlPath === '') return uniq(base);
  return uniq([...base, htmlPath]);
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
  const ES_INDEX = elastic?.indexName || 'gdn_search_mix';

  const body = req.body;
  // ONLY the standard wrapped payload { ad_id, insertData: {...} } is accepted.
  // Flat {...} and array [ {...} ] shapes are rejected (postdata stays empty → 400).
  const value = (body && !Array.isArray(body)) ? body.insertData : undefined;
  const postdata = (value !== undefined && value !== null) ? [value] : [];
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

    // 1. Must exist in Elasticsearch (gdn_search_mix, dotted gdn_ad.id).
    const esFound = await elastic.search({
      index: ES_INDEX, type: ES_DOC_TYPE, body: { query: { match: { 'gdn_ad.id': firstAdId } } },
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
      update_meta_table.gdn_ad_id = value.ad_id;

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

      // 5. Domain upsert (no dod_date for GDN).
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
        whitehat_zip = appendZip(whitehat_zip_db, value.html_path);
        update_meta_table.white_ad_status = Number(value.domain_age) === 1 ? 2 : value.status;
      } else if (Number(value.status) === 1) {
        update_meta_table.blackhat_status = value.status;
        res_black_hat.push(value.html_content);
        update_meta_table.blackhat_date = date; // GDN column is plain `blackhat_date`
        blackhat_screenshot = uniq([...splitDbList(blackhat_screenshot_db), value.screen_shot]);
        blackhat_zip = appendZip(blackhat_zip_db, value.html_path);
      }

      // 8. Outgoing links upsert (per entry — GDN processes each inside the loop).
      if (Array.isArray(value.outgoing_url) && value.outgoing_url.length > 0) {
        for (const end of value.outgoing_url) {
          update_meta_table.outgoing_status = 1;
          const outgoing_url_data = {
            gdn_ad_id: value.ad_id,
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
            gdn_ad_id: value.ad_id,
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
            sql, { gdn_ad_id: value.ad_id, url_type: 'R', url: rval, proxy_lander_status: rval }, 'gdn_ad_id'
          );
          if (existing.length === 0) {
            await repo.insertAdUrl(sql, {
              gdn_ad_id: value.ad_id, url_type: 'R', country_code: country,
              type: 0, url: rval, proxy_lander_status: value.status,
            });
            url_redirect = url_redirect === null ? rval : `${url_redirect}||${rval}`;
          }
        }
      }

      // 10. ad_url destination row (type D) — update if exists else insert.
      const destRows = await repo.getDestinationDetails(
        sql, { url_type: 'D', gdn_ad_id: value.ad_id, url: value.destinations, proxy_lander_status: value.status },
        ['gdn_ad_id', 'cat_status']
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
          gdn_ad_id: value.ad_id, url_type: 'D', country_code: country,
          type: 1, url: value.destinations, proxy_lander_status: value.status,
        };
        await repo.insertAdUrl(sql, destination_url_data);
      }
      url_destination = value.destinations;
    }

    const firstAdId2 = postdata[0].ad_id;

    // 11. html_lander_content upsert.
    const insert_html_content = {
      gdn_ad_id: firstAdId2,
      html_whitehat_lander_text: whitehat.length > 0 ? JSON.stringify(whitehat) : null,
      html_res_blackhat_lander_text: res_black_hat.length > 0 ? JSON.stringify(res_black_hat) : null,
      html_dc_blackhat_lander_text: dc_black_hat.length > 0 ? JSON.stringify(dc_black_hat) : null,
    };
    const htmlRows = await repo.getHtmlLanderDetails(sql, firstAdId2);
    if (htmlRows.length > 0) {
      const { gdn_ad_id, ...htmlUpdate } = insert_html_content;
      await repo.updateHtmlFile(sql, firstAdId2, htmlUpdate);
    } else {
      await repo.insertHtmlFile(sql, insert_html_content);
    }

    // 12. main gdn_ad.domain_id.
    await repo.updateMainAdDomainId(sql, firstAdId2, id);

    // 13. Fold screenshot/zip JSON into the meta update.
    if (blackhat_screenshot.length > 0) {
      update_meta_table.png_file = JSON.stringify(blackhat_screenshot);
      if (blackhat_zip.length > 0) update_meta_table.blackhat_path = JSON.stringify(blackhat_zip);
    }
    if (whitehat_screenshot.length > 0) {
      update_meta_table.white_ad_screenshot = JSON.stringify(whitehat_screenshot);
      if (whitehat_zip.length > 0) update_meta_table.white_ad_lander = JSON.stringify(whitehat_zip);
    }

    // 14. Meta update → ES doc update (DOTTED search_mix fields).
    const metaUpd = await repo.updateMeta(sql, firstAdId2, update_meta_table);
    if (metaUpd === 1) {
      // Resolve gdn_ad_url country_code values (ISO) back to nicenames for ES.
      const countryRows = await repo.getCountryCodes(sql, firstAdId2);
      const country_code = [];
      for (const r of countryRows) {
        const v = r.country_code;
        if (v !== undefined && v !== null && v !== '') {
          const nicename = await repo.getNicenameByIso(sql, v);
          if (nicename) country_code.push(nicename);
        }
      }
      const country_code_unique = uniq(country_code);

      await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: esId,
        body: {
          doc: {
            'gdn_ad_html_lander_content.html_whitehat_lander_text': JSON.stringify(whitehat),
            'gdn_ad_html_lander_content.html_dc_blackhat_lander_text': JSON.stringify(dc_black_hat),
            'gdn_ad_html_lander_content.html_res_blackhat_lander_text': JSON.stringify(res_black_hat),
            'gdn_ad_domains.domain_registered_date': domain_registered_date,
            'gdn_ad_outgoing_links.source_url': start_url,
            'gdn_ad_outgoing_links.redirect_url': redirect_url,
            'gdn_ad_outgoing_links.final_url': final_url,
            'gdn_ad_url.url_redirects': url_redirect,
            'gdn_ad_url.url_destination': url_destination,
            'gdn_ad_url.country_code': country_code_unique,
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
    log?.error?.('landers.insertHtmlContent failed', { ad_id: postdata[0]?.ad_id, error: e.message, stack: e.stack });
    response.code = 400;
    response.message = 'Some Error occurred';
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlContent };
