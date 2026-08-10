'use strict';

/**
 * PUT /api/v1/common/insert-update-domain-date
 *
 * Node port of the PHP SupportScrapper@putDomainDate, generalised to update a
 * domain's WHOIS registration date across ALL networks' domains tables and bump
 * `updated_date`. Update-only: rows are never inserted.
 *
 * Body: { domain_name: string, domain_date: 'YYYY-MM-DD' }
 */

const logger = require('../../../logger');
const { updateDomainDate } = require('../services/updateDomainDateService');

const log = logger.createChild('update-domain-date');

async function putDomainDate(req, res) {
  const startedAt = Date.now();
  const body = req.body || {};
  const context = {
    request_id: req.requestId,
    domain: body.domain_name != null ? String(body.domain_name).trim() : '',
    has_domain_date: body.domain_date != null && String(body.domain_date).trim() !== '',
    requested_status: body.status,
  };

  log.info('insert-update-domain-date request received', context);
  try {
    const result = await updateDomainDate(body, log);
    const completion = {
      ...context,
      status_code: result.code,
      duration_ms: Date.now() - startedAt,
      summary: result.data?.summary,
      error_type: result.error?.type,
      error_stage: result.error?.stage,
    };
    if (result.code >= 500) log.error('insert-update-domain-date request failed', completion);
    else if (result.code >= 400) log.warn('insert-update-domain-date request rejected', completion);
    else log.info('insert-update-domain-date request completed', completion);
    return res.status(result.code).json(result);
  } catch (error) {
    log.error('insert-update-domain-date request crashed', {
      ...context,
      duration_ms: Date.now() - startedAt,
      error: error.message,
      error_code: error.code,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = { putDomainDate };
