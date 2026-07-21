'use strict';

/**
 * GET get-search-audit-keywords — crawler pull from the google_audit_keywords Mongo
 * collection. Hands out the next batch of crawlable keywords (status in crawlStatuses),
 * advancing a persistent cursor and looping back to the start when exhausted.
 *
 * Response shape kept compatible with the original SQL endpoint: each row exposes
 * id/keyword/status/country/user_id/process_date/hit_count.
 */

const repo = require('./repository');
const config = require('../../../config');

// Map a Mongo doc to the legacy row shape the crawler expects.
function toRow(doc) {
  return {
    id: String(doc._id),
    keyword: doc.keyword,
    status: doc.status,
    country: doc.country ?? null,
    user_id: doc.user_id ?? null,
    process_date: doc.process_date ?? null,
    hit_count: doc.hit_count ?? 0,
  };
}

async function getSearchAuditKeywords(req, db, log) {
  const cfg = config.googleKeywordAudit;
  if (!cfg.enabled) return { code: 404, message: 'No Keywords Found' };
  if (!repo.getCollection()) {
    return { code: 500, message: 'Database connection is not available.' };
  }

  try {
    const { data } = await repo.getCrawlBatch(cfg.crawlBatchSize, cfg.crawlStatuses);
    if (!data.length) return { code: 404, message: 'No Keywords Found' };
    return { code: 200, message: 'Keywords Fetched Successfully', data: data.map(toRow) };
  } catch (err) {
    log?.error?.('getSearchAuditKeywords error', { error: err.message });
    return { code: 500, message: err.message };
  }
}

module.exports = { getSearchAuditKeywords, toRow };
