'use strict';

/**
 * searchAuditController — google_audit_keywords (MongoDB).
 *   GET  get-search-audit-keywords    → crawler pull        (getSearchAuditKeywords)
 *   POST insert-search-audit-keywords → CSV/JSON bulk insert (insertSearchAuditKeywords)
 * Thin wrappers over the services.
 */

const { getSearchAuditKeywords } = require('../searchAudit/service');
const { insertKeywords } = require('../searchAudit/insertService');

async function searchAuditKeywords(req, db, logger) {
  return getSearchAuditKeywords(req, db, logger);
}

async function insertSearchAuditKeywords(req, db, logger) {
  return insertKeywords(req, db, logger);
}

module.exports = { searchAuditKeywords, insertSearchAuditKeywords };
