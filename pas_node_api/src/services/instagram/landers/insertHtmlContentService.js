const InstagramRepository = require('./repository');

async function executeQuery(sql, params = []) {
  const databaseManager = require('../../../database/DatabaseManager');
  const pool = databaseManager.getSQL('instagram');
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Instagram Insert Error:', error.message, 'SQL:', sql);
    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdDocument(adId, data, esWrapper) {
  // if (!esWrapper) {
  //   console.log('ES not available, skipping update');
  //   return;
  // }

  try {
    await esWrapper.update({
      index: 'instagram_search_mix',
      type: 'doc',
      id: String(adId),
      body: {
        doc: {
          'instagram_ad_html_lander_content.html_whitehat_lander_text':
            data.htmlContent?.html_whitehat_lander_text || null,
          'instagram_ad_html_lander_content.html_dc_blackhat_lander_text':
            data.htmlContent?.html_dc_blackhat_lander_text || null,
          'instagram_ad_html_lander_content.html_res_blackhat_lander_text':
            data.htmlContent?.html_res_blackhat_lander_text || null,
        },
      },
    });
  
  } catch (error) {
    console.error('ES update error:', error.message);
  }
}

class InsertHtmlContentService {
  static async insertHtmlContent(requestArray, db) {
    const { sql, elastic } = db;
    const repository = InstagramRepository;
    const esWrapper = elastic;

    const results = [];

    for (const data of requestArray) {
      try {
    

        const existsInEs = await repository.checkAdInEs(data.ad_id, esWrapper);


        if (!existsInEs) {
          throw new Error(
            `Ad "${data.ad_id}" was not found in the search index (instagram_search_mix). `
              + 'The ad must be indexed before its destination lander can be stored.'
          );
        }

        const domain = data.domain_name ? data.domain_name.split('/')[0] : null;
        let domainId = null;

        if (domain) {
          domainId = await repository.getOrCreateDomain(
            domain,
            data.domain_registered_date
          );
          if (!domainId) {
            throw new Error(
              `Insert failed: could not add domain "${domain}" to instagram_ad_domain (no row id returned).`
            );
          }
        }

        if (data.outgoing_url && Array.isArray(data.outgoing_url)) {
       
          await repository.insertOutgoingLinks(
            data.ad_id,
            data.outgoing_url,
            data.country_iso
          );
        }

        if (data.outgoing_url && Array.isArray(data.outgoing_url)) {
          for (const outgoing of data.outgoing_url) {
            if (outgoing.redirect_urls) {
              await repository.insertUrls(
                data.ad_id,
                outgoing.redirect_urls,
                outgoing.destination_url,
                data.country_iso
              );
            }
          }
        }

      
        await repository.insertHtmlContent(
          data.ad_id,
          data.html || data.html_content,
          data.status
        );
        const redirectStatus =
          data.status === 1 || data.status === 2
            ? data.crawled_by === '.net'
              ? 1
              : 4
            : data.crawled_by === '.net'
              ? 3
              : 6;

        // Fetch existing metadata to build screenshot arrays
        const metaRows = await executeQuery(
          'SELECT white_ad_screenshot, png_file, white_ad_lander, blackhat_path FROM instagram_ad_meta_data WHERE instagram_ad_id = ? LIMIT 1',
          [data.ad_id]
        );
        const existingMeta = metaRows && metaRows.length > 0 ? metaRows[0] : null;

        let whitehat_screenshot = [];
        let blackhat_screenshot = [];
        let whitehat_zip = [];
        let blackhat_zip = [];

        // Parse existing arrays from DB
        if (existingMeta) {
          if (existingMeta.white_ad_screenshot) {
            try {
              const parsed = JSON.parse(existingMeta.white_ad_screenshot);
              whitehat_screenshot = Array.isArray(parsed) ? parsed : [];
            } catch {
              whitehat_screenshot = [];
            }
          }
          if (existingMeta.png_file) {
            try {
              const parsed = JSON.parse(existingMeta.png_file);
              blackhat_screenshot = Array.isArray(parsed) ? parsed : [];
            } catch {
              blackhat_screenshot = [];
            }
          }
          if (existingMeta.white_ad_lander) {
            try {
              const parsed = JSON.parse(existingMeta.white_ad_lander);
              whitehat_zip = Array.isArray(parsed) ? parsed : [];
            } catch {
              whitehat_zip = [];
            }
          }
          if (existingMeta.blackhat_path) {
            try {
              const parsed = JSON.parse(existingMeta.blackhat_path);
              blackhat_zip = Array.isArray(parsed) ? parsed : [];
            } catch {
              blackhat_zip = [];
            }
          }
        }

        const metadataUpdate = {
          redirect_status: redirectStatus,
          outgoing_status: 1,
        };

        // Build screenshot arrays (deduped)
        if (data.status === 2) {
          whitehat_screenshot.push(data.screen_shot);
          whitehat_screenshot = [...new Set(whitehat_screenshot)];
          // html_path optional — only append the zip path when provided.
          if (data.html_path) whitehat_zip.push(data.html_path);
          whitehat_zip = [...new Set(whitehat_zip)];

          if (whitehat_screenshot.length > 0) {
            metadataUpdate.white_ad_screenshot = JSON.stringify(whitehat_screenshot);
            metadataUpdate.screenshot_url = data.screen_shot;
          }
          if (whitehat_zip.length > 0) {
            metadataUpdate.white_ad_lander = JSON.stringify(whitehat_zip);
          }
          metadataUpdate.white_lander_date = new Date().toISOString().split('T')[0];
          metadataUpdate.white_ad_status = 2;
        } else if (data.status === 1) {
          blackhat_screenshot.push(data.screen_shot);
          blackhat_screenshot = [...new Set(blackhat_screenshot)];
          // html_path optional — only append the zip path when provided.
          if (data.html_path) blackhat_zip.push(data.html_path);
          blackhat_zip = [...new Set(blackhat_zip)];

          if (blackhat_screenshot.length > 0) {
            metadataUpdate.png_file = JSON.stringify(blackhat_screenshot);
            metadataUpdate.screenshot_url = data.screen_shot;
          }
          if (blackhat_zip.length > 0) {
            metadataUpdate.blackhat_path = JSON.stringify(blackhat_zip);
          }
          metadataUpdate.blackhat_date = new Date().toISOString().split('T')[0];
          metadataUpdate.blackhat_status = 1;
        }

        const metaUpdated = await repository.updateMetadata(data.ad_id, metadataUpdate);
        if (!metaUpdated) {
          results.push({
            ad_id: data.ad_id,
            code: 400,
            message:
              `Update failed: the instagram_ad_meta_data update for ad "${data.ad_id}" affected 0 rows. `
              + 'Either no meta record exists for this ad or the submitted values were already current — '
              + 'nothing was changed, and the search index was not updated.',
          });
          continue;
        }

        if (domainId) {
          const updateAdSql = `UPDATE instagram_ad SET domain_id = ? WHERE id = ?`;
         
          await executeQuery(updateAdSql, [domainId, data.ad_id]);
          
        }

        const htmlContent = data.html || data.html_content;
        await updateAdDocument(data.ad_id, {
          htmlContent: {
            html_whitehat_lander_text:
              data.status === 2 ? htmlContent : null,
            html_dc_blackhat_lander_text:
              data.status === 1 ? htmlContent : null,
            html_res_blackhat_lander_text:
              data.status === 1 ? htmlContent : null,
          },
        }, esWrapper);

        results.push({
          ad_id: data.ad_id,
          code: 200,
          message: 'HTML content inserted successfully',
        });
      } catch (error) {
        console.error(`Error processing ad ${data.ad_id}:`, error);
        results.push({
          ad_id: data.ad_id,
          code: 400,
          message: `Failed to store the destination lander for ad "${data.ad_id}": ${error.message}`,
        });
      }
    }

    return {
      code: 200,
      message: 'Processing complete',
      data: results,
    };
  }

  /**
   * Validate one lander (insertData) object. Same field contract as the Facebook
   * landers validator. Returns { isValid, errors } where `errors` holds
   * professional, specific messages that name exactly which field is missing /
   * of the wrong type / carrying an invalid value.
   *
   *   ad_id                  => required
   *   status                 => required|in:1,2
   *   crawled_by             => required|in:.net,python
   *   country_iso            => present|string|nullable
   *   destinations           => present|string|nullable
   *   html_path              => present|string|nullable
   *   screen_shot            => present|string|nullable
   *   html_content           => present|string|nullable
   *   domain_registered_date => present|nullable
   */
  static validateRequest(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return {
        isValid: false,
        errors: ['The "insertData" object is missing or malformed. Expected a JSON object containing the lander details.'],
      };
    }

    const errors = [];

    // required: key present AND value not null/undefined/empty-string.
    const REQUIRED_VALUE_KEYS = ['ad_id', 'status', 'crawled_by'];
    // present|string|nullable: key must exist; if the value is not null, it must be a string.
    const PRESENT_STRING_NULLABLE_KEYS = [
      'country_iso', 'destinations', 'html_path', 'screen_shot', 'html_content',
    ];
    // present|nullable: key must exist; value may be anything (incl. null).
    const PRESENT_NULLABLE_KEYS = ['domain_registered_date'];

    // 1. required — must be present and non-empty.
    const missingRequired = REQUIRED_VALUE_KEYS.filter(
      (k) => data[k] === undefined || data[k] === null || data[k] === ''
    );
    // 2. present — key must exist in the payload (value may be null).
    const missingPresent = [...PRESENT_STRING_NULLABLE_KEYS, ...PRESENT_NULLABLE_KEYS].filter(
      (k) => !(k in data)
    );
    const missing = [...missingRequired, ...missingPresent];
    if (missing.length === 1) {
      errors.push(`The "insertData.${missing[0]}" field is missing from the payload and is required.`);
    } else if (missing.length > 1) {
      errors.push(
        `The following required fields are missing from insertData: ${missing.map((k) => `"${k}"`).join(', ')}.`
      );
    }

    // 3. string|nullable — when present and not null, the value must be a string.
    for (const k of PRESENT_STRING_NULLABLE_KEYS) {
      if (data[k] !== null && data[k] !== undefined && typeof data[k] !== 'string') {
        errors.push(`The "insertData.${k}" field must be a string or null (received ${typeof data[k]}).`);
      }
    }

    // 4. status => in:1,2
    if (
      data.status !== undefined && data.status !== null && data.status !== '' &&
      ![1, 2].includes(parseInt(data.status, 10))
    ) {
      errors.push(
        `The "insertData.status" field is invalid (received ${JSON.stringify(data.status)}). `
          + 'It must be 1 (blackhat) or 2 (whitehat).'
      );
    }

    // 5. crawled_by => in:.net,python
    if (
      data.crawled_by !== undefined && data.crawled_by !== null && data.crawled_by !== '' &&
      data.crawled_by !== '.net' && data.crawled_by !== 'python'
    ) {
      errors.push(
        `The "insertData.crawled_by" field is invalid (received ${JSON.stringify(data.crawled_by)}). `
          + 'It must be exactly ".net" or "python".'
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Normalise the incoming request body into an array of flat lander objects.
   * Accepts every shape the scrapers send:
   *   - { ad_id, insertData: { ... } }
   *   - { ad_id, insertData: [ { ... } ] }
   *   - [ { ad_id, insertData: { ... } }, ... ]
   *   - { ad_id, country_iso, ... }            (flat body — fields at the top level)
   *   - [ { ... }, ... ]                        (top-level array of flat objects)
   * An element that carries no usable object becomes `null` so the caller can
   * report exactly which payload item is malformed.
   */
  static normalizeLanderItems(rawBody) {
    if (rawBody === undefined || rawBody === null) return [];
    const rawArray = Array.isArray(rawBody) ? rawBody : [rawBody];
    return rawArray.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      let lander = 'insertData' in item ? item.insertData : item;
      if (Array.isArray(lander)) lander = lander[0];
      if (!lander || typeof lander !== 'object' || Array.isArray(lander)) return null;
      // ad_id may sit on the wrapper rather than on the lander object.
      const hasAdId = lander.ad_id !== undefined && lander.ad_id !== null && lander.ad_id !== '';
      const wrapperAdId = item.ad_id;
      if (!hasAdId && wrapperAdId !== undefined && wrapperAdId !== null && wrapperAdId !== '') {
        lander = { ...lander, ad_id: wrapperAdId };
      }
      return lander;
    });
  }
}

module.exports = InsertHtmlContentService;
