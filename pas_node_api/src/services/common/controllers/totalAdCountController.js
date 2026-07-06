'use strict';

/**
 * Total Ad Count controller — shared by the admin-panel dashboard header
 * and the DS team's daily reports.
 *
 * Why ES, not MySQL:
 *   `SELECT COUNT(id) FROM <net>_ad` on a multi-million-row InnoDB table is
 *   too slow to put on a header that loads every tab click. ES handles
 *   `count` in milliseconds at any scale. Both consumers using THIS endpoint
 *   means the dashboard number and the DS report number are guaranteed
 *   identical.
 *
 * Usage:
 *   POST /api/v1/common/total-ad-count
 *   GET  /api/v1/common/total-ad-count?network=linkedin
 *
 *   Body / query:
 *     network          required — one of: facebook, instagram, google, gdn,
 *                                 native, pinterest, quora, reddit, youtube,
 *                                 linkedin, tiktok
 *     range            optional — { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *                                 Counts ads whose last_seen falls in this range.
 *                                 Omit for lifetime total (DS team's typical use).
 *
 *   Response:
 *     {
 *       code: 200,
 *       data: {
 *         network, totalAds, index,
 *         rangeApplied:       <bool>,  // true if range filter was applied
 *         mediaFilterApplied: <bool>,  // true if the per-network displayable-
 *                                      // media filter was applied (always true
 *                                      // except for google / bing / tiktok)
 *       }
 *     }
 *
 * Filtering behaviour:
 *   The new-ui-react frontend always applies a per-network "displayable media"
 *   filter (IMAGE ads must have a NAS image URL, VIDEO ads must have a thumbnail,
 *   etc.) so the user-visible "Total Ads" count is the filtered count, not
 *   the raw index size. This endpoint mirrors that filter so both the admin
 *   panel header AND the DS report match what the user sees. See
 *   common/helpers/displayableMediaFilters.js for the per-network clauses.
 */

const databaseManager = require('../../../database/DatabaseManager');
const ResponseFormatter = require('../../../utils/responseFormatter');
const logger = require('../../../logger');
const { getDisplayableMediaFilter, YOUTUBE_DISPLAY_UNDER_GDN } = require('../helpers/displayableMediaFilters');

const log = logger.createChild('total-ad-count');

// Per-network ES last_seen field + the input format we send in range queries.
// `inputFormat` is NOT the ES field type (every date column in ES is type `date`);
// it's the format we pass in the `format` parameter so ES knows how to parse the
// gte/lte values we hand it. LinkedIn/YouTube indices accept epoch_second; the
// rest accept "yyyy-MM-dd HH:mm:ss" datetime strings.
const FIELDS = {
  facebook:  { lastSeen: 'facebook_ad.last_seen',    inputFormat: 'datetime' },
  instagram: { lastSeen: 'instagram_ad.last_seen',   inputFormat: 'datetime' },
  google:    { lastSeen: 'google_text_ad.last_seen', inputFormat: 'datetime' },
  quora:     { lastSeen: 'quora_ad.last_seen',       inputFormat: 'datetime' },
  native:    { lastSeen: 'native_ad.last_seen',      inputFormat: 'datetime' },
  gdn:       { lastSeen: 'gdn_ad.last_seen',         inputFormat: 'datetime' },
  pinterest: { lastSeen: 'pinterest_ad.last_seen',   inputFormat: 'datetime' },
  reddit:    { lastSeen: 'reddit_ad.last_seen',      inputFormat: 'datetime' },
  linkedin:  { lastSeen: 'last_seen',                inputFormat: 'epoch_second' },
  youtube:   { lastSeen: 'last_seen',                inputFormat: 'epoch_second' },
  tiktok:    { lastSeen: 'last_seen',                inputFormat: 'datetime' },
};

const SUPPORTED_NETWORKS = Object.keys(FIELDS);

function dateToEpoch(dateString, edge) {
  const d = new Date(dateString);
  if (edge === 'start') d.setHours(0, 0, 0, 0);
  else d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

function buildRangeClause(network, range) {
  if (!range || !range.from || !range.to) return null;
  const f = FIELDS[network];

  if (f.inputFormat === 'epoch_second') {
    return {
      range: {
        [f.lastSeen]: {
          gte: dateToEpoch(range.from, 'start'),
          lte: dateToEpoch(range.to, 'end'),
          format: 'epoch_second',
        },
      },
    };
  }

  return {
    range: {
      [f.lastSeen]: {
        gte: `${range.from} 00:00:00`,
        lte: `${range.to} 23:59:59`,
        format: 'yyyy-MM-dd HH:mm:ss',
      },
    },
  };
}

async function getTotalAdCount(req, res) {
  const raw = { ...req.query, ...req.body };
  const network = String(raw.network || '').toLowerCase().trim();

  if (!network) {
    return ResponseFormatter.error(
      res,
      `Missing required parameter: network. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      400
    );
  }
  if (!FIELDS[network]) {
    return ResponseFormatter.error(
      res,
      `Unsupported network "${network}". Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      400
    );
  }

  const esConn = databaseManager.getElastic(network);
  if (!esConn || !esConn.client) {
    return ResponseFormatter.error(
      res,
      `Elasticsearch is not configured for network "${network}"`,
      503
    );
  }

  const rangeClause = buildRangeClause(network, raw.range);
  const mediaFilters = getDisplayableMediaFilter(network); // array | null

  const filterClauses = [];
  if (rangeClause)  filterClauses.push(rangeClause);
  if (mediaFilters) filterClauses.push(...mediaFilters);

  const body = filterClauses.length
    ? { query: { bool: { filter: filterClauses } } }
    : { query: { match_all: {} } };

  try {
    const result = await esConn.client.count({
      index: esConn.indexName,
      body,
    });

    // ES client v8 returns { count } directly; v7 wraps it as { body: { count } }.
    let totalAds = result?.count ?? result?.body?.count ?? 0;

    // GDN surfaces YouTube DISPLAY/IMAGE ads under its listing via the read-path
    // merge (gdn/helpers/youtubeDisplayMerge.js) — the website's GDN total is
    // `gdn count + youtube-DISPLAY count`. Those ads live in the youtube index,
    // not gdn, so add that count here to match the website's GDN "Total Ads".
    // The date range (if any) is applied to the youtube last_seen the same way
    // the merge bounds its youtube sub-query.
    let mergedYoutubeDisplay = false;
    if (network === 'gdn') {
      const ytConn = databaseManager.getElastic('youtube');
      if (ytConn && ytConn.client) {
        const ytRange = buildRangeClause('youtube', raw.range);
        const ytFilter = [...YOUTUBE_DISPLAY_UNDER_GDN];
        if (ytRange) ytFilter.push(ytRange);
        try {
          const ytResult = await ytConn.client.count({
            index: ytConn.indexName,
            body: { query: { bool: { filter: ytFilter } } },
          });
          totalAds += ytResult?.count ?? ytResult?.body?.count ?? 0;
          mergedYoutubeDisplay = true;
        } catch (ytErr) {
          log.warn('GDN total: YouTube DISPLAY merge count failed; returning gdn-only', {
            error: ytErr.message,
          });
        }
      }
    }

    return ResponseFormatter.success(res, {
      network,
      totalAds,
      index: esConn.indexName,
      rangeApplied: Boolean(rangeClause),
      mediaFilterApplied: Boolean(mediaFilters),
      ...(network === 'gdn' && { mergedYoutubeDisplay }),
    });
  } catch (err) {
    log.error('Total ad count query failed', {
      network,
      index: esConn.indexName,
      error: err.message,
    });
    return ResponseFormatter.error(res, 'Failed to fetch total ad count', 500, err.message);
  }
}

module.exports = { getTotalAdCount, SUPPORTED_NETWORKS };
