'use strict';

const repo = require('./repository');

const FETCH_STATUS = Object.freeze({
  NEVER_PROCESSED: 0,
  PREVIOUSLY_PROCESSED: 2,
});

function esHits(result) {
  return result?.body?.hits?.hits || result?.hits?.hits || [];
}

function normalizeAdId(value) {
  return String(value || '').trim().toLowerCase();
}

function parseStatusInput(req) {
  const raw = req?.query?.status ?? req?.body?.status;
  const parsed = raw === undefined || raw === null || raw === '' ? FETCH_STATUS.NEVER_PROCESSED : Number(raw);
  return [FETCH_STATUS.NEVER_PROCESSED, FETCH_STATUS.PREVIOUSLY_PROCESSED].includes(parsed) ? parsed : null;
}

function parseScraperName(req) {
  const raw = req?.headers?.['x-scraper-name'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

function parseLimit(req) {
  return repo.clampLimit(req?.query?.limit ?? req?.body?.limit, 50, 50);
}

async function searchAds(elastic, adIds, log) {
  if (!elastic) return new Set();

  const ids = [...new Set(adIds.map(normalizeAdId).filter(Boolean))];
  if (!ids.length) return new Set();

  try {
    const response = await elastic.search({
      index: elastic.indexName || 'mob_search_mix',
      body: {
        size: ids.length,
        track_total_hits: false,
        _source: ['ad_id'],
        query: {
          terms: {
            ad_id: ids,
          },
        },
      },
    });

    const found = new Set();
    for (const hit of esHits(response)) {
      const adId = normalizeAdId(hit?._source?.ad_id ?? hit?.fields?.ad_id?.[0] ?? '');
      if (adId) found.add(adId);
    }
    return found;
  } catch (error) {
    log?.error?.('admob.landers.searchAds failed', { ad_ids: ids, error: error.message });
    return new Set();
  }
}

async function claimCandidate(sql, row, scraperName, requestedStatus) {
  return repo.withTransaction(sql, async (tx) => {
    const claimed = await repo.claimAdForToday(tx, row.id, scraperName, requestedStatus);
    if (!claimed) return false;

    await repo.updateRedirectStatus(tx, row.id, FETCH_STATUS.PREVIOUSLY_PROCESSED);
    return true;
  });
}

async function markEsMiss(sql, row, scraperName, requestedStatus) {
  return repo.withTransaction(sql, async (tx) => {
    const claimed = await repo.claimAdForToday(tx, row.id, scraperName, requestedStatus);
    if (!claimed) return false;

    // Suppress same-day hot looping on ads whose ES doc is still missing.
    // They can naturally re-enter the queue on a later day after ES catches up.
    await repo.updateRedirectStatus(tx, row.id, 5);
    return true;
  });
}

async function fetchCandidates(sql, requestedStatus, limit) {
  return requestedStatus === FETCH_STATUS.PREVIOUSLY_PROCESSED
    ? repo.getPreviouslyProcessedAds(sql, limit)
    : repo.getNeverProcessedAds(sql, limit);
}

async function getAdmobAdsWithCountry(req, db = {}, log) {
  const started = Date.now();
  const sql = db?.sql;
  const elastic = db?.elastic;

  if (!sql) {
    return {
      code: 503,
      message: 'The AdMob MySQL connection is unavailable.',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }

  if (!elastic) {
    return {
      code: 503,
      message: 'The AdMob Elasticsearch connection is unavailable.',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }

  const scraperName = parseScraperName(req);
  if (!scraperName) {
    return {
      code: 422,
      message: 'The x-scraper-name header is required.',
      data: [],
      details: {
        hint: 'Send the crawler/device identity in the x-scraper-name header so PAS can prevent same-day duplicate pickup.',
      },
      exe_time: (Date.now() - started) / 1000,
    };
  }

  const requestedStatus = parseStatusInput(req);
  if (requestedStatus === null) {
    return {
      code: 422,
      message: 'The status filter is invalid.',
      data: [],
      details: {
        hint: 'Use status=0 for never-processed ads or status=2 for previously processed ads.',
      },
      exe_time: (Date.now() - started) / 1000,
    };
  }

  const limit = parseLimit(req);

  try {
    const rows = await fetchCandidates(sql, requestedStatus, limit);
    if (!rows.length) {
      return {
        code: 200,
        message: 'No Ads found',
        data: [],
        exe_time: (Date.now() - started) / 1000,
      };
    }

    const foundAdIds = await searchAds(elastic, rows.map((row) => row.ad_id), log);
    const result = [];
    let esMisses = 0;

    for (const row of rows) {
      const normalizedAdId = normalizeAdId(row.ad_id);
      if (!foundAdIds.has(normalizedAdId)) {
        esMisses += 1;
        await markEsMiss(sql, row, scraperName, requestedStatus);
        continue;
      }

      const claimed = await claimCandidate(sql, row, scraperName, requestedStatus);
      if (!claimed) continue;

      result.push({
        id: row.id,
        ad_id: row.ad_id,
        destination_url: row.destination_url,
        country: String(row.country || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });

      if (result.length >= limit) break;
    }

    const message = result.length
      ? 'Ads fetched successfully'
      : esMisses === rows.length
        ? 'Ads not found in Elasticsearch'
        : 'No Ads found';

    return {
      code: 200,
      message,
      data: result,
      exe_time: (Date.now() - started) / 1000,
    };
  } catch (error) {
    log?.error?.('admob.landers.getAds failed', { error: error.message });
    return {
      code: 500,
      message: 'No Ads found',
      data: [],
      exe_time: (Date.now() - started) / 1000,
    };
  }
}

module.exports = {
  FETCH_STATUS,
  esHits,
  getAdmobAdsWithCountry,
  normalizeAdId,
  parseLimit,
  parseScraperName,
  parseStatusInput,
  markEsMiss,
  searchAds,
};
