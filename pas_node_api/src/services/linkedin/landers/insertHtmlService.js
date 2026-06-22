'use strict';

/**
 * LinkedIn landers — insert_html_lander (api_linkedin BlackhatController@inserHtmlContentToDB).
 * Same shape as youtube/landers/insertHtmlService.js.
 *
 * Request body: { ad_id, insertData }. insertData: ad_id, country_iso, destinations, html_path,
 * screen_shot, html_content, status, domain_registered_date, crawled_by, domain_age,
 * outgoing_url[], redirects[], ad_category.
 *
 * Pipeline (faithful to the PHP):
 *   ES check (linkedin_ads_data, match ad_id) -> validate -> status-3 short-circuit ->
 *   domain upsert -> country normalize -> blackhat/whitehat bookkeeping -> outgoing_links upsert ->
 *   ad_url redirect(R)/destination(D) upsert -> html_lander upsert -> linkedin_ad.domain_id ->
 *   meta update -> ES doc update.
 *
 * Returns { code, message, exe_time }.
 *
 * LinkedIn schema diffs vs youtube: linkedin_ad_html_lander_content.html_* are NOT NULL (write ''),
 * linkedin_ad_domains has no dod_date column (no setDomainDodDate). Lander columns live on
 * linkedin_ad_meta_data (same as youtube_ad_meta_data).
 */

const repo = require('./repository');
const {
  esHits, pipeJoin, normalizeCountry, splitDbList, uniq, appendZip, extractDomain, toUnixSeconds,
} = require('./transforms');
const { validate } = require('./validate');

const ES_DOC_TYPE = 'doc';

async function insertHtmlContent(req, db, log) {
  const started = Date.now();
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'linkedin_ads_data';

  const body = req.body || {};
  const ad_id = body.ad_id;
  const value = body.insertData;
  const date = new Date().toISOString().slice(0, 10);

  let start_url = null, redirect_url = null, final_url = null;
  let url_redirect = null, url_destination = null;
  let domain_registered_date = null;
  let domain_name = '';
  let id = ''; // domain_id
  let outgoing_urls_raw;

  const whitehat = [];        // never populated -> html_whitehat_lander_text stays ''
  const res_black_hat = [];   // blackhat html_content (status 1)
  const dc_black_hat = [];    // (PHP quirk) whitehat html_content (status 2) lands here
  let whitehat_screenshot = [], blackhat_screenshot = [], whitehat_zip = [], blackhat_zip = [];

  const update_meta_table = {};

  try {
    if (value === undefined || value === null) {
      response.code = 400;
      response.message = 'Empty PostData provided';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    if (!sql || !elastic) {
      response.code = 401;
      response.message = 'Some Error Occured';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }

    // 1. Must exist in Elasticsearch (linkedin_ads_data, match ad_id).
    const esFound = await elastic.search({
      index: ES_INDEX, type: ES_DOC_TYPE, body: { query: { match: { ad_id } } },
    });
    const hits = esHits(esFound);
    if (!hits.length) {
      response.code = 400;
      response.message = 'ad not found';
      response.exe_time = (Date.now() - started) / 1000;
      return response;
    }
    const esId = hits[0]._id;

    update_meta_table.linkedin_ad_id = ad_id;

    // 2. Validate.
    const verr = validate(value);
    if (verr) {
      log?.warn?.('landers.insertHtml validation failed', { ad_id, error: verr });
      response.code = 400;
      response.message = verr;
      return response;
    }

    // 3. Current meta snapshot.
    const metaRows = await repo.getMetaDataDetails(sql, ad_id);
    const m0 = metaRows[0] || {};
    const blackhat_status = m0.blackhat_status;
    const whitehat_status = m0.white_ad_status;
    const whitehat_screenshot_db = m0.white_ad_screenshot;
    const blackhat_screenshot_db = m0.png_file;
    const whitehat_zip_db = m0.white_ad_lander;
    const blackhat_zip_db = m0.blackhat_path;

    // 4. status === 3 -> no response: flip redirect_status only.
    if (Number(value.status) === 3) {
      if (blackhat_status != 1 || whitehat_status != 0 || whitehat_status != 2) {
        update_meta_table.redirect_status = value.crawled_by === '.net' ? 3 : 6;
        const upd = await repo.updateMeta(sql, ad_id, update_meta_table);
        response.code = upd === 1 ? 200 : 400;
        response.message = upd === 1 ? 'Redirect status updated succesfully' : 'Redirect status updated previously';
        response.exe_time = (Date.now() - started) / 1000;
        return response;
      }
    }

    // 5. Domain upsert (no dod_date on linkedin_ad_domains).
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
      dc_black_hat.push(value.html_content);
      update_meta_table.white_lander_date = date;
      whitehat_screenshot = uniq([...splitDbList(whitehat_screenshot_db), value.screen_shot]);
      whitehat_zip = appendZip(whitehat_zip_db, value.html_path);
      update_meta_table.white_ad_status = Number(value.domain_age) === 1 ? 2 : value.status;
    } else if (Number(value.status) === 1) {
      update_meta_table.blackhat_status = value.status;
      res_black_hat.push(value.html_content);
      // NOTE: the LinkedIn meta column is literally named 'blackhat_date-date' (hyphen typo in
      // the live schema) — not 'blackhat_date' like youtube. repo.updateMeta backticks it.
      update_meta_table['blackhat_date-date'] = date;
      blackhat_screenshot = uniq([...splitDbList(blackhat_screenshot_db), value.screen_shot]);
      blackhat_zip = appendZip(blackhat_zip_db, value.html_path);
    }

    // 8. Outgoing links upsert.
    if (Array.isArray(value.outgoing_url) && value.outgoing_url.length > 0) {
      for (const end of value.outgoing_url) {
        update_meta_table.outgoing_status = 1;
        if (end.start_url) start_url = start_url === null ? end.start_url : `${start_url}||${end.start_url}`;
        if (end.redirect_urls) {
          const ru = pipeJoin(end.redirect_urls);
          redirect_url = redirect_url === null ? ru : `${redirect_url}||${ru}`;
        }
        if (end.destination_url) final_url = final_url === null ? end.destination_url : `${final_url}||${end.destination_url}`;
      }
      outgoing_urls_raw = value.outgoing_url;

      const get_details = await repo.getOutgoingDetails(sql, {
        linkedin_ad_id: ad_id, source_url: start_url, redirect_url, final_url,
      });
      if (!get_details[0] || get_details[0].country_code === undefined || get_details[0].country_code === null) {
        await repo.insertOutgoing(sql, {
          linkedin_ad_id: ad_id, source_url: start_url, redirect_url, final_url,
          country_code: country, proxy_lander_status: value.status,
        });
      } else {
        const multiple = String(get_details[0].country_code).split('||');
        for (const v of country.split('||')) if (!multiple.includes(v)) multiple.push(v);
        const merged = pipeJoin(multiple).toUpperCase();
        await repo.updateOutgoingCountry(sql, get_details[0].id, merged);
      }
    }

    // 9. ad_url redirect rows (type R).
    if (Array.isArray(value.redirects) && value.redirects.length > 0 && value.redirects[0] !== 'NA') {
      for (const rval of value.redirects) {
        const existing = await repo.getDestinationDetails(
          sql, { linkedin_ad_id: ad_id, url_type: 'R', url: rval, proxy_lander_status: rval }, 'linkedin_ad_id'
        );
        if (existing.length === 0) {
          await repo.insertAdUrl(sql, {
            linkedin_ad_id: ad_id, url_type: 'R', country_code: country, type: 0, url: rval, proxy_lander_status: value.status,
          });
          url_redirect = url_redirect === null ? rval : `${url_redirect}||${rval}`;
        }
      }
    }

    // 10. ad_url destination row (type D) — update if exists else insert.
    const destRows = await repo.getDestinationDetails(
      sql, { url_type: 'D', linkedin_ad_id: ad_id, url: value.destinations, proxy_lander_status: value.status },
      ['linkedin_ad_id', 'cat_status']
    );
    if (destRows.length > 0) {
      const destination_url_data = { country_code: country };
      if (value.ad_category !== undefined && value.ad_category !== null && destRows[0].cat_status != 1) {
        destination_url_data.cat_status = 1;
      }
      await repo.updateAdUrl(sql, ad_id, destination_url_data);
    } else {
      const destination_url_data = {
        linkedin_ad_id: ad_id, url_type: 'D', country_code: country, type: 1, url: value.destinations, proxy_lander_status: value.status,
      };
      url_destination = value.destinations;
      if (value.ad_category !== undefined && value.ad_category !== null) destination_url_data.cat_status = 1;
      await repo.insertAdUrl(sql, destination_url_data);
    }

    // 11. html_lander_content upsert (NOT NULL cols -> '' when empty).
    const insert_html_content = {
      linkedin_ad_id: ad_id,
      html_whitehat_lander_text: whitehat.length > 0 ? JSON.stringify(whitehat) : '',
      html_res_blackhat_lander_text: res_black_hat.length > 0 ? JSON.stringify(res_black_hat) : '',
      html_dc_blackhat_lander_text: dc_black_hat.length > 0 ? JSON.stringify(dc_black_hat) : '',
    };
    const htmlRows = await repo.getHtmlLanderDetails(sql, ad_id);
    if (htmlRows.length > 0) {
      const { linkedin_ad_id, ...htmlUpdate } = insert_html_content;
      await repo.updateHtmlFile(sql, ad_id, htmlUpdate);
    } else {
      await repo.insertHtmlFile(sql, insert_html_content);
    }

    // 12. main linkedin_ad.domain_id.
    await repo.updateMainAdDomainId(sql, ad_id, id);

    // 13. Fold screenshot/zip JSON into the meta update.
    if (blackhat_screenshot.length > 0) {
      update_meta_table.png_file = JSON.stringify(blackhat_screenshot);
      if (blackhat_zip.length > 0) update_meta_table.blackhat_path = JSON.stringify(blackhat_zip);
    }
    if (whitehat_screenshot.length > 0) {
      update_meta_table.screenshot_url = value.screen_shot;
      update_meta_table.white_ad_screenshot = JSON.stringify(whitehat_screenshot);
      if (whitehat_zip.length > 0) update_meta_table.white_ad_lander = JSON.stringify(whitehat_zip);
    }

    // 14. Meta update -> ES doc update (flat fields).
    const metaUpd = await repo.updateMeta(sql, ad_id, update_meta_table);
    if (metaUpd === 1) {
      await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: esId,
        body: {
          doc: {
            html_text: dc_black_hat.length > 0 ? dc_black_hat[0] : null,
            domain_registration_date: toUnixSeconds(domain_registered_date),
            redirect_urls: url_redirect === null ? null : url_redirect.split('||'),
            outgoing_urls: outgoing_urls_raw === undefined ? [] : outgoing_urls_raw,
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
    log?.error?.('landers.insertHtmlContent failed', { ad_id, error: e.message });
    response.code = 401;
    response.message = 'Some Error Occured';
  }

  response.exe_time = (Date.now() - started) / 1000;
  return response;
}

module.exports = { insertHtmlContent };
