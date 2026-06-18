'use strict';

const repo = require('./repository');

/**
 * insertHtmlRedirectCountry — inserts/updates lander data across multiple tables
 * and updates Elasticsearch index (pinterest_search_mix).
 *
 * Mirrors PHP: BlackhatController@inserHtmlContentToDB
 *
 * Tables touched:
 *  - pinterest_ad_meta_data
 *  - pinterest_ad_url
 *  - pinterest_ad_outgoing_links
 *  - pinterest_ad_html_lander_content
 *  - pinterest_ad_domains
 *  - pinterest_ad (domain_id)
 */

function validateItem(item) {
  const required = ['ad_id', 'country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content', 'status', 'crawled_by'];
  for (const field of required) {
    if (!(field in item)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }
  if (!['1', '2', '3'].includes(String(item.status))) {
    return { valid: false, error: 'status must be 1, 2, or 3' };
  }
  if (!['.net', 'python'].includes(String(item.crawled_by))) {
    return { valid: false, error: 'crawled_by must be .net or python' };
  }
  return { valid: true };
}

function normalizeCountry(countryArray) {
  // Accept an array, or a single/`||`/comma-separated string.
  const list = Array.isArray(countryArray)
    ? countryArray
    : String(countryArray || '').split(/[|,]+/);
  return list
    .map(c => String(c).trim())
    .filter(Boolean)
    .join('||')
    .toUpperCase();
}

function mergeCountries(existingCountry, newCountry) {
  const existing = existingCountry ? existingCountry.split('||') : [];
  const newCountries = newCountry ? newCountry.split('||') : [];
  const merged = [...new Set([...existing, ...newCountries])];
  return merged.join('||');
}

async function insertHtmlRedirectCountry(req, db, log) {
  const startTime = Date.now();

  try {
    const payload = req.body;

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return {
        code: 400,
        message: 'Empty PostData provided',
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    const rawItems = Array.isArray(payload) ? payload : [payload];
    // All lander payloads must use the `insertData` wrapper.
    const items = rawItems.map((item) =>
      item && item.insertData ? item.insertData : null
    );
    if (items.some((item) => !item)) {
      return {
        code: 400,
        message: 'insertData wrapper is required',
        exe_time: (Date.now() - startTime) / 1000
      };
    }
    const adId = items[0]?.ad_id;

    // Validate all items
    for (let i = 0; i < items.length; i++) {
      const validation = validateItem(items[i]);
      if (!validation.valid) {
        return {
          code: 400,
          message: validation.error,
          exe_time: (Date.now() - startTime) / 1000
        };
      }
    }

    // Check if ad exists in Elasticsearch
    let esDocId = null;
    try {
      const esResult = await db.elastic.search({
        index: 'pinterest_search_mix',
        body: {
          query: { match: { 'pinterest_ad.id': adId } },
          size: 1
        }
      });
      const hits = esResult?.body?.hits?.hits || esResult?.hits?.hits || [];
      if (hits.length === 0) {
        return {
          code: 400,
          message: 'ad not found',
          exe_time: (Date.now() - startTime) / 1000
        };
      }
      esDocId = hits[0]._id;
    } catch (err) {
      log?.warn(`[pinterest-landers] ES search failed for ad ${adId}: ${err.message}`);
    }

    const date = new Date().toISOString().split('T')[0];
    let domainId = null;
    let lastResponse = { code: 200, message: 'Success' };

    // Accumulators for paths and content
    const whitehatScreenshot = [];
    const blackhatScreenshot = [];
    const whitehatZip = [];
    const blackhatZip = [];
    const whitehat = [];
    const resBlackHat = [];
    const dcBlackHat = [];

    for (const item of items) {
      const itemStatus = Number(item.status);

      // Status 3: no response, just update redirect_status
      if (itemStatus === 3) {
        const metaData = await repo.getAdMetaData(item.ad_id);
        if (metaData) {
          const bStatus = metaData.blackhat_status;
          const wStatus = metaData.white_ad_status;

          if (bStatus !== 1 || wStatus !== 0 || wStatus !== 2) {
            const redirectStatus = item.crawled_by === '.net' ? 3 : 6;
            const updateResult = await repo.updateAdMetaData(item.ad_id, {
              redirect_status: redirectStatus
            });

            return {
              code: updateResult > 0 ? 200 : 400,
              message: updateResult > 0 ? 'Redirect status updated succesfully' : 'Redirect status updated previously',
              exe_time: (Date.now() - startTime) / 1000
            };
          }
        }
        return {
          code: 400,
          message: 'Redirect Status not updated or already updated',
          exe_time: (Date.now() - startTime) / 1000
        };
      }

      // Domain management
      if (item.destinations) {
        try {
          const urlObj = new URL(item.destinations);
          const hostname = urlObj.hostname;
          const domainMatch = hostname.match(/(?:[a-z0-9](?:[a-z0-9\-]{1,63})?\.)+[a-z\.]{2,6}$/i);

          if (domainMatch) {
            const domainName = domainMatch[0];
            const existingDomain = await repo.getDomainIdByDomain(domainName);

            if (existingDomain) {
              domainId = existingDomain;
              if (item.domain_registered_date) {
                await repo.updateDomain(domainId, item.domain_registered_date);
              }
            } else {
              const insertData = { domain: domainName };
              if (item.domain_registered_date) {
                insertData.domain_registered_date = item.domain_registered_date;
              }
              domainId = await repo.insertDomain(insertData);
            }

            // Update ad with domain_id
            await repo.updateAdDomainId(item.ad_id, domainId);
          }
        } catch (err) {
          log?.warn(`[pinterest-landers] Error parsing destination URL: ${err.message}`);
        }
      }

      // Normalize country codes
      const countryISO = normalizeCountry(Array.isArray(item.country_iso) ? item.country_iso : [item.country_iso]);

      // Accumulate paths and content
      if (itemStatus === 2) {
        whitehat.push(item.html_content);
        dcBlackHat.push(item.html_content);
        whitehatScreenshot.push(item.screen_shot);
        whitehatZip.push(item.html_path);
      } else if (itemStatus === 1) {
        resBlackHat.push(item.html_content);
        blackhatScreenshot.push(item.screen_shot);
        blackhatZip.push(item.html_path);
      }

      // Outgoing URLs
      if (item.outgoing_url && Array.isArray(item.outgoing_url) && item.outgoing_url.length > 0) {
        for (const outgoing of item.outgoing_url) {
          const redirectUrls = (outgoing.redirect_urls || [])
            .map(u => String(u).trim())
            .join('||');

          const outgoingData = {
            pinterest_ad_id: item.ad_id,
            source_url: outgoing.start_url || null,
            redirect_url: redirectUrls || null,
            final_url: outgoing.destination_url || null,
            country_code: countryISO,
            proxy_lander_status: itemStatus
          };

          const existing = await repo.getAdOutgoingDetails(outgoingData);

          if (!existing || existing.length === 0) {
            await repo.insertAdOutgoing(outgoingData);
          } else {
            const mergedCountry = mergeCountries(existing[0].country_code, countryISO);
            await repo.updateAdOutgoing(existing[0].id, mergedCountry);
          }
        }
      }

      // Redirect URLs
      if (item.redirects && Array.isArray(item.redirects) && item.redirects[0] !== 'NA') {
        for (const rval of item.redirects) {
          const existingRedirect = await repo.getAdUrlRedirect(item.ad_id, rval, itemStatus);

          if (!existingRedirect || existingRedirect.length === 0) {
            await repo.insertAdUrl({
              pinterest_ad_id: item.ad_id,
              url_type: 'R',
              country_code: countryISO,
              type: 0,
              url: rval,
              proxy_lander_status: itemStatus
            });
          }
        }
      }

      // Destination URL
      const existingDest = await repo.getAdUrlDestination(item.ad_id, item.destinations, itemStatus);

      if (existingDest && existingDest.length > 0) {
        await repo.updateAdUrl(item.ad_id, { country_code: countryISO });
      } else {
        await repo.insertAdUrl({
          pinterest_ad_id: item.ad_id,
          url_type: 'D',
          country_code: countryISO,
          type: 1,
          url: item.destinations,
          proxy_lander_status: itemStatus
        });
      }

      // HTML lander content
      const htmlContent = {
        pinterest_ad_id: item.ad_id,
        html_res_blackhat_lander_text: itemStatus === 1 ? item.html_content : null,
        html_whitehat_lander_text: itemStatus === 2 ? item.html_content : null
      };

      const existingHtml = await repo.getHtmlLander(item.ad_id);
      if (existingHtml) {
        const updateData = {};
        if (itemStatus === 1) updateData.html_res_blackhat_lander_text = item.html_content;
        if (itemStatus === 2) updateData.html_whitehat_lander_text = item.html_content;
        if (Object.keys(updateData).length > 0) {
          await repo.updateHtmlLander(item.ad_id, updateData);
        }
      } else {
        await repo.insertHtmlLander(htmlContent);
      }
    }

    // ─── Update meta data with merged paths ────────────────────
    const metaUpdate = {};

    // Get existing meta data to merge screenshots/zips
    const metaData = await repo.getAdMetaData(adId);

    if (blackhatZip.length > 0) {
      let existingZips = [];
      if (metaData?.blackhat_path) {
        try {
          const trimmed = metaData.blackhat_path.trim().replace(/^\[/, '').replace(/\]$/, '');
          const cleaned = trimmed.replace(/"/g, '');
          existingZips = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
        } catch (e) { existingZips = []; }
      }
      metaUpdate.blackhat_path = JSON.stringify([...new Set([...existingZips, ...blackhatZip])]);
    }

    if (blackhatScreenshot.length > 0) {
      let existingScreenshots = [];
      if (metaData?.png_file) {
        try {
          const trimmed = metaData.png_file.trim().replace(/^\[/, '').replace(/\]$/, '');
          const cleaned = trimmed.replace(/"/g, '');
          existingScreenshots = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
        } catch (e) { existingScreenshots = []; }
      }
      metaUpdate.png_file = JSON.stringify([...new Set([...existingScreenshots, ...blackhatScreenshot])]);
    }

    if (whitehatScreenshot.length > 0) {
      let existingScreenshots = [];
      if (metaData?.white_ad_screenshot) {
        try {
          const trimmed = metaData.white_ad_screenshot.trim().replace(/^\[/, '').replace(/\]$/, '');
          const cleaned = trimmed.replace(/"/g, '');
          existingScreenshots = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
        } catch (e) { existingScreenshots = []; }
      }
      metaUpdate.white_ad_screenshot = JSON.stringify([...new Set([...existingScreenshots, ...whitehatScreenshot])]);
    }

    if (whitehatZip.length > 0) {
      let existingZips = [];
      if (metaData?.white_ad_lander) {
        try {
          const trimmed = metaData.white_ad_lander.trim().replace(/^\[/, '').replace(/\]$/, '');
          const cleaned = trimmed.replace(/"/g, '');
          existingZips = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
        } catch (e) { existingZips = []; }
      }
      metaUpdate.white_ad_lander = JSON.stringify([...new Set([...existingZips, ...whitehatZip])]);
    }

    // Status flags from last item
    const lastItem = items[items.length - 1];
    const lastItemStatus = Number(lastItem.status);
    metaUpdate.redirect_status = lastItem.crawled_by === '.net' ? 1 : 4;

    if (lastItemStatus === 1) {
      metaUpdate.blackhat_status = 1;
      metaUpdate.blackhat_date = date;
    } else if (lastItemStatus === 2) {
      metaUpdate.white_lander_date = date;
      metaUpdate.white_ad_status = lastItem.domain_age === 1 ? 2 : lastItemStatus;
    }

    // Set outgoing_status if any items have outgoing URLs
    if (items.some(i => i.outgoing_url && i.outgoing_url.length > 0)) {
      metaUpdate.outgoing_status = 1;
    }

    const metaUpdateResult = await repo.updateAdMetaData(adId, metaUpdate);

    if (metaUpdateResult > 0) {
      // ES update
      try {
        const esUpdate = {};

        for (const item of items) {
          if (item.status === 1) {
            esUpdate['pinterest_ad_html_lander_content.html_res_blackhat_lander_text'] = item.html_content;
          }
          if (item.status === 2) {
            esUpdate['pinterest_ad_html_lander_content.html_dc_blackhat_lander_text'] = item.html_content;
          }
        }

        if (Object.keys(esUpdate).length > 0 && esDocId) {
          await db.elastic.update({
            index: 'pinterest_search_mix',
            type: 'doc',
            id: esDocId,
            body: { doc: esUpdate }
          });
        }
      } catch (err) {
        log?.error(`[pinterest-landers] ES update failed for ad ${adId}: ${err.message}`);
      }

      lastResponse = {
        code: 200,
        message: 'Destination Lander updated successfully',
        exe_time: (Date.now() - startTime) / 1000
      };
    } else {
      lastResponse = {
        code: 400,
        message: 'Destination Lander not updated',
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    return lastResponse;
  } catch (error) {
    log?.error(`[pinterest-landers] Error in insertHtmlRedirectCountry: ${error.message}`);
    return {
      code: 401,
      message: 'Some Error Occurred',
      error: error.message,
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  insertHtmlRedirectCountry
};
