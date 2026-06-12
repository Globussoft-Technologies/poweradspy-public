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
          throw new Error('ad not found');
        }

        const domain = data.domain_name ? data.domain_name.split('/')[0] : null;
        let domainId = null;

        if (domain) {
          domainId = await repository.getOrCreateDomain(
            domain,
            data.domain_registered_date
          );
        
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
          whitehat_zip.push(data.html_path);
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
          blackhat_zip.push(data.html_path);
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

       
        await repository.updateMetadata(data.ad_id, metadataUpdate);
       

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
          code: 500,
          message: error.message,
        });
      }
    }

    return {
      code: 200,
      message: 'Processing complete',
      data: results,
    };
  }

  static validateRequest(data) {
    const errors = [];

    if (!data.ad_id) errors.push('ad_id is required');
    if (!data.status) errors.push('status is required');
    if (!data.crawled_by) errors.push('crawled_by is required');

    if (data.status && ![1, 2].includes(parseInt(data.status))) {
      errors.push('status must be 1 (blackhat) or 2 (whitehat)');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

module.exports = InsertHtmlContentService;
