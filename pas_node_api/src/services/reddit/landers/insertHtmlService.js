'use strict';

const repo = require('./repository');

/**
 * insertHtmlRedirectCountry — inserts/updates lander data across multiple tables
 * and updates Elasticsearch index (reddit_search_mix).
 *
 * Mirrors PHP: BlackhatController@insertHtmlContentToDB
 *
 * Tables touched:
 *  - reddit_ad_meta_data
 *  - reddit_ad_url
 *  - reddit_ad_outgoing_links
 *  - reddit_ad_html_lander_content
 *  - reddit_ad_domain
 *  - reddit_ad (domain_id)
 *  - reddit_ad_categories / ad_categories
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
  return countryArray
    .map(c => String(c).trim())
    .join('||')
    .toUpperCase();
}

function mergeCountries(existingCountry, newCountry) {
  const existing = existingCountry ? existingCountry.split('||') : [];
  const newCountries = newCountry ? newCountry.split('||') : [];
  const merged = [...new Set([...existing, ...newCountries])];
  return merged.join('||');
}

/**
 * Updates ad category in DB and ES (mirrors PHP helper::updateAdCategory)
 */
async function updateAdCategory(adId, categories, db, log) {
  try {
    const existing = await repo.checkCategoryExist(adId);

    let finalCategories;
    if (existing) {
      // Merge with existing categories
      let domainCategory = [];
      try {
        domainCategory = JSON.parse(existing.ad_categories || '[]');
      } catch (e) {
        domainCategory = [];
      }
      for (const cat of categories) {
        if (!domainCategory.includes(cat)) {
          domainCategory.push(cat);
        }
      }
      finalCategories = domainCategory;
      await repo.updateCategory(adId, JSON.stringify(finalCategories));
    } else {
      finalCategories = categories;
      await repo.insertAdCategory({
        reddit_ad_id: adId,
        ad_categories: JSON.stringify(categories)
      });
    }

    // Insert new categories into the ad_categories lookup table
    const categoryArray = categories.length > 1 ? categories : categories;
    const allCategories = await repo.getAllCategories();
    const diff = categoryArray.filter(c => !allCategories.includes(c));
    for (const cat of diff) {
      await repo.insertCategory(cat);
    }

    // Update category in ES
    try {
      const esResult = await db.elastic.search({
        index: 'reddit_search_mix',
        body: {
          query: { match: { 'reddit_ad.id': adId } },
          size: 1
        }
      });
      const hits = esResult?.body?.hits?.hits || esResult?.hits?.hits || [];
      if (hits.length > 0) {
        await db.elastic.update({
          index: 'reddit_search_mix',
          type: 'doc',
          id: hits[0]._id,
          body: {
            doc: {
              'reddit_ad.ad_category': finalCategories
            }
          }
        });
      }
    } catch (err) {
      log?.error(`[reddit-landers] Error updating category in ES: ${err.message}`);
    }

    return { code: 200, message: 'Category successfully updated' };
  } catch (err) {
    log?.error(`[reddit-landers] Error in updateAdCategory: ${err.message}`);
    return { code: 400, message: 'Error occurred in updating category' };
  }
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

    const items = Array.isArray(payload) ? payload : [payload];
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
        index: 'reddit_search_mix',
        body: {
          query: { match: { 'reddit_ad.id': adId } },
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
      log?.warn(`[reddit-landers] ES search failed for ad ${adId}: ${err.message}`);
    }

    // Accumulators for ES update
    let startUrl = null;
    let redirectUrl = null;
    let finalUrl = null;
    let urlRedirect = null;
    let urlDestination = null;
    let domainRegisteredDate = null;
    const countryCode = [];

    const whitehatScreenshot = [];
    const blackhatScreenshot = [];
    const whitehatZip = [];
    const blackhatZip = [];
    const resBlackHat = [];
    const dcBlackHat = [];
    const whitehat = [];

    const date = new Date().toISOString().split('T')[0];
    let domainId = null;
    let lastResponse = { code: 200, message: 'Success' };

    for (const item of items) {
      const itemStatus = Number(item.status);

      // ─── Status 3: no response, just update redirect_status ─────
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
              message: updateResult > 0
                ? 'Redirect status updated succesfully'
                : 'Redirect status updated previously',
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

      // ─── Status 1 or 2: full processing ─────────────────────────

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

            domainRegisteredDate = item.domain_registered_date || null;
          }
        } catch (err) {
          log?.warn(`[reddit-landers] Error parsing destination URL: ${err.message}`);
        }
      }

      // Normalize country codes
      const countryISO = normalizeCountry(item.country_iso || []);

      // Set redirect_status based on crawled_by
      const redirectStatus = item.crawled_by === '.net' ? 1 : 4;
      const updateMeta = { redirect_status: redirectStatus };

      // ─── Whitehat (status 2) ────────────────────────────────
      if (itemStatus === 2) {
        whitehat.push(item.html_content);
        dcBlackHat.push(item.html_content);
        updateMeta.white_lander_date = date;

        if (item.domain_age === 1) {
          updateMeta.white_ad_status = 2;
        } else {
          updateMeta.white_ad_status = itemStatus;
        }

        whitehatScreenshot.push(item.screen_shot);
        whitehatZip.push(item.html_path);
      }
      // ─── Blackhat (status 1) ────────────────────────────────
      else if (itemStatus === 1) {
        updateMeta.blackhat_status = 1;
        resBlackHat.push(item.html_content);
        updateMeta.blackhat_date = date;

        blackhatScreenshot.push(item.screen_shot);
        blackhatZip.push(item.html_path);
      }

      // ─── Outgoing URLs ──────────────────────────────────────
      if (item.outgoing_url && Array.isArray(item.outgoing_url) && item.outgoing_url.length > 0) {
        updateMeta.outgoing_status = 1;

        for (const outgoing of item.outgoing_url) {
          const redirectUrls = (outgoing.redirect_urls || [])
            .map(u => String(u).replace(/\//g, '/').trim())
            .join('||');

          const outgoingData = {
            reddit_ad_id: item.ad_id,
            source_url: outgoing.start_url || null,
            redirect_url: redirectUrls || null,
            final_url: outgoing.destination_url || null,
            country_code: countryISO,
            proxy_lander_status: itemStatus
          };

          // Accumulate for ES update
          if (outgoing.start_url) {
            startUrl = startUrl ? startUrl + '||' + outgoing.start_url : outgoing.start_url;
          }
          if (redirectUrls) {
            redirectUrl = redirectUrl ? redirectUrl + '||' + redirectUrls : redirectUrls;
          }
          if (outgoing.destination_url) {
            finalUrl = finalUrl ? finalUrl + '||' + outgoing.destination_url : outgoing.destination_url;
          }

          // Check if outgoing already exists
          const whereUrls = {
            source_url: outgoing.start_url,
            redirect_url: redirectUrls,
            final_url: outgoing.destination_url,
            reddit_ad_id: item.ad_id,
            proxy_lander_status: itemStatus
          };

          const existing = await repo.getAdOutgoingDetails(whereUrls);

          if (!existing || existing.length === 0) {
            await repo.insertAdOutgoing(outgoingData);
          } else {
            const mergedCountry = mergeCountries(existing[0].country_code, countryISO);
            await repo.updateAdOutgoing(existing[0].id, mergedCountry);
          }
        }
      }

      // ─── Redirect URLs ─────────────────────────────────────
      if (item.redirects && Array.isArray(item.redirects) && item.redirects.length > 0 && item.redirects[0] !== 'NA') {
        for (const rval of item.redirects) {
          const existingRedirect = await repo.getAdUrlRedirect(item.ad_id, rval, itemStatus);

          if (!existingRedirect || existingRedirect.length === 0) {
            await repo.insertAdUrl({
              reddit_ad_id: item.ad_id,
              url_type: 'R',
              country_code: countryISO,
              type: 0,
              url: rval,
              proxy_lander_status: itemStatus
            });

            urlRedirect = urlRedirect ? urlRedirect + '||' + rval : rval;
          }
        }
      }

      // ─── Destination URL ───────────────────────────────────
      const existingDest = await repo.getAdUrlDestination(item.ad_id, item.destinations, itemStatus);

      if (existingDest && existingDest.length > 0) {
        const destUpdateData = { country_code: countryISO };

        // Handle ad_category update
        if (item.ad_category && existingDest[0].cat_status !== 1) {
          const catResult = await updateAdCategory(item.ad_id, item.ad_category, db, log);
          if (catResult.code === 200) destUpdateData.cat_status = 1;
        }

        await repo.updateAdUrl(item.ad_id, destUpdateData);
      } else {
        const destInsertData = {
          reddit_ad_id: item.ad_id,
          url_type: 'D',
          country_code: countryISO,
          type: 1,
          url: item.destinations,
          proxy_lander_status: itemStatus
        };

        if (item.ad_category) {
          const catResult = await updateAdCategory(item.ad_id, item.ad_category, db, log);
          if (catResult.code === 200) destInsertData.cat_status = 1;
        }

        urlDestination = item.destinations;
        await repo.insertAdUrl(destInsertData);
      }
    }

    // ─── HTML lander content ─────────────────────────────────
    const htmlContent = {
      reddit_ad_id: adId
    };

    if (whitehat.length > 0) htmlContent.html_whitehat_lander_text = JSON.stringify(whitehat);
    if (resBlackHat.length > 0) htmlContent.html_res_blackhat_lander_text = JSON.stringify(resBlackHat);
    if (dcBlackHat.length > 0) htmlContent.html_dc_blackhat_lander_text = JSON.stringify(dcBlackHat);

    const existingHtml = await repo.getHtmlLander(adId);
    if (existingHtml) {
      const { reddit_ad_id, ...updateData } = htmlContent;
      if (Object.keys(updateData).length > 0) {
        await repo.updateHtmlLander(adId, updateData);
      }
    } else {
      await repo.insertHtmlLander(htmlContent);
    }

    // ─── Update domain_id in main table ──────────────────────
    if (domainId) {
      await repo.updateAdDomainId(adId, domainId);
    }

    // ─── Update meta data ────────────────────────────────────
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

    // Merge status fields from per-item processing
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

    if (items.some(i => i.outgoing_url && i.outgoing_url.length > 0)) {
      metaUpdate.outgoing_status = 1;
    }

    const metaUpdateResult = await repo.updateAdMetaData(adId, metaUpdate);

    if (metaUpdateResult > 0) {
      // ─── Elasticsearch update ──────────────────────────────
      try {
        // Get country names for ES
        const countryCodeList = await repo.getCountryCodeList(adId);
        const isoCodes = countryCodeList.map(c => c.country_code).filter(Boolean);
        const countryNames = await repo.getCountryNames(isoCodes);
        const resolvedCountryNames = [...new Set(countryNames.map(c => c.nicename))];

        const esUpdate = {};

        if (whitehat.length > 0) {
          esUpdate['reddit_ad_html_lander_content.html_whitehat_lander_text'] = JSON.stringify(whitehat);
        }
        if (dcBlackHat.length > 0) {
          esUpdate['reddit_ad_html_lander_content.html_dc_blackhat_lander_text'] = JSON.stringify(dcBlackHat);
        }
        if (resBlackHat.length > 0) {
          esUpdate['reddit_ad_html_lander_content.html_res_blackhat_lander_text'] = JSON.stringify(resBlackHat);
        }

        if (domainRegisteredDate) {
          esUpdate['reddit_ad_domain.domain_registered_date'] = domainRegisteredDate;
        }
        if (startUrl) esUpdate['reddit_ad_outgoing_links.source_url'] = startUrl;
        if (redirectUrl) esUpdate['reddit_ad_outgoing_links.redirect_url'] = redirectUrl;
        if (finalUrl) esUpdate['reddit_ad_outgoing_links.final_url'] = finalUrl;
        if (urlRedirect) esUpdate['reddit_ad_url.url_redirects'] = urlRedirect;
        if (urlDestination) esUpdate['reddit_ad_url.url_destination'] = urlDestination;
        if (resolvedCountryNames.length > 0) {
          esUpdate['reddit_ad_url.country_code'] = resolvedCountryNames;
        }

        if (Object.keys(esUpdate).length > 0 && esDocId) {
          await db.elastic.update({
            index: 'reddit_search_mix',
            type: 'doc',
            id: esDocId,
            body: { doc: esUpdate }
          });
        }
      } catch (err) {
        log?.error(`[reddit-landers] ES update failed for ad ${adId}: ${err.message}`);
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
    log?.error(`[reddit-landers] Error in insertHtmlRedirectCountry: ${error.message}`);
    return {
      code: 401,
      message: 'Some Error Occured',
      error: error.message,
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  insertHtmlRedirectCountry
};
