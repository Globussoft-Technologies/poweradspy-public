'use strict';

const repo = require('./repository');

function validateItem(item) {
  // html_path is OPTIONAL (may be omitted) — mirrors gdn/google/youtube/linkedin.
  const required = ['ad_id', 'country_iso', 'destinations', 'screen_shot', 'html_content', 'status', 'crawled_by'];
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

function normalizeCourses(countryArray) {
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

    // Check if ad exists in Elasticsearch (skip if not found, don't fail)
    let esResult = null;
    try {
      esResult = await db.elastic.search({
        index: 'quora_search_mix',
        body: {
          query: { match: { 'quora_ad.id': adId } },
          size: 1
        }
      });
    } catch (err) {
      log?.warn(`ES search failed for ad ${adId}, continuing...`);
    }

    let lastResponse = { code: 200, message: 'Success' };

    for (const item of items) {
      if (item.status === 3) {
        // Status 3: only update redirect_status
        const metaData = await repo.getAdMetaData(item.ad_id);
        if (!metaData) {
          return {
            code: 400,
            message: 'Redirect Status not updated or already updated',
            exe_time: (Date.now() - startTime) / 1000
          };
        }

        const redirectStatus = item.crawled_by === '.net' ? 3 : 6;
        const updateResult = await repo.updateAdMetaData( item.ad_id, {
          redirect_status: redirectStatus
        });

        lastResponse = {
          code: updateResult.code,
          message: updateResult.code === 200
            ? 'Redirect status updated successfully'
            : 'Redirect status not updated or already updated',
          exe_time: (Date.now() - startTime) / 1000
        };
        return lastResponse;
      }

      // Status 1 or 2: full insertion
      let domainId = null;
      let domainRegisteredDate = null;

      // Extract domain from destination URL
      if (item.destinations) {
        const url = new URL(item.destinations);
        const domain = url.hostname;
        const domainMatch = domain.match(/(?:[a-z0-9](?:[a-z0-9-]{1,63}[a-z0-9])?\.)+[a-z]{2,6}$/i);

        if (domainMatch) {
          const domainName = domainMatch[0];
          domainId = await repo.getDomainIdByDomain( domainName);

          if (!domainId) {
            domainId = await repo.insertDomain( {
              domain: domainName,
              domain_registered_date: item.domain_registered_date || null
            });
          } else if (item.domain_registered_date) {
            await repo.updateDomain( domainId, item.domain_registered_date);
          }

          domainRegisteredDate = item.domain_registered_date;

          // Update ad with domain_id
          await repo.updateAdDomainId( item.ad_id, domainId);
        }
      }

      // Normalize country codes
      const countryISO = normalizeCourses(item.country_iso || []);

      // Insert/update outgoing URLs
      if (item.outgoing_url && Array.isArray(item.outgoing_url) && item.outgoing_url.length > 0) {
        for (const outgoing of item.outgoing_url) {
          const redirectUrls = (outgoing.redirect_urls || [])
            .map(u => u.trim())
            .join('||');

          const outgoingData = {
            quora_ad_id: item.ad_id,
            source_url: outgoing.start_url || null,
            redirect_url: redirectUrls || null,
            final_url: outgoing.destination_url || null,
            country_code: countryISO,
            proxy_lander_status: item.status
          };

          const existing = await repo.getAdOutgoingDetails( {
            quora_ad_id: item.ad_id,
            source_url: outgoing.start_url,
            redirect_url: redirectUrls,
            final_url: outgoing.destination_url
          });

          if (existing.length === 0) {
            await repo.insertAdOutgoing( outgoingData);
          } else {
            const mergedCountry = mergeCountries(existing[0].country_code, countryISO);
            await repo.updateAdOutgoing( existing[0].id, mergedCountry);
          }
        }
      }

      // Insert/update redirect URLs
      if (item.redirects && Array.isArray(item.redirects) && item.redirects[0] !== 'NA') {
        for (const redirectUrl of item.redirects) {
          const existing = await repo.getAdUrlDestination( item.ad_id, redirectUrl, item.status);

          if (existing.length === 0) {
            await repo.insertAdUrl( {
              quora_ad_id: item.ad_id,
              url_type: 'R',
              country_code: countryISO,
              type: 0,
              url: redirectUrl,
              proxy_lander_status: item.status
            });
          }
        }
      }

      // Insert/update destination URL
      const existingDest = await repo.getAdUrlDestination(
        item.ad_id,
        item.destinations,
        item.status
      );

      if (existingDest.length === 0) {
        await repo.insertAdUrl( {
          quora_ad_id: item.ad_id,
          url_type: 'D',
          country_code: countryISO,
          type: 1,
          url: item.destinations,
          proxy_lander_status: item.status
        });
      } else {
        await repo.updateAdUrl( item.ad_id, {
          country_code: countryISO
        });
      }

      // Get existing meta data
      const metaData = await repo.getAdMetaData(item.ad_id);

      // Build HTML and screenshot arrays
      const updateMeta = {};
      const htmlContent = {};

      // Whitehat (status 2)
      if (item.status === 2) {
        // Parse existing JSON arrays
        let screenshots = [];
        let zips = [];

        if (metaData?.white_ad_screenshot) {
          try {
            const trimmed = metaData.white_ad_screenshot.trim().slice(1, -1); // remove [ ]
            const cleaned = trimmed.replace(/"/g, ''); // remove quotes
            screenshots = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
          } catch (e) {
            // If parse fails, start fresh
            screenshots = [];
          }
        }

        if (metaData?.white_ad_lander) {
          try {
            const trimmed = metaData.white_ad_lander.trim().slice(1, -1);
            const cleaned = trimmed.replace(/"/g, '');
            zips = cleaned ? cleaned.split(',').map(z => z.trim()).filter(Boolean) : [];
          } catch (e) {
            zips = [];
          }
        }

        screenshots.push(item.screen_shot);
        // html_path optional — only append the zip path when provided.
        if (item.html_path) zips.push(item.html_path);

        // Remove duplicates and store as JSON
        updateMeta.white_ad_screenshot = JSON.stringify([...new Set(screenshots)]);
        updateMeta.white_ad_lander = JSON.stringify([...new Set(zips)]);
        updateMeta.white_lander_date = new Date().toISOString().split('T')[0];
        updateMeta.white_ad_status = item.domain_age === 1 ? 2 : item.status;
        htmlContent.html_dc_blackhat_lander_text = item.html_content;
      }

      // Blackhat (status 1)
      else if (item.status === 1) {
        // Parse existing JSON arrays
        let screenshots = [];
        let zips = [];

        if (metaData?.png_file) {
          try {
            const trimmed = metaData.png_file.trim().slice(1, -1);
            const cleaned = trimmed.replace(/"/g, '');
            screenshots = cleaned ? cleaned.split(',').map(s => s.trim()).filter(Boolean) : [];
          } catch (e) {
            screenshots = [];
          }
        }

        if (metaData?.blackhat_path) {
          try {
            const trimmed = metaData.blackhat_path.trim().slice(1, -1);
            const cleaned = trimmed.replace(/"/g, '');
            zips = cleaned ? cleaned.split(',').map(z => z.trim()).filter(Boolean) : [];
          } catch (e) {
            zips = [];
          }
        }

        screenshots.push(item.screen_shot);
        // html_path optional — only append the zip path when provided.
        if (item.html_path) zips.push(item.html_path);

        // Remove duplicates and store as JSON
        updateMeta.png_file = JSON.stringify([...new Set(screenshots)]);
        updateMeta.blackhat_path = JSON.stringify([...new Set(zips)]);
        updateMeta.blackhat_status = 1;
        updateMeta.blackhat_date = new Date().toISOString().split('T')[0];
        htmlContent.html_res_blackhat_lander_text = item.html_content;
      }

      // Set redirect status based on crawler
      updateMeta.redirect_status = item.crawled_by === '.net' ? 1 : 4;

      // Update meta data
      await repo.updateAdMetaData( item.ad_id, updateMeta);

      // Insert/update HTML lander
      const htmlLander = await repo.getHtmlLander( item.ad_id);
      if (htmlLander) {
        await repo.updateHtmlLander( item.ad_id, htmlContent);
      } else {
        await repo.insertHtmlLander({
          quora_ad_id: item.ad_id,
          ...htmlContent
        });
      }

      // Update Elasticsearch
      const countryCodeList = await repo.getCountryCodeList( item.ad_id);
      const countryNames = await repo.getCountryNames(
        countryCodeList.map(c => c.country_code)
      );

      const esUpdate = {};

      if (item.status === 1) {
        esUpdate['quora_ad_html_lander_content.html_res_blackhat_lander_text'] = item.html_content;
      } else if (item.status === 2) {
        esUpdate['quora_ad_html_lander_content.html_dc_blackhat_lander_text'] = item.html_content;
      }

      if (domainRegisteredDate) {
        esUpdate['quora_ad_domain.domain_registered_date'] = domainRegisteredDate;
      }

      if (countryNames.length > 0) {
        esUpdate['quora_ad_url.country_code'] = countryNames.map(c => c.nicename);
      }

      // Update Elasticsearch if there are fields to update
      if (Object.keys(esUpdate).length > 0) {
        await db.elastic.update({
          index: 'quora_search_mix',
          type: 'doc',
          id: String(item.ad_id),
          body: { doc: esUpdate }
        }).catch(err => {
          log?.error(`ES update failed for ad ${item.ad_id}: ${err.message}`);
        });
      }

      lastResponse = {
        code: 200,
        message: 'Redirects and Destination Added Successfully',
        exe_time: (Date.now() - startTime) / 1000
      };
    }

    return lastResponse;
  } catch (error) {
    log?.error(`Error in insertHtmlRedirectCountry: ${error.message}`);
    return {
      code: 400,
      message: 'Some Error Occurred',
      error: error.message,
      exe_time: (Date.now() - startTime) / 1000
    };
  }
}

module.exports = {
  insertHtmlRedirectCountry
};
