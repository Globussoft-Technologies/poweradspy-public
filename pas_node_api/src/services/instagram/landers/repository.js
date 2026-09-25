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
  // GET endpoint: fetch up to 100 ads at the given redirect_status
  // (called with PENDING=0 first, falling back to IN_PROCESSING=2 when PENDING is drained).
  //
  // Ads with an unusable destination_url are excluded here so they are never leased,
  // never flipped to IN_PROCESSING, and therefore never re-served on the drain fallback.
  // "Unusable" = SQL NULL, empty/whitespace, or the literal strings 'null'/'undefined'
  // (some upstream writes store the string, not a real NULL).
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
        AND instagram_ad_meta_data.destination_url IS NOT NULL
        AND TRIM(instagram_ad_meta_data.destination_url) <> ''
        AND LOWER(TRIM(instagram_ad_meta_data.destination_url)) NOT IN ('null', 'undefined')
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

  // Domain: insert or get (Facebook-style). A blank/zero registration date is stored as NULL,
  // and never overwrites an existing real date; a real date refreshes the existing row.
  static async getOrCreateDomain(domain, registeredDate) {
    const existing = await this.getDomain(domain);
    if (existing) {
      if (registeredDate) {
        await executeQuery(
          'UPDATE instagram_ad_domain SET domain_registered_date = ? WHERE id = ?',
          [registeredDate, existing]
        );
      }
      return existing;
    }

    const result = await executeQuery(
      'INSERT INTO instagram_ad_domain (domain, domain_registered_date) VALUES (?, ?)',
      [domain, registeredDate || null]
    );
    return result.insertId;
  }

  // Country list -> "IN||US" (uppercase, "||"-joined) — same normalisation as the Facebook lander.
  static normalizeCountry(countryIso) {
    if (countryIso === undefined || countryIso === null || countryIso === '') return '';
    const list = Array.isArray(countryIso) ? countryIso : String(countryIso).split(/[,|]+/);
    return list.map((c) => String(c).trim()).filter(Boolean).join('||').toUpperCase();
  }

  // ad_url rows (facebook-style): top-level redirects[] -> url_type 'R', destinations -> url_type 'D'.
  // Each row is inserted once per (ad, type, url, status); an existing D row just gets its country refreshed.
  static async upsertAdUrls(adId, redirects, destination, countryIso, status) {
    const country = this.normalizeCountry(countryIso);
    const proxyStatus = status ?? 0;
    const hasValue = (v) => typeof v === 'string' && v.trim() !== '' && v.trim().toUpperCase() !== 'NA';

    const rows = [];
    if (Array.isArray(redirects)) {
      for (const r of redirects) if (hasValue(r)) rows.push(['R', r, 0]);
    }
    if (hasValue(destination)) rows.push(['D', destination, 1]);

    for (const [urlType, url, type] of rows) {
      const existing = await executeQuery(
        `SELECT id FROM instagram_ad_url
          WHERE instagram_ad_id = ? AND url_type = ? AND url <=> ? AND proxy_lander_status <=> ? LIMIT 1`,
        [adId, urlType, url, proxyStatus]
      );
      if (existing.length > 0) {
        await executeQuery('UPDATE instagram_ad_url SET country_code = ? WHERE id = ?', [country, existing[0].id]);
        continue;
      }
      await executeQuery(
        `INSERT INTO instagram_ad_url (instagram_ad_id, url_type, url, type, country_code, proxy_lander_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [adId, urlType, url, type, country, proxyStatus]
      );
    }
  }

  // Outgoing links: ONE row per outgoing_url item (source_url = start_url, final_url = destination_url,
  // redirect_url = its redirect chain "||"-joined, '' when redirect_urls is [] — column is NOT NULL).
  // An identical existing row (same ad + source + final + status) only has its country list merged.
  static async insertOutgoingLinks(adId, outgoingUrls, countryIso, status) {
    if (!Array.isArray(outgoingUrls) || outgoingUrls.length === 0) return;

    const country = this.normalizeCountry(countryIso);
    const proxyStatus = status ?? 0;

    for (const o of outgoingUrls) {
      if (!o) continue;
      const start = o.start_url || o.startUrl || null;
      const dest = o.destination_url || o.destinationUrl || null;
      if (!start && !dest) continue;

      const reds = o.redirect_urls || o.redirectUrls;
      const redirectUrl = (Array.isArray(reds) ? reds : [reds]).filter(Boolean).join('||');
      const sourceUrl = start || dest;

      const existing = await executeQuery(
        `SELECT id, country_code FROM instagram_ad_outgoing_links
          WHERE instagram_ad_id = ? AND source_url <=> ? AND final_url <=> ?
            AND proxy_lander_status <=> ? LIMIT 1`,
        [adId, sourceUrl, dest, proxyStatus]
      );
      if (existing.length > 0) {
        const merged = [...new Set(
          [...String(existing[0].country_code || '').split('||'), ...country.split('||')].filter(Boolean)
        )].join('||');
        await executeQuery(
          'UPDATE instagram_ad_outgoing_links SET redirect_url = ?, country_code = ? WHERE id = ?',
          [redirectUrl, merged, existing[0].id]
        );
        continue;
      }
      await executeQuery(
        `INSERT INTO instagram_ad_outgoing_links (instagram_ad_id, source_url, redirect_url, final_url, country_code, proxy_lander_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [adId, sourceUrl, redirectUrl, dest, country, proxyStatus]
      );
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
      // Return the hit's real ES _id (truthy) so callers can update the right document;
      // false when the ad is absent from the index.
      return hits.length > 0 ? String(hits[0]._id) : false;
    } catch (error) {
      return false;
    }
  }
}

module.exports = InstagramRepository;
