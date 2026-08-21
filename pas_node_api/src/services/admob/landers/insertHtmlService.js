'use strict';

const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');
const { buildAdmobDocument } = require('../insertion/esDocBuilder');
const repo = require('./repository');
const { normalizeLanderPayload } = require('./normalize');

const PYTHON_CRAWLER_PLATFORM = 12;

function unwrapItem(item) {
  if (!item || typeof item !== 'object') return item;
  return item.insertData && typeof item.insertData === 'object' ? item.insertData : item;
}

function payloadItems(body) {
  if (Array.isArray(body)) return body.map(unwrapItem).filter(Boolean);
  if (Array.isArray(body?.ads)) return body.ads.map(unwrapItem).filter(Boolean);
  return [unwrapItem(body)];
}

function validateLanderPayload(payload) {
  const errors = [];
  const status = Number(payload?.status ?? payload?.lander_status);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push({ field: '$', reason: 'INVALID_PAYLOAD', message: 'Each AdMob lander payload must be a JSON object.' });
    return errors;
  }

  if (payload.ad_id === undefined || payload.ad_id === null || String(payload.ad_id).trim() === '') {
    errors.push({ field: 'ad_id', reason: 'MISSING_REQUIRED_FIELD', message: 'ad_id is required and cannot be empty.' });
  }

  if (payload.platform === undefined || payload.platform === null || String(payload.platform).trim() === '') {
    errors.push({ field: 'platform', reason: 'MISSING_REQUIRED_FIELD', message: 'platform is required and cannot be empty.' });
  } else if (!Number.isFinite(Number(payload.platform))) {
    errors.push({ field: 'platform', reason: 'INVALID_VALUE', message: 'platform must be a numeric crawler identifier.' });
  }

  if (payload.source_app === undefined || payload.source_app === null || String(payload.source_app).trim() === '') {
    errors.push({ field: 'source_app', reason: 'MISSING_REQUIRED_FIELD', message: 'source_app is required and cannot be empty.' });
  }

  if ((payload.status !== undefined || payload.lander_status !== undefined) && ![1, 2, 3].includes(status)) {
    errors.push({ field: 'status', reason: 'INVALID_VALUE', message: 'status must be one of: 1, 2, 3.' });
  }

  if (payload.destinations === undefined || payload.destinations === null || String(payload.destinations).trim() === '') {
    errors.push({ field: 'destinations', reason: 'MISSING_REQUIRED_FIELD', message: 'destinations is required and cannot be empty.' });
  }

  if (status !== 3) {
    if (payload.html_path === undefined || payload.html_path === null || String(payload.html_path).trim() === '') {
      errors.push({ field: 'html_path', reason: 'MISSING_REQUIRED_FIELD', message: 'html_path is required and cannot be empty.' });
    }
    if (payload.screen_shot === undefined || payload.screen_shot === null || String(payload.screen_shot).trim() === '') {
      errors.push({ field: 'screen_shot', reason: 'MISSING_REQUIRED_FIELD', message: 'screen_shot is required and cannot be empty.' });
    }
    if (payload.html_content === undefined || payload.html_content === null || String(payload.html_content).trim() === '') {
      errors.push({ field: 'html_content', reason: 'MISSING_REQUIRED_FIELD', message: 'html_content is required and cannot be empty.' });
    }
  }

  return errors;
}

async function updateElasticDoc(db, adId) {
  const elastic = db?.elastic;
  if (!elastic) {
    return { indexed: false };
  }

  const complete = await repo.getCompleteAd(db.sql, adId);
  if (!complete) {
    throw new Error('ad not found');
  }

  const document = buildAdmobDocument(complete);
  const params = {
    index: elastic.indexName || 'mob_search_mix',
    id: String(complete.id),
    body: document,
    refresh: false,
  };

  if (Number(elastic.esMajor) <= 6) {
    params.type = 'doc';
  }

  await elastic.index(params);
  return { indexed: true };
}

function parseScraperName(req) {
  const raw = req?.headers?.['x-scraper-name'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

async function processItem(rawItem, db, log, scraperName = '') {
  const payload = unwrapItem(rawItem);
  const validationErrors = validateLanderPayload(payload);
  if (validationErrors.length) {
    return rejected(422, 'The AdMob lander payload validation failed.', {
      errors: validationErrors,
      hint: 'Fix the listed fields and resend the same ad_id payload. No database write was attempted.',
    });
  }

  const normalized = normalizeLanderPayload(payload);

  try {
    const outcome = await repo.withTransaction(db.sql, async (tx) => {
      const existing = await repo.getAdForUpdate(tx, normalized.ad_id);
      if (!existing) {
        throw new Error('ad not found');
      }

      const isPythonCrawler = Number(normalized.platform) === PYTHON_CRAWLER_PLATFORM;
      const redirectStatus = normalized.lander_status === 3
        ? (isPythonCrawler ? 6 : 3)
        : (isPythonCrawler ? 4 : 1);

      await repo.updateRedirectStatus(tx, existing.id, redirectStatus);

      // Keep the lander row in sync for every analysis attempt, including
      // status=3 runs, so the created/updated contract remains meaningful.
      await repo.upsertLanderContent(tx, existing.id, normalized);

      // Mark the current-day claim complete when this insert belongs to a
      // scraper that picked the ad earlier, or create a same-day claim on the
      // fly when insert_html_content is called directly.
      await repo.completeLanderClaim(tx, existing.id, scraperName, normalized.lander_status);

      // Keep a retry record so the ES doc can be rebuilt even if the immediate
      // index call fails after the SQL transaction has already committed.
      await repo.queueEs(tx, existing.id);

      return { id: existing.id, redirectStatus, skippedContent: normalized.lander_status === 3 };
    });

    if (!db?.elastic) {
      return ok(outcome.id, 'Destination Lander updated successfully. Elasticsearch indexing is queued for retry.', {
        data: {
          id: outcome.id,
          mysql_saved: true,
          elastic_indexed: false,
          es_retry_queued: true,
          redirect_status: outcome.redirectStatus,
          skipped_content: outcome.skippedContent,
        },
        warning: 'Elasticsearch is unavailable right now; the lander data was saved in MySQL and queued for retry.',
      });
    }

    try {
      const esResult = await updateElasticDoc(db, normalized.ad_id);
      await repo.completeEs(db.sql, outcome.id);
      return ok(outcome.id, 'Destination Lander updated successfully.', {
        data: {
          id: outcome.id,
          mysql_saved: true,
          elastic_indexed: esResult.indexed,
          es_retry_queued: false,
          redirect_status: outcome.redirectStatus,
          skipped_content: outcome.skippedContent,
        },
      });
    } catch (error) {
      log?.error?.('admob.landers.insertHtml ES indexing failed', { ad_id: normalized.ad_id, error: error.message });
      return ok(outcome.id, 'Destination Lander updated successfully. Elasticsearch indexing is pending.', {
        data: {
          id: outcome.id,
          mysql_saved: true,
          elastic_indexed: false,
          es_retry_queued: true,
          redirect_status: outcome.redirectStatus,
          skipped_content: outcome.skippedContent,
        },
        warning: `Elasticsearch indexing is pending: ${error.message}`,
      });
    }
  } catch (error) {
    if (error.message === 'ad not found') {
      return rejected(400, 'ad not found', {
        hint: 'Use an AdMob ad_id that already exists in mob_ads / mob_search_mix.',
      });
    }
    log?.error?.('admob.landers.insertHtml failed', { ad_id: normalized.ad_id, error: error.message });
    return serverError(500, 'The AdMob lander could not be saved.', {
      hint: 'Check the input payload and database connection, then retry.',
      error: error.message,
    });
  }
}

async function insertHtmlContent(req, db, log) {
  const started = Date.now();
  const items = payloadItems(req.body).filter(Boolean);
  const scraperName = parseScraperName(req);

  if (!db?.sql) {
    return serverError(503, 'The AdMob MySQL connection is unavailable.', {
      hint: 'Check ADMOB_SQL_* configuration and pasdev_admob availability, then retry.',
    });
  }

  if (!items.length) {
    return rejected(422, 'The AdMob lander batch is empty.', {
      hint: 'Send one object or a non-empty ads array.',
    });
  }

  if (items.length === 1) {
    const result = await processItem(items[0], db, log, scraperName);
    result.exe_time = (Date.now() - started) / 1000;
    return result;
  }

  const results = [];
  let okCount = 0;
  let failedCount = 0;

  for (const item of items) {
    const result = await processItem(item, db, log, scraperName);
    results.push(result);
    if (result.code >= 200 && result.code < 300) okCount += 1;
    else failedCount += 1;
  }

  return {
    code: failedCount === 0 ? 200 : 207,
    status: failedCount === 0 ? 'ok' : 'partial',
    message: `Processed ${items.length} AdMob lander(s): ${okCount} succeeded and ${failedCount} failed.`,
    data: results,
    exe_time: (Date.now() - started) / 1000,
  };
}

module.exports = { insertHtmlContent, processItem, validateLanderPayload, payloadItems };
