import moment from "moment";
import config from "config";
import elasticsearch from "elasticsearch";
import { esClient, esServers } from "../../utils/Elasticsearch.js";
import logger from "../../resources/logs/logger.log.js";

/**
 * Data-report stats (NEW — independent of the competitor pulse flow).
 *
 * Counts per network, matching what the app UI shows:
 *   - total   : all-time ads that PASS the network's media gate (the same
 *               EXTRA_CONDITION each pas_node_api search builder applies). A
 *               raw match_all is wrong — it counts un-migrated / placeholder
 *               docs the UI hides (e.g. FB ~32M raw vs ~4.4M real).
 *   - last24h : same media gate + <dateField> in YESTERDAY 00:00 IST → now.
 *
 * MEDIA_FILTERS below mirror each builder's EXTRA_CONDITION / IMAGE_MUST_NOT
 * exactly (pas_node_api/src/services/<net>/builders). `filter` clauses go in
 * bool.filter, `mustNot` clauses in bool.must_not.
 */

const NETWORKS = [
  { key: "facebook",  label: "Facebook",  index: "search_mix",           dateField: "facebook_ad.last_seen"  },
  { key: "instagram", label: "Instagram", index: "instagram_search_mix", dateField: "instagram_ad.last_seen" },
  { key: "google",    label: "Google",    index: "google_ads_data",      dateField: "last_seen"              },
  { key: "youtube",   label: "YouTube",   index: "youtube_ads_data",     dateField: "last_seen"              },
  { key: "gdn",       label: "GDN",       index: "gdn_search_mix",       dateField: "gdn_ad.last_seen"       },
  { key: "native",    label: "Native",    index: "native_search_mix",    dateField: "native_ad.last_seen"    },
  { key: "linkedin",  label: "LinkedIn",  index: "linkedin_ads_data",    dateField: "last_seen"              },
  { key: "quora",     label: "Quora",     index: "quora_search_mix",     dateField: "quora_ad.last_seen"     },
  { key: "reddit",    label: "Reddit",    index: "reddit_search_mix",    dateField: "reddit_ad.last_seen"    },
  { key: "pinterest", label: "Pinterest", index: "pinterest_search_mix", dateField: "pinterest_ad.last_seen" },
  { key: "tiktok",    label: "TikTok",    index: "tiktok_ads",           dateField: "last_seen"              },
];

// Media gates — copied 1:1 from each network's search builder so the counts
// equal the search results the user sees.
const MEDIA_FILTERS = {
  facebook: { filter: [{ bool: { should: [
    { bool: { filter: [{ term: { "facebook_ad.type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: { filter: [{ term: { "facebook_ad.type.keyword": "VIDEO" } }, { exists: { field: "Thumbnail" } }] } },
    { bool: { must_not: [{ terms: { "facebook_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  instagram: { filter: [{ bool: { should: [
    { bool: { filter: [{ terms: { "instagram_ad.type.keyword": ["IMAGE", "STORIES"] } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: { filter: [{ term: { "instagram_ad.type.keyword": "VIDEO" } }, { exists: { field: "thumbnail" } }] } },
    { bool: { must_not: [{ terms: { "instagram_ad.type.keyword": ["IMAGE", "VIDEO", "STORIES"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  google: { filter: [], mustNot: [
    { bool: { filter: [
      { term: { type: "IMAGE" } },
      { bool: { should: [
        { bool: { must_not: [{ exists: { field: "new_nas_image_url" } }] } },
        { term: { "new_nas_image_url.keyword": "" } },
      ], minimum_should_match: 1 } },
    ] } },
    { match_phrase: { type: "ORGANIC SEARCH" } },
  ] },

  youtube: { filter: [{ bool: { should: [
    { bool: {
      filter: [{ terms: { "ad_type.keyword": ["VIDEO", "DISCOVERY"] } }, { exists: { field: "thumbnail_url" } }],
      must_not: [
        { wildcard: { thumbnail_url: { value: "*pasvideo*" } } },
        { wildcard: { thumbnail_url: { value: "*pasimage*" } } },
        { wildcard: { thumbnail_url: { value: "*bydefault*" } } },
      ],
    } },
    { bool: {
      filter: [{ exists: { field: "new_nas_image_url" } }],
      must_not: [
        { terms: { "ad_type.keyword": ["VIDEO", "DISCOVERY"] } },
        { wildcard: { new_nas_image_url: { value: "*pasvideo*" } } },
        { wildcard: { new_nas_image_url: { value: "*pasimage*" } } },
        { wildcard: { new_nas_image_url: { value: "*bydefault*" } } },
      ],
    } },
  ], minimum_should_match: 1 } }], mustNot: [{ term: { "ad_type.keyword": "" } }] },

  gdn: { filter: [{ bool: { should: [
    { bool: { filter: [
      { bool: { should: [{ term: { "gdn_ad.type.keyword": "IMAGE" } }, { term: { "gdn_ad.type.keyword": "" } }], minimum_should_match: 1 } },
      { exists: { field: "new_nas_image_url" } },
    ] } },
    { bool: { must_not: [
      { bool: { should: [{ term: { "gdn_ad.type.keyword": "IMAGE" } }, { term: { "gdn_ad.type.keyword": "" } }], minimum_should_match: 1 } },
    ] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  native: { filter: [{ bool: { should: [
    { bool: { filter: [{ terms: { "native_ad.type.keyword": ["IMAGE", "VIDEO"] } }, { exists: { field: "native_ad.nas_url" } }] } },
    { bool: { must_not: [{ terms: { "native_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  linkedin: { filter: [{ bool: { should: [
    { bool: { filter: [{ term: { "ad_type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: {
      filter: [{ term: { "ad_type.keyword": "VIDEO" } }, { exists: { field: "ad_video" } }],
      must_not: [
        { wildcard: { ad_video: { value: "*pasvideo*" } } },
        { wildcard: { ad_video: { value: "*pasimage*" } } },
        { wildcard: { ad_video: { value: "*bydefault*" } } },
      ],
    } },
    { bool: { must_not: [{ terms: { "ad_type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  quora: { filter: [{ bool: { should: [
    { bool: { filter: [{ term: { "quora_ad.type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: { filter: [{ term: { "quora_ad.type.keyword": "VIDEO" } }, { exists: { field: "new_nas_image_url" } }, { exists: { field: "thumbnail" } }] } },
    { bool: { must_not: [{ terms: { "quora_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  reddit: { filter: [{ bool: { should: [
    { bool: { filter: [{ term: { "reddit_ad.type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: {
      filter: [{ term: { "reddit_ad.type.keyword": "VIDEO" } }, { exists: { field: "Thumbnail" } }],
      must_not: [
        { wildcard: { Thumbnail: { value: "*pasvideo*" } } },
        { wildcard: { Thumbnail: { value: "*pasimage*" } } },
        { wildcard: { Thumbnail: { value: "*bydefault*" } } },
      ],
    } },
    { bool: { must_not: [{ terms: { "reddit_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  pinterest: { filter: [{ bool: { should: [
    { bool: { filter: [{ term: { "pinterest_ad.type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
    { bool: { filter: [{ term: { "pinterest_ad.type.keyword": "VIDEO" } }, { exists: { field: "thumbnail" } }] } },
    { bool: { must_not: [{ terms: { "pinterest_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
  ], minimum_should_match: 1 } }], mustNot: [] },

  tiktok: { filter: [{ bool: {
    filter: [{ exists: { field: "video_cover" } }],
    must_not: [
      { wildcard: { video_cover: { value: "*pasvideo*" } } },
      { wildcard: { video_cover: { value: "*pasimage*" } } },
      { wildcard: { video_cover: { value: "*bydefault*" } } },
      { wildcard: { video_url: { value: "*pasvideo*" } } },
      { wildcard: { video_url: { value: "*pasimage*" } } },
      { wildcard: { video_url: { value: "*bydefault*" } } },
    ],
  } }], mustNot: [] },
};

// ES parses the range BOUNDS we pass with this format (independent of how
// each field is stored), so the same "YYYY-MM-DD HH:mm:ss" window works
// across every network — including TikTok, whose last_seen is ISO-mapped.
const RANGE_FORMAT = "yyyy-MM-dd HH:mm:ss";

// Per-network dedicated ES connections from config (only the networks not
// already covered by the shared esServers). Read once, then cached.
let DR_ES = {};
try { DR_ES = config.get("data_report_es") || {}; } catch { DR_ES = {}; }

const dedicatedClients = {};
function dedicatedClient(conn) {
  const host = conn && conn.host;
  if (!host || !String(host).trim()) return null;
  const cacheKey = `${host}|${conn.username || ""}`;
  if (!dedicatedClients[cacheKey]) {
    dedicatedClients[cacheKey] = new elasticsearch.Client({
      host,
      httpAuth: conn.username ? `${conn.username}:${conn.password}` : undefined,
    });
  }
  return dedicatedClients[cacheKey];
}

// Uniform client resolution: a dedicated connection from config.data_report_es
// WINS (so any network — incl. facebook/instagram/google/youtube — can be
// pointed at the production ES the dashboard uses); otherwise fall back to the
// shared client that owns this index in utils/Elasticsearch.js.
function clientForNetwork(net) {
  const dedicated = dedicatedClient(DR_ES[net.key]);
  if (dedicated) return dedicated;
  const serverKey = Object.keys(esServers).find((k) => esServers[k].indexes.includes(net.index));
  return serverKey ? esClient[serverKey] : null;
}

async function esCount(client, index, body) {
  const res = await client.count({ index, body });
  return res?.count ?? res?.body?.count ?? 0;
}

/**
 * @returns {Promise<{window, platforms, grand}>}
 */
export async function getDataReportStats() {
  // "Last day" = YESTERDAY 00:00:00 IST → now. Computed in IST so the window
  // doesn't shift with the host timezone.
  const ist = moment.utc().utcOffset("+05:30");
  const until = ist.format("YYYY-MM-DD HH:mm:ss");
  const since = ist.clone().subtract(1, "day").startOf("day").format("YYYY-MM-DD HH:mm:ss");

  const platforms = await Promise.all(
    NETWORKS.map(async (net) => {
      const base = { key: net.key, label: net.label, index: net.index };
      const client = clientForNetwork(net);
      if (!client) {
        return { ...base, last24h: 0, total: 0, ok: false, configured: false };
      }

      // ─── MEDIA_FILTERS gates intentionally disabled ─────────────────────
      // Per the daily-report spec, we want the RAW network-wide all-time
      // total (matches a plain `GET <index>/_count`) and a date-bounded
      // last-24h count with NO media filter — so the numbers in the report
      // reflect "every doc in the index", not "every doc that survives the
      // search-result media gate". The MEDIA_FILTERS constant above is
      // intentionally left in the file: restore the two filtered bodies if
      // we ever want the gated count again.
      //
      // FILTERED versions (kept for easy restore):
      //   const mf = MEDIA_FILTERS[net.key] || { filter: [], mustNot: [] };
      //   const totalBody = { query: { bool: { filter: mf.filter, ...(mf.mustNot.length ? { must_not: mf.mustNot } : {}) } } };
      //   const last24Body = { query: { bool: { filter: [{ range: { [net.dateField]: { gte: since, lte: until, format: RANGE_FORMAT } } }, ...mf.filter], ...(mf.mustNot.length ? { must_not: mf.mustNot } : {}) } } };
      const totalBody = { query: { match_all: {} } };

      const last24Body = { query: { bool: {
        filter: [{ range: { [net.dateField]: { gte: since, lte: until, format: RANGE_FORMAT } } }],
      } } };

      try {
        const [total, last24h] = await Promise.all([
          esCount(client, net.index, totalBody),
          esCount(client, net.index, last24Body),
        ]);
        return { ...base, last24h, total, ok: true, configured: true };
      } catch (e) {
        logger.error(`getDataReportStats ${net.key} failed: ${e.message}`);
        return { ...base, last24h: 0, total: 0, ok: false, configured: true };
      }
    })
  );

  const grand = platforms.reduce(
    (a, p) => (p.ok ? { last24h: a.last24h + p.last24h, total: a.total + p.total } : a),
    { last24h: 0, total: 0 }
  );

  return { window: { since, until }, platforms, grand };
}
