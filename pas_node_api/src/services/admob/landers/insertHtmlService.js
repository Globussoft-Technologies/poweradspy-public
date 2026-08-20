'use strict';

const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');
const { buildAdmobDocument } = require('../insertion/esDocBuilder');
const repo = require('./repository');
const { normalizeLanderPayload } = require('./normalize');

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
  const status = Number(payload?.status);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push({ field: '$', reason: 'INVALID_PAYLOAD', message: 'Each AdMob lander payload must be a JSON object.' });
    return errors;
  }

  if (payload.ad_id === undefined || payload.ad_id === null || String(payload.ad_id).trim() === '') {
    errors.push({ field: 'ad_id', reason: 'MISSING_REQUIRED_FIELD', message: 'ad_id is required and cannot be empty.' });
  }

  if (payload.status === undefined || payload.status === null || String(payload.status).trim() === '') {
    errors.push({ field: 'status', reason: 'MISSING_REQUIRED_FIELD', message: 'status is required and cannot be empty.' });
  } else if (![1, 2, 3].includes(status)) {
    errors.push({ field: 'status', reason: 'INVALID_VALUE', message: 'status must be one of: 1, 2, 3.' });
  }

  if (payload.crawled_by === undefined || payload.crawled_by === null || String(payload.crawled_by).trim() === '') {
    errors.push({ field: 'crawled_by', reason: 'MISSING_REQUIRED_FIELD', message: 'crawled_by is required and cannot be empty.' });
  } else if (!['.net', 'python'].includes(String(payload.crawled_by).trim())) {
    errors.push({ field: 'crawled_by', reason: 'INVALID_VALUE', message: 'crawled_by must be ".net" or "python".' });
  }

  if (status !== 3) {
    if (payload.destinations === undefined || payload.destinations === null || String(payload.destinations).trim() === '') {
      errors.push({ field: 'destinations', reason: 'MISSING_REQUIRED_FIELD', message: 'destinations is required when status is 1 or 2.' });
    }
    if (payload.screen_shot === undefined || payload.screen_shot === null || String(payload.screen_shot).trim() === '') {
      errors.push({ field: 'screen_shot', reason: 'MISSING_REQUIRED_FIELD', message: 'screen_shot is required when status is 1 or 2.' });
    }
    if (payload.html_content === undefined || payload.html_content === null || String(payload.html_content).trim() === '') {
      errors.push({ field: 'html_content', reason: 'MISSING_REQUIRED_FIELD', message: 'html_content is required when status is 1 or 2.' });
    }
  }

  return errors;
}

async function isAdIndexed(elastic, adId) {
  if (!elastic) return true;

  const response = await elastic.search({
    index: elastic.indexName || 'mob_search_mix',
    body: {
      size: 1,
      track_total_hits: false,
      query: {
        term: {
          ad_id: String(adId).trim().toLowerCase(),
        },
      },
    },
  });

  const hits = response?.body?.hits?.hits || response?.hits?.hits || [];
  return hits.length > 0;
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

async function processItem(rawItem, db, log) {
  const payload = unwrapItem(rawItem);
  const validationErrors = validateLanderPayload(payload);
  if (validationErrors.length) {
    return rejected(422, 'The AdMob lander payload validation failed.', {
      errors: validationErrors,
      hint: 'Fix the listed fields and resend the same ad_id payload. No database write was attempted.',
    });
  }

  const normalized = normalizeLanderPayload(payload);
  const elastic = db?.elastic;
  if (elastic) {
    try {
      const indexed = await isAdIndexed(elastic, normalized.ad_id);
      if (!indexed) {
        return rejected(400, 'ad not found', {
          hint: 'Make sure the AdMob ad exists in mob_search_mix before sending lander data.',
        });
      }
    } catch (error) {
      log?.error?.('admob.landers.insertHtml ES lookup failed', { ad_id: normalized.ad_id, error: error.message });
      return serverError(503, 'The AdMob Elasticsearch lookup failed.', {
        hint: 'Check the mob_search_mix index and retry once Elasticsearch is healthy.',
        error: error.message,
      });
    }
  }

  try {
    const outcome = await repo.withTransaction(db.sql, async (tx) => {
      const existing = await repo.getAdForUpdate(tx, normalized.ad_id);
      if (!existing) {
        throw new Error('ad not found');
      }

      const redirectStatus = normalized.lander_status === 3
        ? (normalized.crawled_by === '.net' ? 3 : 6)
        : (normalized.crawled_by === '.net' ? 1 : 4);

      await repo.updateRedirectStatus(tx, existing.id, redirectStatus);

      if (normalized.lander_status !== 3) {
        await repo.upsertLanderContent(tx, existing.id, normalized);
      }

      return { id: existing.id, redirectStatus, skippedContent: normalized.lander_status === 3 };
    });

    if (!db?.elastic) {
      const response = ok(outcome.id, 'Destination Lander updated successfully.');
      response.data.elastic_indexed = false;
      response.data.mysql_saved = true;
      response.data.redirect_status = outcome.redirectStatus;
      response.data.skipped_content = outcome.skippedContent;
      return response;
    }

    try {
      const esResult = await updateElasticDoc(db, normalized.ad_id);
      const response = ok(outcome.id, 'Destination Lander updated successfully.');
      response.data.elastic_indexed = esResult.indexed;
      response.data.mysql_saved = true;
      response.data.redirect_status = outcome.redirectStatus;
      response.data.skipped_content = outcome.skippedContent;
      return response;
    } catch (error) {
      log?.error?.('admob.landers.insertHtml ES indexing failed', { ad_id: normalized.ad_id, error: error.message });
      const response = serverError(503, 'The AdMob lander was saved in pasdev_admob, but Elasticsearch indexing is pending.', {
        hint: 'Retry once Elasticsearch is healthy; the MySQL lander content is already stored.',
        error: error.message,
      });
      response.data = { id: outcome.id, mysql_saved: true, elastic_indexed: false, redirect_status: outcome.redirectStatus };
      return response;
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
    const result = await processItem(items[0], db, log);
    result.exe_time = (Date.now() - started) / 1000;
    return result;
  }

  const results = [];
  let okCount = 0;
  let failedCount = 0;

  for (const item of items) {
    const result = await processItem(item, db, log);
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
