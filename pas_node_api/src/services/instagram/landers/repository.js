const databaseManager = require('../../../database/DatabaseManager');

async function executeQuery(sql, params = []) {
  const pool = databaseManager.getSQL('instagram');
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Instagram Repository Error:', error.message, 'SQL:', sql);
    throw error;
  } finally {
    connection.release();
  }
}

class InstagramRepository {
  // GET endpoint: fetch ads with redirect_status=0
  static async getDataForLander(status) {
    const sql = `
      SELECT
        instagram_ad_meta_data.instagram_ad_id as id,
        instagram_ad_meta_data.ad_url,
        instagram_ad_meta_data.destination_url,
        instagram_country_only.country as iso
      FROM instagram_ad_meta_data
      LEFT JOIN instagram_ad_countries_only ON instagram_ad_countries_only.instagram_ad_id = instagram_ad_meta_data.instagram_ad_id
      LEFT JOIN instagram_country_only ON instagram_country_only.id = instagram_ad_countries_only.country_only_id
      WHERE instagram_ad_meta_data.redirect_status = ?
      ORDER BY instagram_ad_meta_data.instagram_ad_id DESC
      LIMIT 100
    `;
    return await executeQuery(sql, [status]);
  }

  // Update redirect_status
  static async updateRedirectStatus(adId, status) {
    const sql = `
      UPDATE instagram_ad_meta_data
      SET redirect_status = ?
      WHERE instagram_ad_id = ?
    `;
    const result = await executeQuery(sql, [status, adId]);
    return result.affectedRows > 0;
  }

  // Domain: check if exists
  static async getDomain(domain) {
    const sql = `SELECT id FROM instagram_ad_domain WHERE domain = ?`;
    const result = await executeQuery(sql, [domain]);
    return result.length > 0 ? result[0].id : null;
  }

  // Domain: insert or get
  static async getOrCreateDomain(domain, registeredDate) {
    const existing = await this.getDomain(domain);
    if (existing) return existing;

    const sql = `INSERT INTO instagram_ad_domain (domain, domain_registered_date) VALUES (?, ?)`;
    const result = await executeQuery(sql, [
      domain,
      registeredDate || new Date().toISOString().split('T')[0],
    ]);
    return result.insertId;
  }

  // URL: insert redirect (R) + destination (D)
  static async insertUrls(adId, redirectUrls, destinationUrl, countryIso) {
    const iso = countryIso
      ? Array.isArray(countryIso)
        ? countryIso[0]
        : countryIso.toString().split(',')[0]
      : null;

    for (const redirectUrl of redirectUrls) {
      const sql = `
        INSERT INTO instagram_ad_url (instagram_ad_id, url_type, url, type, country_code, proxy_lander_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE url = VALUES(url)
      `;
      await executeQuery(sql, [adId, 'R', redirectUrl || null, 0, iso, 0]);
    }

    if (destinationUrl) {
      const destSql = `
        INSERT INTO instagram_ad_url (instagram_ad_id, url_type, url, type, country_code, proxy_lander_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE url = VALUES(url)
      `;
      await executeQuery(destSql, [adId, 'D', destinationUrl || null, 0, iso, 0]);
    }
  }

  // Outgoing: insert outgoing links
  static async insertOutgoingLinks(adId, outgoingUrls, countryIso) {
    if (!outgoingUrls || outgoingUrls.length === 0) return;

    const country = countryIso
      ? Array.isArray(countryIso)
        ? countryIso.join('|')
        : countryIso
      : null;

    for (const urlObj of outgoingUrls) {
      const redirectUrls = urlObj.redirect_urls || urlObj.redirectUrls || [];
      const destinationUrl = urlObj.destination_url || urlObj.destinationUrl || null;

      for (const redirectUrl of redirectUrls) {
        const sql = `
          INSERT INTO instagram_ad_outgoing_links (instagram_ad_id, source_url, redirect_url, final_url, country_code, proxy_lander_status)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE redirect_url = VALUES(redirect_url)
        `;
        await executeQuery(sql, [
          adId,
          destinationUrl || null,
          redirectUrl || null,
          destinationUrl || null,
          country,
          0,
        ]);
      }
    }
  }

  // HTML Lander: insert HTML content
  static async insertHtmlContent(adId, htmlContent, status) {
    const column = status === 2 ? 'html_whitehat_lander_text' : 'html_res_blackhat_lander_text';

    const sql = `
      INSERT INTO instagram_ad_html_lander_content (instagram_ad_id, ${column})
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE ${column} = VALUES(${column})
    `;

    return await executeQuery(sql, [adId, htmlContent]);
  }

  // Meta: update metadata
  static async updateMetadata(adId, data) {
    const fields = [];
    const values = [];

    if (data.redirect_status !== undefined) {
      fields.push('redirect_status = ?');
      values.push(data.redirect_status);
    }
    if (data.outgoing_status !== undefined) {
      fields.push('outgoing_status = ?');
      values.push(data.outgoing_status);
    }
    if (data.white_ad_screenshot !== undefined) {
      fields.push('white_ad_screenshot = ?');
      values.push(JSON.stringify(data.white_ad_screenshot));
    }
    if (data.white_ad_lander !== undefined) {
      fields.push('white_ad_lander = ?');
      values.push(JSON.stringify(data.white_ad_lander));
    }
    if (data.white_lander_date !== undefined) {
      fields.push('white_lander_date = ?');
      values.push(data.white_lander_date);
    }
    if (data.png_file !== undefined) {
      fields.push('png_file = ?');
      values.push(JSON.stringify(data.png_file));
    }
    if (data.blackhat_path !== undefined) {
      fields.push('blackhat_path = ?');
      values.push(JSON.stringify(data.blackhat_path));
    }
    if (data.blackhat_date !== undefined) {
      fields.push('blackhat_date = ?');
      values.push(data.blackhat_date);
    }
    if (data.white_ad_status !== undefined) {
      fields.push('white_ad_status = ?');
      values.push(data.white_ad_status);
    }
    if (data.blackhat_status !== undefined) {
      fields.push('blackhat_status = ?');
      values.push(data.blackhat_status);
    }
    if (data.screenshot_url !== undefined) {
      fields.push('screenshot_url = ?');
      values.push(data.screenshot_url);
    }

    if (fields.length === 0) return false;

    values.push(adId);
    const sql = `UPDATE instagram_ad_meta_data SET ${fields.join(', ')} WHERE instagram_ad_id = ?`;

    const result = await executeQuery(sql, values);
    return result.affectedRows > 0;
  }

  // Update instagram_ad.domain_id
  static async updateAdDomainId(adId, domainId) {
    const sql = `UPDATE instagram_ad SET domain_id = ? WHERE id = ?`;
    return await executeQuery(sql, [domainId, adId]);
  }

  // Get country ISO by name (case-insensitive)
  static async getCountryIso(countryName) {
    const sql = `SELECT instagram_country_iso FROM country_data WHERE LOWER(nicename) = LOWER(?)`;
    const result = await executeQuery(sql, [countryName]);
    return result.length > 0 ? result[0].instagram_country_iso : null;
  }

  // Batch get country ISO codes
  static async batchGetCountryIso(countryNames) {
    if (!countryNames || countryNames.length === 0) return new Map();

    const placeholders = countryNames.map(() => '?').join(',');
    const sql = `SELECT nicename, instagram_country_iso FROM country_data WHERE nicename IN (${placeholders})`;
    const results = await executeQuery(sql, countryNames);

    const map = new Map();
    results.forEach(row => {
      map.set(row.nicename, row.instagram_country_iso);
    });
    return map;
  }

  // Check if ad exists in ES
  static async checkAdInEs(adId, esWrapper) {
    if (!esWrapper) return true;

    try {
      const result = await esWrapper.search({
        index: 'instagram_search_mix',
        body: {
          query: {
            term: {
              'instagram_ad.id': adId,
            },
          },
        },
      });

      const hits = result?.body?.hits?.hits || result?.hits?.hits || [];
      return hits.length > 0;
    } catch (error) {
      return false;
    }
  }
}

module.exports = InstagramRepository;
