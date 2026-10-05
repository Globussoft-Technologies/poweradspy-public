'use strict';

/**
 * ChatGPT Ads — shared helpers for the analytics (ad insights) endpoints in
 * controllers/adInsightsController.js.
 */

const networks = require('../../../config/networks');

// Index name comes from config.json (networks.chatgptads.elastic.index), overridable with the
// CGA_ELASTIC_INDEX env var — never hardcoded. The SQL/ES connections themselves (`db.sql` /
// `db.elastic`) are injected by ServiceRegistry from the same networks.chatgptads config.
const ES_INDEX = networks.chatgptads.database.elastic.index;

// Advertiser-level queries fetch at most this many ads per advertiser (same cap as the other
// networks' advertiser insights).
const MAX_ADVERTISER_ADS = 10000;

// The frontend sends the INTERNAL numeric id (chatgptads_ad.id = ES field `id`), not the
// extension's 12-digit `ad_id` string.
function readAdId(req) {
  const raw = { ...req.body, ...req.query };
  const id = parseInt(raw.chatgptads_ad_id ?? raw.ad_id ?? raw.id, 10);
  return Number.isFinite(id) ? id : null;
}

/** Hits array from an ES search response — tolerates both the 6.x and 7.x client shapes. */
function readHits(esResult) {
  return (esResult?.hits || esResult?.body?.hits)?.hits || [];
}

/** One ad's ES document (`_source`) by internal id, limited to `fields`. null when not found. */
async function fetchAdSource(elastic, adId, fields) {
  const esResult = await elastic.search({
    index: ES_INDEX,
    body: {
      size: 1,
      _source: fields,
      query: { bool: { filter: { term: { id: adId } } } },
    },
  });
  const hits = readHits(esResult);
  return hits.length ? (hits[0]._source || {}) : null;
}

function getYearRange(year) {
  return {
    gte: `${year}-01-01 00:00:00`,
    lte: `${year}-12-31 23:59:59`,
    format: 'yyyy-MM-dd HH:mm:ss',
  };
}

function getCustomDateRange(from, to) {
  return {
    gte: `${from} 00:00:00`,
    lte: `${to} 23:59:59`,
    format: 'yyyy-MM-dd HH:mm:ss',
  };
}

// Exact keyword match (term) on post_owner_lower — the same dedup key the insertion
// pipeline groups an advertiser's ads by.
function advertiserFilter(postOwnerLower) {
  return { term: { post_owner_lower: postOwnerLower } };
}

/** Every year the advertiser has ads in (by last_seen), newest first. [] on any failure. */
async function fetchAvailableYears(elastic, filter) {
  // `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility —
  // `calendar_interval` was only introduced in ES 7.2.
  try {
    const esResult = await elastic.search({
      index: ES_INDEX,
      body: {
        size: 0,
        query: { bool: { filter: [filter] } },
        aggs: {
          years: {
            date_histogram: {
              field: 'last_seen',
              interval: 'year',
              format: 'yyyy',
              min_doc_count: 1,
            },
          },
        },
      },
    });

    const buckets =
      (esResult.aggregations || esResult.body?.aggregations)?.years?.buckets ||
      [];

    return buckets
      .map(b => parseInt(b.key_as_string, 10))
      .filter(y => Number.isFinite(y) && y > 1970)
      .sort((a, b) => b - a);
  } catch (err) {
    return [];
  }
}

/** The advertiser's ads (`id` + `country` only) whose last_seen falls in `dateRange`. */
async function fetchAdvertiserCountryHits(elastic, postOwnerLower, dateRange) {
  const esResult = await elastic.search({
    index: ES_INDEX,
    body: {
      size: MAX_ADVERTISER_ADS,
      _source: ['id', 'country'],
      query: {
        bool: {
          filter: [
            advertiserFilter(postOwnerLower),
            { range: { last_seen: dateRange } },
          ],
        },
      },
    },
  });
  return readHits(esResult);
}

/**
 * Ad-level country list → [{ country, iso: null }], trimmed, case-insensitively de-duplicated.
 * Accepts a single name or an array of names.
 */
function toAdCountryList(countries) {
  const list = Array.isArray(countries) ? countries : (countries ? [countries] : []);
  const seen = new Set();
  const data = [];
  for (const name of list) {
    const country = String(name || '').trim();
    if (!country || seen.has(country.toLowerCase())) continue;
    seen.add(country.toLowerCase());
    data.push({ country, iso: null });
  }
  return data;
}

// Only the full country NAME is stored for this network (no ISO, no country_data lookup).
// `iso` is returned as null — the frontend resolves it from the name, same as admob.
/** Advertiser hits → [{ country, iso: null, ad_ids, ad_count }], most ads first. null if none. */
function aggregateCountryData(hits) {
  if (!hits || hits.length === 0) return null;

  const countryMap = {};
  for (const hit of hits) {
    const src = hit._source || {};
    const adId = src.id;
    if (!adId) continue;

    let countries = src.country;
    if (!countries) continue;
    if (!Array.isArray(countries)) countries = [countries];

    for (const country of countries) {
      if (!country) continue;
      if (!countryMap[country]) countryMap[country] = new Set();
      countryMap[country].add(adId);
    }
  }

  if (Object.keys(countryMap).length === 0) return null;

  const result = [];
  const countryEntries = Object.entries(countryMap).sort((a, b) => b[1].size - a[1].size);

  for (const [country, idSet] of countryEntries) {
    const adIds = [...idSet];
    result.push({ country, iso: null, ad_ids: adIds, ad_count: adIds.length });
  }
  return result;
}

module.exports = {
  ES_INDEX,
  readAdId,
  readHits,
  fetchAdSource,
  getYearRange,
  getCustomDateRange,
  advertiserFilter,
  fetchAvailableYears,
  fetchAdvertiserCountryHits,
  toAdCountryList,
  aggregateCountryData,
};
