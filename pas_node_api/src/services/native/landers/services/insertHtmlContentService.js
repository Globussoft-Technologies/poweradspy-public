const NativeAdMetaData = require('../models/NativeAdMetaData');
const NativeAdDomains = require('../models/NativeAdDomains');
const NativeAdUrl = require('../models/NativeAdUrl');
const NativeAdOutgoing = require('../models/NativeAdOutgoing');
const NativeAdHtmlLander = require('../models/NativeAdHtmlLander');
const databaseManager = require('../../../../database/DatabaseManager');

// Helper to execute queries
async function executeQuery(sql, params = []) {
  const pool = databaseManager.getSQL('native');
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    connection.release();
  }
}

// Helper to search ad in Elasticsearch
async function searchAd(adId, esWrapper) {
  try {
    if (!esWrapper) {
      return true;
    }


    const result = await esWrapper.search({
      index: esWrapper.indexName || 'native_search_mix_v2',
      body: {
        query: {
          match: {
            'native_ad.id': adId,
          },
        },
      },
    });

    const hitCount = result?.hits?.hits?.length || 0;
    return hitCount > 0;
  } catch (error) {
    return false;
  }
}

// Helper to update ad document in Elasticsearch
async function updateAdDocument(adId, data, esWrapper) {
  try {
    if (!esWrapper || !esWrapper.client) {
      return;
    }

    // Use client.updateByQuery directly
    await esWrapper.client.updateByQuery({
      index: esWrapper.indexName || 'native_search_mix_v2',
      body: {
        query: {
          match: {
            'native_ad.id': adId,
          },
        },
        script: {
          source: `
            if (params.html_whitehat != null) {
              ctx._source['native_ad_html_lander_content']['html_whitehat_lander_text'] = params.html_whitehat;
            }
            if (params.html_blackhat != null) {
              ctx._source['native_ad_html_lander_content']['html_dc_blackhat_lander_text'] = params.html_blackhat;
            }
            if (params.domain_date != null) {
              ctx._source['native_ad_domains']['domain_registered_date'] = params.domain_date;
            }
          `,
          params: {
            html_whitehat: data.htmlContent?.html_whitehat_lander_text,
            html_blackhat: data.htmlContent?.html_dc_blackhat_lander_text,
            domain_date: data.domainData?.domain_registered_date,
          },
        },
      },
    });
  } catch (error) {
    // Don't throw - ES updates are non-blocking
  }
}

class InsertHtmlContentService {
  /**
   * Insert HTML content and metadata
   */
  static async insertHtmlContent(requestArray, db = {}) {
    try {
      const results = [];

      for (const item of requestArray) {
        try {
          const result = await this.processItem(item, db);
          results.push(result);
        } catch (error) {
          console.error(`Error processing item:`, error);
          results.push({
            success: false,
            adId: item.ad_id,
            error: error.message,
          });
        }
      }

      return {
        code: 200,
        message: 'Destination Lander updated successfully',
        exe_time: 0,
      };
    } catch (error) {
      console.error('Error in insertHtmlContent:', error);
      throw error;
    }
  }

  /**
   * Process single item
   */
  static async processItem(data, db = {}) {
    // Step 1: Check ad exists in Elasticsearch (non-blocking - ES might not be synced yet)
    const adExists = await searchAd(data.ad_id, db.elastic);
    if (!adExists) {
    }

    // Step 2: Handle no response case (status = 3)
    if (data.status === 3) {
      const redirectStatus = data.crawled_by === '.net' ? 3 : 6;
      await NativeAdMetaData.updateRedirectStatus(data.ad_id, redirectStatus);
      return {
        success: true,
        adId: data.ad_id,
        status: 'no_response',
      };
    }

    // Step 3: Process domain
    const domain = this.extractDomain(data.destinations);
    const domainId = await NativeAdDomains.getOrCreate(
      domain,
      data.domain_registered_date
    );

    // Step 4: Process outgoing URLs
    if (data.outgoing_url && Array.isArray(data.outgoing_url)) {
      await NativeAdOutgoing.processOutgoingUrls(
        data.ad_id,
        data.outgoing_url,
        data.country_iso
      );
    }

    // Step 5: Process individual URLs
    if (data.outgoing_url && Array.isArray(data.outgoing_url)) {
      for (const outgoing of data.outgoing_url) {
        if (outgoing.redirect_urls) {
          await NativeAdUrl.insertMultipleUrls(
            data.ad_id,
            outgoing.redirect_urls,
            outgoing.destination_url,
            data.country_iso
          );
        }
      }
    }

    // Step 6: Store HTML content
    await NativeAdHtmlLander.insertHtmlContent(
      data.ad_id,
      data.html || data.html_content,
      data.status
    );

    // Step 7: Update metadata
    const redirectStatus =
      data.status === 1 || data.status === 2
        ? data.crawled_by === '.net'
          ? 1
          : 4
        : data.crawled_by === '.net'
          ? 3
          : 6;

    const metadataUpdate = {
      redirect_status: redirectStatus,
      outgoing_status: 1,
      domain_id: domainId,
    };

    // Handle screenshot and HTML paths
    if (data.status === 2) {
      // Whitehat
      metadataUpdate.white_ad_screenshot = [data.screen_shot];
      // html_path optional — only store the zip path when provided.
      if (data.html_path) metadataUpdate.white_ad_lander = [data.html_path];
      metadataUpdate.white_lander_date = new Date().toISOString().split('T')[0];
      metadataUpdate.white_ad_status = data.domain_age === 1 ? 2 : 2;
    } else if (data.status === 1) {
      // Blackhat
      metadataUpdate.png_file = [data.screen_shot];
      // html_path optional — only store the zip path when provided.
      if (data.html_path) metadataUpdate.blackhat_path = [data.html_path];
      metadataUpdate.blackhat_date = new Date().toISOString().split('T')[0];
      metadataUpdate.blackhat_status = 1;
    }

    await NativeAdMetaData.updateData(data.ad_id, metadataUpdate);

    // Step 8: Update main ad table
    await this.updateMainAd(data.ad_id, domainId);

    // Step 9: Update Elasticsearch
    const htmlContent = data.html || data.html_content;
    await updateAdDocument(data.ad_id, {
      htmlContent: {
        html_whitehat_lander_text:
          data.status === 2 ? htmlContent : null,
        html_dc_blackhat_lander_text:
          data.status === 1 ? htmlContent : null,
      },
      domainData: {
        domain_registered_date: data.domain_registered_date,
      },
      outgoingData: data.outgoing_url,
      urlData: {
        url_redirects: data.outgoing_url
          ? data.outgoing_url.flatMap((o) => o.redirect_urls || [])
          : [],
        url_destination: data.destinations,
        country_code: data.country_iso,
      },
    }, db.elastic);

    return {
      success: true,
      adId: data.ad_id,
      status: 'updated',
    };
  }

  /**
   * Extract domain from URL
   */
  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;

      // Remove www. if present
      if (domain.startsWith('www.')) {
        domain = domain.slice(4);
      }

      // Extract main domain (last two parts)
      const parts = domain.split('.');
      if (parts.length >= 2) {
        domain = parts.slice(-2).join('.');
      }

      return domain;
    } catch (error) {
      console.error('Error extracting domain:', error);
      return url;
    }
  }

  /**
   * Update main ad table with domain_id
   */
  static async updateMainAd(adId, domainId) {
    const sql = `
      UPDATE native_ad
      SET domain_id = ?
      WHERE id = ?
    `;
    await executeQuery(sql, [domainId, adId]);
  }

  /**
   * Validate request
   */
  static validateRequest(item) {
    const errors = [];
    // html_path is OPTIONAL (may be omitted) — mirrors gdn/google/youtube/linkedin.
    const requiredFields = [
      'ad_id',
      'country_iso',
      'destinations',
      'screen_shot',
      'html_content',
      'status',
      'crawled_by',
    ];

    for (const field of requiredFields) {
      // Presence check (matches quora/reddit) so legitimately-empty
      // values like html_path: "" are accepted.
      if (!(field in item)) {
        errors.push(`${field} is required`);
      }
    }

    // Validate crawled_by
    if (item.crawled_by && !['.net', 'python'].includes(item.crawled_by)) {
      errors.push('crawled_by must be ".net" or "python"');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

module.exports = InsertHtmlContentService;
