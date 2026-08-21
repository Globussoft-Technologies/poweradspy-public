import logger from "../../resources/logs/logger.log.js";
import Response from "../../utils/response.js";
import Competitors from "../../models/competitors.js";
import { esClient, esServers, checkElasticsearchHealth } from "../../utils/Elasticsearch.js";
import axios from "axios";
import Competitors_request from "../../models/competitors_request.js";
import User_details from "../../models/user_details.js";
import BrandCcMember from "../../models/brandCcMember.js";
import Member from "../../models/member.js";
import CompetitorPipelineState from "../../models/competitorPipelineState.js";
import emailService from "../mailer/emailService.js"
import { newSendId, logSend } from "../mailer/emailAudit.js";
import { isBlacklisted, BLACKLISTED_SKIP_REASON } from "../mailer/bounceGuard.js";
import config from "config";
import elasticsearch from "elasticsearch";
import moment from "moment";
import pLimit from "p-limit";
import { NETWORK_INDEXES } from "../../utils/networkIndexes.js";
import { getDisplayableMediaFilter } from "../../utils/displayableMediaFilters.js";
import { isEsUnderStress, withLimit } from "../../utils/esLoadGuard.js";

// Confirmed 2026-08-17: 8 concurrent competitors x 9 ES calls each (see
// activeCompetitorContacts) could put up to 72 concurrent queries on a
// single-node cluster shared with pas_node_api. Tightened from 2 to 1 after
// still seeing 6+ simultaneous count queries in production with the cap at 2
// — this process's own cap can only bound ITS OWN concurrency, not the total
// across however many instances are actually running, so it's kept as tight
// as useful; isEsUnderStress() (reads the cluster's own live, shared state)
// is the backpressure signal that's correct regardless of process count.
const ES_MAX_CONCURRENT = 1;

// Ad-preview retry-for-image (2026-08-21): how many recent hits
// fetchTopAdPreview pulls per competitor/platform so it can fall through to
// the next-most-recent ad when the top one's image is empty/unresolvable
// (skipped pasimages/pasvideos path, or an otherwise-broken relative path).
// One extra ES round trip's worth of `size`, not `size` extra round trips —
// still a single query.
const AD_PREVIEW_CANDIDATE_SIZE = 5;

// Diagnostic logging gate — flip MAIL_DEBUG_LOG in config (e.g. true in
// localDev.json, false in default.json/production). When the flag is off
// dlog() still surfaces error-like lines (those containing "❌" or
// "FAILED") so production never goes silent on real failures — only the
// step-by-step traces get muted.
const MAIL_DEBUG_LOG = (() => {
  try { return !!config.get("MAIL_DEBUG_LOG"); } catch { return false; }
})();
function dlog(...args) {
  if (MAIL_DEBUG_LOG) { console.log(...args); return; }
  /* v8 ignore next -- dlog is always called with a non-empty template string, so `args[0] || ""` never falls back */
  const first = String(args[0] || "");
  if (first.includes("❌") || /\bFAILED\b/i.test(first)) console.log(...args);
}

// NOTE: ES on FB/IG indexes stores fields as flat keys with literal dots,
// e.g. obj["facebook_ad_variants.title"] — getByPath() handles both forms.
//
// For images we distinguish IMAGE vs VIDEO ad types:
//   - VIDEO → use thumbnail (image_url_original points to a .mp4 for videos)
//   - IMAGE → use image_url
//
// We search BOTH post_owner_name and post_owner_lower so single-token
// names like "forestessentials" still match brands stored as
// "Forest Essentials" in ES (the *_lower field is normalized to a single
// keyword form).
const AD_PREVIEW_FIELD_CANDIDATES = {
  facebook: {
    index: NETWORK_INDEXES.facebook,
    searchFields: [
      "facebook_ad_post_owners.post_owner_name",
      "facebook_ad_post_owners.post_owner_lower",
    ],
    sortField: "facebook_ad.last_seen",
    typeField: "facebook_ad.type",
    titlePaths: [
      "facebook_ad_variants.title",
      "facebook_ad_variants.title_exactly",
      "facebook_translation.ad_title",
      "facebook_ad_post_owners.post_owner_name",
    ],
    bodyPaths: [
      "facebook_ad_variants.text",
      "facebook_ad_variants.text_exactly",
      "facebook_ad_variants.newsfeed_description",
      "facebook_ad_variants.newsfeed_description_exactly",
      "facebook_translation.ad_text",
      "facebook_translation.news_feed_description",
    ],
    imagePaths: [
      "image_url",
      "new_nas_image_url",
    ],
    thumbnailPaths: [
      "Thumbnail",
      "thumbnail_url",
      "new_nas_image_url",
    ],
    ownerImagePaths: [],
    ctaPaths: [
      "facebook_call_to_actions.action",
      "facebook_ad.call_to_action",
      "call_to_action",
    ],
  },
  instagram: {
    index: NETWORK_INDEXES.instagram,
    searchFields: [
      "instagram_ad_post_owners.post_owner_name",
      "instagram_ad_post_owners.post_owner_lower",
    ],
    sortField: "instagram_ad.last_seen",
    typeField: "instagram_ad.type",
    titlePaths: [
      "instagram_ad_variants.title",
      "instagram_ad_variants.title_exactly",
      "instagram_ad_translation.ad_title",
      "instagram_ad_post_owners.post_owner_name",
    ],
    bodyPaths: [
      "instagram_ad_variants.text",
      "instagram_ad_variants.text_exactly",
      "instagram_ad_variants.newsfeed_description",
      "instagram_ad_variants.newsfeed_description_exactly",
      "instagram_ad_translation.ad_text",
      "instagram_ad_translation.news_feed_description",
    ],
    imagePaths: [
      "image_url",
      "new_nas_image_url",
    ],
    thumbnailPaths: [
      "thumbnail_url",
      "new_nas_image_url",
    ],
    ownerImagePaths: [],
    ctaPaths: [
      "instagram_call_to_action.call_to_action",
      "instagram_ad.call_to_action",
      "call_to_action",
    ],
  },
  google: {
    index: NETWORK_INDEXES.google,
    searchFields: ["post_owner_name", "post_owner_lower"],
    sortField: "last_seen",
    typeField: "type",
    titlePaths: ["title", "ad_title", "headline"],
    bodyPaths: ["text", "ad_text", "newsfeed_description", "news_feed_description", "description", "body"],
    imagePaths: ["image_url"],
    thumbnailPaths: ["image_url"],
    ownerImagePaths: ["post_owner_image", "post_owner_image_url"],
    ctaPaths: ["call_to_action"],
  },
};

function getByPath(obj, path) {
  /* v8 ignore next -- getByPath is only ever called with a resolved ES _source object, never null/undefined */
  if (!obj) return undefined;
  // ES stores many fields as literal flat keys with a "." in the name
  // (e.g. obj["instagram_ad_variants.title"] = "AjioLuxe"), NOT as nested
  // objects. So try the flat-key match first, then fall back to nested.
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    return obj[path];
  }
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pickFirstString(source, paths, maxLen = 110) {
  for (const p of paths) {
    const raw = getByPath(source, p);
    if (typeof raw === "string" && raw.trim()) {
      const v = raw.trim().replace(/\s+/g, " ");
      return v.length > maxLen ? v.slice(0, maxLen - 1) + "…" : v;
    }
  }
  return "";
}

// Many ES fields store images as relative paths instead of full URLs.
// Rules (per product/data team):
//   - pasimages/* and pasvideos/* — DROP (don't surface those ads' images)
//   - /Poweradspy/n2/*   — strip prefix, serve from PAS media CDN
//   - /pas-dev/stream/*  — strip prefix, serve from PAS media CDN
//   - /pas-prod/stream/* — strip prefix, serve from PAS media CDN
//   - anything else relative — skip (no safe way to resolve it)
// CDN base comes from `media_url` in config (e.g. localDev.json) so it can
// switch between dev/prod without code changes.
const PAS_MEDIA_CDN = (() => {
  try { return (config.get("media_url") || "").replace(/\/+$/, ""); }
  catch { return ""; }
})();
const STRIP_PAS_PREFIX = /^\/?(?:Poweradspy\/n2|pas-dev\/stream|pas-prod\/stream)\b/i;
const SKIP_PAS_PREFIX = /^\/?(?:pasimages|pasvideos)\b/i;

function pickFirstUrl(source, paths) {
  for (const p of paths) {
    const raw = getByPath(source, p);
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;

    // Full URLs / data URIs / protocol-relative — pass through
    if (/^https?:\/\//i.test(v)) return v;
    if (/^data:image\//i.test(v)) return v;
    if (/^\/\//.test(v)) return `https:${v}`;

    // Skip ads served from pasimages/pasvideos buckets
    if (SKIP_PAS_PREFIX.test(v)) continue;

    // PAS-stored paths — rewrite onto the configured media CDN
    if (STRIP_PAS_PREFIX.test(v) && PAS_MEDIA_CDN) {
      const rest = v.replace(STRIP_PAS_PREFIX, "");
      const tail = rest.startsWith("/") ? rest : `/${rest}`;
      return `${PAS_MEDIA_CDN}${tail}`;
    }

    // Unknown relative path — skip
  }
  return "";
}

class  MonitorService{
  constructor() {
    this.esClient = esClient;
    this.esServers = esServers;
  }

  async fetchTopAdPreview(competitorName, platform) {
    const tag = `[adPreview ${platform}/${competitorName}]`;
    const cfg = AD_PREVIEW_FIELD_CANDIDATES[platform];
    if (!cfg) {
      dlog(`${tag} ❌ no cfg for platform, skipping`);
      return null;
    }

    const serverKey = Object.keys(this.esServers).find((key) =>
      this.esServers[key].indexes.includes(cfg.index)
    );
    if (!serverKey) {
      dlog(`${tag} ❌ no ES server mapped for index ${cfg.index}`);
      return null;
    }

    const client = this.esClient[serverKey];

    // No date filter — some advertisers (like forestessentials) have
    // their latest ad older than 90 days but the count API still says
    // they exist. We need the most recent CREATIVE regardless of age,
    // so we just sort by last_seen desc. With track_total_hits:false ES
    // doesn't count all matches, which keeps this fast even for popular
    // advertisers (50k+ docs).
    //
    // size: AD_PREVIEW_CANDIDATE_SIZE, not 1 (2026-08-21) — the single
    // most-recent hit sometimes has an image_url that's empty (skipped
    // pasimages/pasvideos path) or a genuinely broken URL, silently
    // rendering the "purple, no image" card. Pull a few recent candidates
    // and pick the first one whose image actually resolves (see the loop
    // below) instead of committing to just the top hit. Google is mostly
    // text ads — if none of the candidates have an image, this correctly
    // falls back to the top hit's title/body with no image, same as today.
    const esQueryBody = {
      size: AD_PREVIEW_CANDIDATE_SIZE,
      track_total_hits: false,
      timeout: "30s",
      sort: [{ [cfg.sortField]: { order: "desc", unmapped_type: "long" } }],
      query: {
        bool: {
          must: [
            {
              query_string: {
                fields: cfg.searchFields,
                query: `"${competitorName}"`,
                type: "phrase",
                default_operator: "AND",
                auto_generate_synonyms_phrase_query: false,
              },
            },
          ],
        },
      },
    };

    const tEsStart = Date.now();
    try {
      if (await isEsUnderStress(serverKey)) {
        dlog(`${tag} skipped — ES already under stress this cycle`);
        return null;
      }
      const result = await withLimit(serverKey, () => client.search({ index: cfg.index, body: esQueryBody }), ES_MAX_CONCURRENT);
      const esMs = Date.now() - tEsStart;

      const hits = (result?.hits?.hits || []).map((h) => h._source).filter(Boolean);
      if (!hits.length) {
        dlog(`${tag} 0 hits (${esMs}ms)`);
        return null;
      }

      // Retry-for-image: resolve each candidate hit's image the same way,
      // in recency order, and use the FIRST one whose image actually
      // resolves. Falls back to the top (most recent) hit if none do — a
      // coherent single ad's fields are never mixed across hits.
      let hit = hits[0];
      let image_url = "";
      for (const candidate of hits) {
        const candidateType = String(getByPath(candidate, cfg.typeField) || "").toUpperCase();
        const candidateIsVideo = candidateType.includes("VIDEO");
        const candidateImageFields = candidateIsVideo
          ? (cfg.thumbnailPaths || cfg.imagePaths || [])
          : (cfg.imagePaths || cfg.thumbnailPaths || []);
        const candidateImageUrl = pickFirstUrl(candidate, candidateImageFields);
        if (candidateImageUrl) { hit = candidate; image_url = candidateImageUrl; break; }
      }

      // Hard-truncate at the data layer: the primary ad card is 124x124
      // and email clients ignore overflow:hidden / -webkit-line-clamp
      // inconsistently. The only reliable way to keep the card from
      // growing taller than 124px is to limit the bytes of text we send.
      const title = pickFirstString(hit, cfg.titlePaths, 24);
      const body = pickFirstString(hit, cfg.bodyPaths, 30);
      /* v8 ignore next -- every platform cfg defines ctaPaths, so the `|| []` is defensive */
      const cta = pickFirstString(hit, cfg.ctaPaths || [], 14);
      // post_owner_name = the advertiser/page name (e.g. "ajio", "Mamaearth")
      // shown at the top of the creative card above the title.
      /* v8 ignore next -- every platform cfg defines searchFields, so the `|| []` is defensive */
      const post_owner_name = pickFirstString(hit, cfg.searchFields || [], 20);
      const adType = String(getByPath(hit, cfg.typeField) || "").toUpperCase();
      /* v8 ignore next -- every platform cfg defines ownerImagePaths, so the `|| []` is defensive */
      const post_owner_image_url = pickFirstUrl(hit, cfg.ownerImagePaths || []);

      if (!title && !body && !image_url) {
        dlog(`${tag} hit-but-empty (${esMs}ms) topKeys=${JSON.stringify(Object.keys(hit).slice(0, 8))}…`);
        return null;
      }

      dlog(`${tag} ✓ (${esMs}ms)  candidates=${hits.length}  type=${adType}  owner=${JSON.stringify(post_owner_name)}  title=${JSON.stringify((title || "").slice(0, 40))}  image=${image_url ? "yes" : "no"}`);
      return { platform, title, body, cta, image_url, post_owner_image_url, post_owner_name };
    } catch (err) {
      dlog(`${tag} ❌ ES error (${Date.now() - tEsStart}ms): ${err.message}`);
      logger.error(`[adPreview] ${platform}/${competitorName} — ES error: ${err.message}`);
      return null;
    }
  }

  async fetchAdPreviews(competitorName, activeStatuses = {}) {
    const platforms = [];
    if (activeStatuses.facebook) platforms.push("facebook");
    if (activeStatuses.instagram) platforms.push("instagram");
    if (activeStatuses.google) platforms.push("google");
    if (!platforms.length) return [];

    const results = await Promise.all(
      platforms.map((p) => this.fetchTopAdPreview(competitorName, p))
    );
    return results.filter(Boolean);
  }

  /**
   * Count ads for an advertiser on a given platform IN ELASTICSEARCH,
   * scoped to "yesterday 00:00:00 IST → current time IST".
   *
   * Replaces the old external Laravel /get-ads-count call, which always
   * returned ALL-TIME totals. This makes the email's count cards reflect
   * just the previous day's activity (the same window the daily-pulse
   * concept is built around).
   *
   * Server may run in UTC, so we explicitly use moment.utc + IST offset
   * so the window doesn't shift based on host timezone.
   */
  async countAdsLastDayIST(competitorName, platform) {
    // ── Field lists MIRROR the production search builders ─────────────────
    // (pas_node_api/src/services/<net>/builders/*QueryBuilder._getPostOwnerNameEnv).
    // The cron's count must match what the user sees in their dashboard, so
    // we use the same fields the production search hits.
    const CFG = {
      facebook:  {
        index: NETWORK_INDEXES.facebook,
        fields: [
          "facebook_ad_post_owners.post_owner_name",
          "facebook_ad_post_owners.post_owner_name_ru",
          "facebook_ad_post_owners.post_owner_name_fr",
          "facebook_ad_post_owners.post_owner_name_sp",
          "facebook_ad_post_owners.post_owner_name_ge",
          "facebook_ad_post_owners.post_owner_name_exactly",
        ],
        primaryField: "facebook_ad_post_owners.post_owner_name",
        lastSeen: "facebook_ad.last_seen",
      },
      instagram: {
        index: NETWORK_INDEXES.instagram,
        fields: [
          "instagram_ad_post_owners.post_owner_name",
          "instagram_ad_post_owners.post_owner_name_ru",
          "instagram_ad_post_owners.post_owner_name_fr",
          "instagram_ad_post_owners.post_owner_name_sp",
          "instagram_ad_post_owners.post_owner_name_ge",
          "instagram_ad_post_owners.post_owner_name_exactly",
        ],
        primaryField: "instagram_ad_post_owners.post_owner_name",
        lastSeen: "instagram_ad.last_seen",
      },
      google:    {
        index: NETWORK_INDEXES.google,
        fields: ["post_owner_name"],
        primaryField: "post_owner_name",
        // Verified against pas_node_api/scripts/google_ads_data_v2.mapping.json:
        // post_owner_lower is a genuine `keyword` field (not a guess) — the
        // prefix clause below uses it instead of the analyzed `post_owner_name`
        // text field, same "starts with" result, far cheaper for short names.
        primaryFieldKeyword: "post_owner_lower",
        lastSeen: "last_seen",
        // Google index also contains organic-search results, which are NOT
        // paid ads. Exclude them so the count reflects only actual ads.
        excludeType: { field: "type", values: ["ORGANIC SEARCH"] },
      },
    };
    const cfg = CFG[platform];
    if (!cfg) return 0;

    const serverKey = Object.keys(this.esServers).find((k) =>
      this.esServers[k].indexes.includes(cfg.index)
    );
    /* v8 ignore next -- cfg.index (search_mix/instagram_search_mix/google_ads_data_v2) is always mapped to a configured server */
    if (!serverKey) return 0;
    const client = this.esClient[serverKey];

    // IST window: yesterday 00:00:00 IST → now IST
    const ist = moment.utc().utcOffset("+05:30");
    const since = ist.clone().subtract(1, "day").startOf("day").format("YYYY-MM-DD HH:mm:ss");
    const until = ist.format("YYYY-MM-DD HH:mm:ss");

    // ── Advertiser-name match — mirrors `phraseAcrossFields` + prefix
    // fallback from the production search builders (esQueryHelpers.js). The
    // OLD `multi_match { operator: "or" }` form was splitting multi-word
    // advertisers ("Google Ai") into separate tokens and OR-counting every
    // "Google" or "AI" doc — wildly inflated counts. This version:
    //   1. Phrase-match each word, AND'd together → "Google Ai" must match
    //      both tokens as phrases in some field on the same doc.
    //   2. Plus a `prefix` match on the primary field as a tolerant fallback.
    //
    // The prefix runs against `primaryFieldKeyword` (the *_lower field —
    // single normalized keyword token per doc), NOT `primaryField` (analyzed
    // text). Confirmed against production hot-threads (2026-08-17): a prefix
    // on the analyzed field for a SHORT name ("hp", "mg", "big") matches
    // thousands of unrelated tokenized terms, forcing Lucene to rewrite it
    // into a large TermInSetQuery/boolean-OR (BitSet.or / DocIdSetBuilder.add
    // dominating CPU). A keyword field's prefix uses the sorted term
    // dictionary directly — same "starts with" result, far cheaper.
    const cleaned = String(competitorName || "").replace(/"/g, "").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    // Google-only (2026-08-17): google has exactly ONE advertiser field
    // (post_owner_name), so "every word must appear somewhere in this field"
    // collapses to a single `match` with operator:"and" — identical result to
    // ANDing N separate single-word phrase clauses (both require every
    // analyzed term present, order-independent), but ONE query clause for
    // Lucene to build/score instead of N. Facebook/Instagram check the SAME
    // word across up to 6 OR'd fields each, which doesn't collapse the same
    // way, so they keep the original per-word clauses untouched.
    const phraseEachWord = (platform === 'google' && cfg.fields.length === 1)
      ? { match: { [cfg.fields[0]]: { query: cleaned, operator: "and" } } }
      : words.length === 1
        ? { multi_match: { query: words[0], type: "phrase", fields: cfg.fields } }
        : { bool: { must: words.map((w) => ({ multi_match: { query: w, type: "phrase", fields: cfg.fields } })) } };
    // Google-only: skip the prefix fallback for very short names — see the
    // matching comment in Dashboard/dashboardService.js's buildOwnerClause
    // for the profile:true evidence behind this (short prefixes are what
    // force Lucene's expensive TermInSetQuery rewrite; below this length the
    // fallback also adds little precision anyway).
    const GOOGLE_PREFIX_MIN_LENGTH = 4;
    const skipPrefix = platform === 'google' && cleaned.length < GOOGLE_PREFIX_MIN_LENGTH;
    const advertiserClause = {
      bool: {
        should: skipPrefix
          ? [phraseEachWord]
          : [
              phraseEachWord,
              { prefix: { [cfg.primaryFieldKeyword || cfg.primaryField]: cleaned.toLowerCase() } },
            ],
        minimum_should_match: 1,
      },
    };

    const must = [
      advertiserClause,
      { range: { [cfg.lastSeen]: { gte: since, lte: until } } },
    ];
    const must_not = [];
    if (cfg.excludeType) {
      for (const v of cfg.excludeType.values) {
        must_not.push({ match_phrase: { [cfg.excludeType.field]: v } });
      }
    }

    const tStart = Date.now();
    try {
      if (await isEsUnderStress(serverKey)) {
        dlog(`[esCount ${platform}/${competitorName}] skipped — ES already under stress this cycle`);
        return 0;
      }
      const res = await withLimit(serverKey, () => client.count({
        index: cfg.index,
        body: { query: { bool: { must, ...(must_not.length ? { must_not } : {}) } } },
      }), ES_MAX_CONCURRENT);
      const count = res?.count ?? res?.body?.count ?? 0;
      dlog(`[esCount ${platform}/${competitorName}] = ${count} (window ${since} → ${until} IST, ${Date.now() - tStart}ms)`);
      return count;
    } catch (e) {
      dlog(`[esCount ${platform}/${competitorName}] ❌ ${e.message} (${Date.now() - tStart}ms)`);
      logger.error(`countAdsLastDayIST failed for ${platform}/${competitorName}: ${e.message}`);
      return 0;
    }
  }

  /**
   * Same as countAdsLastDayIST but WITHOUT the date-range filter — gives
   * the all-time count of paid ads ES has for this advertiser on this
   * platform. Google's "ORGANIC SEARCH" exclusion is preserved so the
   * total still reflects only ads, not organic search results.
   *
   * The count also applies the same NAS media filter the search UI uses, so
   * ads whose image / nas / thumbnail field holds a placeholder (i.e. not a
   * real stored "*PowerAdspy*" media path) are ignored — otherwise the
   * all-time total is inflated relative to what the user actually sees.
   * This method shares the same source-of-truth media gates as the dashboard
   * service and the search UI through the common displayable-media helper.
   */
  async countAdsAllTime(competitorName, platform) {
    // ── Field lists MIRROR the production search builders ──────────────
    // (pas_node_api/src/services/<net>/builders/*QueryBuilder._getPostOwnerNameEnv).
    // Same idea as countAdsLastDayIST above — count must equal what the
    // production search returns.
    const CFG = {
      facebook:  {
        index: NETWORK_INDEXES.facebook,
        fields: [
          "facebook_ad_post_owners.post_owner_name",
          "facebook_ad_post_owners.post_owner_name_ru",
          "facebook_ad_post_owners.post_owner_name_fr",
          "facebook_ad_post_owners.post_owner_name_sp",
          "facebook_ad_post_owners.post_owner_name_ge",
          "facebook_ad_post_owners.post_owner_name_exactly",
        ],
        primaryField: "facebook_ad_post_owners.post_owner_name",
        mediaFilter: getDisplayableMediaFilter("facebook"),
      },
      instagram: {
        index: NETWORK_INDEXES.instagram,
        fields: [
          "instagram_ad_post_owners.post_owner_name",
          "instagram_ad_post_owners.post_owner_name_ru",
          "instagram_ad_post_owners.post_owner_name_fr",
          "instagram_ad_post_owners.post_owner_name_sp",
          "instagram_ad_post_owners.post_owner_name_ge",
          "instagram_ad_post_owners.post_owner_name_exactly",
        ],
        primaryField: "instagram_ad_post_owners.post_owner_name",
        mediaFilter: getDisplayableMediaFilter("instagram"),
      },
      google:    {
        index: NETWORK_INDEXES.google,
        fields: ["post_owner_name"],
        primaryField: "post_owner_name",
        primaryFieldKeyword: "post_owner_lower", // verified keyword field — see countAdsLastDayIST's comment
        mediaFilter: getDisplayableMediaFilter("google"),
      },
    };
    const cfg = CFG[platform];
    if (!cfg) return 0;

    const serverKey = Object.keys(this.esServers).find((k) =>
      this.esServers[k].indexes.includes(cfg.index)
    );
    /* v8 ignore next -- cfg.index (search_mix/instagram_search_mix/google_ads_data_v2) is always mapped to a configured server */
    if (!serverKey) return 0;
    const client = this.esClient[serverKey];

    // Advertiser-name match — same phrase-AND + prefix-fallback pattern as
    // countAdsLastDayIST (mirrors production `phraseAcrossFields`). Plus the
    // NAS media filter so placeholder/no-media ads are excluded from the total.
    const cleaned = String(competitorName || "").replace(/"/g, "").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    // Google-only word-AND collapse — see the matching comment in
    // countAdsLastDayIST above for why this is safe/equivalent and why it's
    // scoped to google (single advertiser field) only.
    const phraseEachWord = (platform === 'google' && cfg.fields.length === 1)
      ? { match: { [cfg.fields[0]]: { query: cleaned, operator: "and" } } }
      : words.length === 1
        ? { multi_match: { query: words[0], type: "phrase", fields: cfg.fields } }
        : { bool: { must: words.map((w) => ({ multi_match: { query: w, type: "phrase", fields: cfg.fields } })) } };
    // prefix runs against primaryFieldKeyword (*_lower, a single keyword
    // token/doc) not primaryField (analyzed text) — see the matching comment
    // in countAdsLastDayIST above for why this is cheaper for the same result.
    // Google-only: skip prefix for very short names — see the matching
    // comment + profile:true evidence in countAdsLastDayIST above.
    const GOOGLE_PREFIX_MIN_LENGTH = 4;
    const skipPrefix = platform === 'google' && cleaned.length < GOOGLE_PREFIX_MIN_LENGTH;
    const advertiserClause = {
      bool: {
        should: skipPrefix
          ? [phraseEachWord]
          : [
              phraseEachWord,
              { prefix: { [cfg.primaryFieldKeyword || cfg.primaryField]: cleaned.toLowerCase() } },
            ],
        minimum_should_match: 1,
      },
    };

    const must = [ advertiserClause ];
    if (cfg.mediaFilter) must.push(cfg.mediaFilter);
    const must_not = [];
    if (cfg.excludeType) {
      for (const v of cfg.excludeType.values) {
        must_not.push({ match_phrase: { [cfg.excludeType.field]: v } });
      }
    }
    if (cfg.mediaMustNot) must_not.push(...cfg.mediaMustNot);

    const tStart = Date.now();
    try {
      if (await isEsUnderStress(serverKey)) {
        dlog(`[esCount ${platform}/${competitorName}/all-time] skipped — ES already under stress this cycle`);
        return 0;
      }
      const res = await withLimit(serverKey, () => client.count({
        index: cfg.index,
        body: { query: { bool: { must, ...(must_not.length ? { must_not } : {}) } } },
      }), ES_MAX_CONCURRENT);
      const count = res?.count ?? res?.body?.count ?? 0;
      dlog(`[esCount ${platform}/${competitorName}/all-time] = ${count} (${Date.now() - tStart}ms)`);
      return count;
    } catch (e) {
      dlog(`[esCount ${platform}/${competitorName}/all-time] ❌ ${e.message} (${Date.now() - tStart}ms)`);
      logger.error(`countAdsAllTime failed for ${platform}/${competitorName}: ${e.message}`);
      return 0;
    }
  }

    async getCompetitors(req, res){
        try{
            const platform = req?.query?.platform;
            let platform_status ="";
            const limit = req?.query?.limit || 1;    
            if (!platform) {
                return res.send(
                    Response.validationFailResp("platform is required", "")
                );
            }
            if(platform =="facebook"){
                platform_status ="facebook_status";

            }else if(platform =="instagram"){
                platform_status ="instagram_status";
            }else if(platform =="youtube"){
                platform_status ="youtube_status";
            }else if(platform =="google"){
                platform_status ="google_status";
            }
            if (!platform_status) {
            return res.send(
                Response.validationFailResp("Invalid platform provided", "")
            );
            }
            // Oldest-touched-first (was newest-created-first): as the tracked
            // pool grows, sorting by createdAt DESC lets freshly-added
            // competitors perpetually jump the queue ahead of older ones,
            // which can starve genuinely-active competitors from ever
            // reaching the front of a day's checked batch. updatedAt changes
            // every time a competitor's status flips (via this endpoint,
            // updateCompetitorsStatus, or the daily reset), so sorting by it
            // ascending is a real least-recently-checked ordering.
            const competitors = await Competitors.find({
            [platform_status]: 0
            }) .sort({ updatedAt: 1 }).limit(limit);

            if (competitors?.length === 0) {
             return res.send(
                Response.userSuccessResp("there are no competitors", [])
            );
            }

            const competitorNames = competitors.map(c => c.competitor_name);

            const idsToUpdate = competitors.map(c => c._id);

            await Competitors.updateMany(
            { _id: { $in: idsToUpdate } },
            {
                $set: {
                [platform_status]: 1
                }
            }
            );
             return res.send(
                Response.userSuccessResp("competitors name retrived successfully", {competitorNames})
            );
  
        }catch(error){
            logger.error("Error in getting competitors in getCompetitors", error);
            return res.send(
                Response.userFailResp("Error in getting competitors in getCompetitors", error)
            );
        }
    }

    async updateCompetitorsStatus(req, res) {
    try {
        const platform = req?.query?.platform;
        const platformConfig = {
        facebook: {
            statusField: "facebook_status",
            index: NETWORK_INDEXES.facebook,
            esField: "facebook_ad_post_owners.post_owner_name",
            lastSeenField: "facebook_ad.last_seen",
        },
        instagram: {
            statusField: "instagram_status",
            index: NETWORK_INDEXES.instagram,
            esField: "instagram_ad_post_owners.post_owner_name",
            lastSeenField: "instagram_ad.last_seen",
        },
        youtube: {
            statusField: "youtube_status",
            index: NETWORK_INDEXES.youtube,
            esField: "post_owner",
            lastSeenField: "last_seen",
        },
        google: {
            statusField: "google_status",
            index: NETWORK_INDEXES.google,
            esField: "post_owner_name",
            lastSeenField: "last_seen",
        },
        };

        if (!platform || !platformConfig[platform]) {
        return res.send(Response.validationFailResp("Invalid or missing platform", ""));
        }

        const { statusField, index, esField, lastSeenField } = platformConfig[platform];

        const competitors = await Competitors.find(
        { [statusField]: 1 },
        { competitor_name: 1, _id: 0 }
        );

        if (!competitors.length) {
        return res.send(Response.userSuccessResp("No competitors found", []));
        }

        const serverKey = Object.keys(this.esServers).find((key) =>
        this.esServers[key].indexes.includes(index)
        );

        if (!serverKey) {
        return res.send(Response.validationFailResp("Index not mapped to any server", ""));
        }

        const client = this.esClient[serverKey];

        let start, end;
        if (platform === "youtube") {
        start = Math.floor(moment().subtract(1, "day").startOf("day").valueOf() / 1000);
        end = Math.floor(moment().endOf("day").valueOf() / 1000);
        } else {
        start = moment().subtract(1, "day").startOf("day").format("YYYY-MM-DD HH:mm:ss");
        end = moment().endOf("day").format("YYYY-MM-DD HH:mm:ss");
        }

        // Lowered 10 → 3 (2026-08-17) — same reasoning as activeCompetitorContacts:
        // a smaller outer batch means esLoadGuard's stress-check sees smaller
        // waves and can actually react between them instead of one big burst
        // landing before it refreshes.
        const limit = pLimit(3);

        const searchPromises = competitors.map((comp) =>
        limit(async () => {
            const compName = comp.competitor_name;
            const esQuery = {
            index,
            body: {
                query: {
                bool: {
                    must: [
                    {
                        query_string: {
                        fields: [esField],
                        query: `"${compName}"`,
                        type: "phrase",
                        default_operator: "AND",
                        auto_generate_synonyms_phrase_query: false,
                        },
                    },
                    {
                        range: {
                        [lastSeenField]: {
                            gte: start,
                            lte: end,
                        },
                        },
                    },
                    ],
                },
                },
            },
            };

            try {
            if (await isEsUnderStress(serverKey)) {
                dlog(`[updateCompetitorsStatus ${platform}/${compName}] skipped — ES already under stress this cycle`);
                return { compName, outcome: "stressed" };
            }
            const esRes = await withLimit(serverKey, () => client.search(esQuery), ES_MAX_CONCURRENT);
            if (esRes.hits.hits.length > 0) {
                return { compName, outcome: "matched" };
            }
            return { compName, outcome: "zero" };
            } catch (err) {
            console.error(`Error querying ES for ${compName}:`, err.message);
            return { compName, outcome: "error", error: err.message };
            }
        })
        );

        const results = await Promise.all(searchPromises);
        const filteredResults = results.filter((r) => r.outcome === "matched").map((r) => r.compName);

        // Diagnostic counters (2026-08-20) — added after a multi-day incident where
        // this endpoint returned HTTP 200 every night but promoted almost nothing to
        // status=2, with NO trace in any log: isEsUnderStress() skips only dlog(),
        // which is silent in production (MAIL_DEBUG_LOG=false) and console-only
        // (never reaches this winston logger) even when it does print. This
        // logger.info call is the only durable record of WHY a cycle promoted so
        // few/none — read it in resources/logs/responselogs/ the morning after.
        const outcomeCounts = { stressed: 0, zero: 0, error: 0, matched: 0 };
        for (const r of results) outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
        logger.info(
        `[updateCompetitorsStatus] platform=${platform} candidates=${competitors.length} ` +
        `matched=${outcomeCounts.matched} stressed-skip=${outcomeCounts.stressed} ` +
        `zero-hit=${outcomeCounts.zero} error=${outcomeCounts.error}`
        );

        if (filteredResults.length > 0) {
        await Competitors.updateMany(
            { competitor_name: { $in: filteredResults } },
            { $set: { [statusField]: 2 } }
        );
        }

        return res.send(Response.userSuccessResp("Filtered competitors with ES data", filteredResults));
    } catch (error) {
        logger.error("Error in updating the status in updateCompetitorsStatus", error);
        return res.send(
        Response.userFailResp("Error in updating the status in updateCompetitorsStatus", error)
        );
    }
    }

    async activeCompetitorContacts(req, res) {
        const tEndpointStart = Date.now();
        try {
          // ----- Diagnostic: which DB is THIS server instance connected to?
          //       Helps catch the case where force-active set statuses on a
          //       different DB than the server reads from (NODE_ENV mismatch).
          const mongoose = (await import("mongoose")).default;
          const dbName = mongoose.connection?.db?.databaseName || "?";
          const dbHost = mongoose.connection?.host || "?";
          dlog(`[mail] server reading from DB="${dbName}" @ ${dbHost}  (NODE_ENV=${process.env.NODE_ENV || "(unset → default.json)"})`);

          const activeCompetitors = await Competitors.find({
            $or: [
              { facebook_status: 2 },
              { instagram_status: 2 },
              { google_status: 2 },
            ],
          });
          dlog(`[mail] activeCompetitors count (status=2 on any platform): ${activeCompetitors.length}`);
          if (activeCompetitors.length) {
            dlog(`[mail]   sample: ${activeCompetitors.slice(0, 5).map((c) => `${c.competitor_name}(fb=${c.facebook_status||0},ig=${c.instagram_status||0},g=${c.google_status||0})`).join(", ")}`);
          }

          if (activeCompetitors.length === 0) {
            return res.send(
              Response.validationFailResp(
                "No active competitors found with the present data",
                ""
              )
            );
          }

          const activeCompetitorIds = activeCompetitors.map((c) => c._id.toString());

          const competitorRequests = await Competitors_request.find({
            // competitors: { $in: activeCompetitorIds },
            monitoring: { $in: activeCompetitorIds },
          });
          dlog(`[mail] competitorRequests matching active competitors: ${competitorRequests.length}`);
          if (competitorRequests.length) {
            const uniqueUserIds = [...new Set(competitorRequests.map((r) => String(r.user_id)))];
            dlog(`[mail]   spread across ${uniqueUserIds.length} unique user_id(s): ${uniqueUserIds.slice(0, 5).join(", ")}${uniqueUserIds.length > 5 ? "…" : ""}`);
          }

          if (competitorRequests.length === 0) {
            return res.send(
              Response.validationFailResp("No matching competitor request found.", "")
            );
          }

          const userMap = {};

          // Per-request override (manual-send path): `req.body.target_email`
          // wins over the config-level TEST_EMAIL_ONLY so a manual /send-competitor
          // call can target a single user without touching process env / config.
          const requestTargetEmail = String(req?.body?.target_email || "").trim().toLowerCase();
          // TEST MODE: when TEST_EMAIL_ONLY is set in config, only that user
          // gets the email; everyone else is silently skipped. Set the value
          // to "" or remove the key from config to restore normal behavior.
          let testEmailOnly = requestTargetEmail;
          if (!testEmailOnly) {
            try { testEmailOnly = (config.get("TEST_EMAIL_ONLY") || "").trim().toLowerCase(); } catch { /* not set */ }
          }
          if (requestTargetEmail) {
            dlog(`[mail] 🎯 request body target_email override — only "${requestTargetEmail}" will receive the email`);
          } else if (testEmailOnly) {
            dlog(`[mail] ⚠️  TEST_EMAIL_ONLY filter active — only "${testEmailOnly}" will receive the email`);
          } else {
            dlog(`[mail] TEST_EMAIL_ONLY filter NOT set — all users with active competitors will be processed`);
          }

          // ----- Pre-fetch every competitor's count + ad-preview ONCE, in
          // parallel. This way (a) we don't redo the same advertiser when
          // it appears in multiple projects, and (b) competitors run with
          // some concurrency instead of strictly sequential.
          //
          // Lowered 8 → 3 (2026-08-17): each competitor fires 9 ES calls at
          // once (see below), so 8-way outer concurrency could throw up to
          // 72 requests at the ES-side gate (esLoadGuard.js) in one instant —
          // too large a burst for its 1s stress-check refresh to react to
          // before most of them are already past it. A smaller outer batch
          // means the gate sees smaller waves and can actually back off
          // between them.
          const competitorDataCache = new Map(); // _id (string) → built brand-card payload
          const tFetchStart = Date.now();
          const CONCURRENCY = 3;
          const fetchLimit = pLimit(CONCURRENCY);

          await Promise.all(activeCompetitors.map((comp) => fetchLimit(async () => {
            const competitor_name = comp.competitor_name;
            const compId = comp._id.toString();
            const tCompStart = Date.now();
            try {
              // Fire ALL 6 network calls in parallel — 3 ES count queries
              // (replaces the external Laravel /get-ads-count which gave
              //  all-time totals — now we count just yesterday→now in IST)
              // + 3 ES ad-preview queries.
              // 9 parallel calls per competitor:
              //   3× last-24h count (existing query)
              //   3× all-time count (no date filter)
              //   3× ad-preview
              const [
                fb24, ig24, g24,
                fbAll, igAll, gAll,
                fbAd, igAd, gAd
              ] = await Promise.all([
                this.countAdsLastDayIST(competitor_name, "facebook"),
                this.countAdsLastDayIST(competitor_name, "instagram"),
                this.countAdsLastDayIST(competitor_name, "google"),
                this.countAdsAllTime(competitor_name, "facebook"),
                this.countAdsAllTime(competitor_name, "instagram"),
                this.countAdsAllTime(competitor_name, "google"),
                this.fetchTopAdPreview(competitor_name, "facebook"),
                this.fetchTopAdPreview(competitor_name, "instagram"),
                this.fetchTopAdPreview(competitor_name, "google"),
              ]);

              // Counts drive which cards render — include a platform if
              // EITHER its 24h count OR its all-time count is > 0.
              const counts = {};
              const fbHas = fb24 > 0 || fbAll > 0;
              const igHas = ig24 > 0 || igAll > 0;
              const gHas  = g24  > 0 || gAll  > 0;
              if (fbHas) counts.facebook  = { last24h: fb24, total: fbAll };
              if (igHas) counts.instagram = { last24h: ig24, total: igAll };
              if (gHas)  counts.google    = { last24h: g24,  total: gAll  };

              // Drop any ad-preview whose platform has no count at all.
              const ads = [];
              if (fbAd && fbHas) ads.push(fbAd);
              if (igAd && igHas) ads.push(igAd);
              if (gAd  && gHas)  ads.push(gAd);

              dlog(`[mail ${competitor_name}] (${Date.now() - tCompStart}ms)  counts: fb=${fb24}/${fbAll} ig=${ig24}/${igAll} g=${g24}/${gAll}  ads: ${JSON.stringify(ads.map((a) => a.platform))}`);

              const post_owner_image_url = ads.map((a) => a.post_owner_image_url).find((u) => !!u) || "";

              competitorDataCache.set(compId, {
                name: competitor_name,
                domain: comp.competitor_url || "",
                post_owner_image_url,
                counts,
                ads,
              });
            } catch (error) {
              console.error(`API failed for ${competitor_name}:`, error?.message || error);
            }
          })));
          dlog(`[mail] all ${activeCompetitors.length} competitors resolved in ${Date.now() - tFetchStart}ms (concurrency=${CONCURRENCY})`);

          // ----- Now assemble per-user brand groupings from the cache -----
          let dbgRequestsTotal = 0;
          let dbgUserMissing = 0;
          let dbgFilteredOut = 0;
          let dbgNoMatchedComps = 0;
          let dbgAdded = 0;
          for (const request of competitorRequests) {
            dbgRequestsTotal++;
            const user = await User_details.findById(request.user_id);
            if (!user || !user.email) {
              dbgUserMissing++;
              dlog(`[mail] ❌ request ${request._id}: user_id=${request.user_id} not found / no email`);
              continue;
            }

            // TEST MODE filter — skip everyone except the configured test email
            if (testEmailOnly && user.email.trim().toLowerCase() !== testEmailOnly) {
              dbgFilteredOut++;
              dlog(`[mail] · skipping "${user.email}" — does not match TEST_EMAIL_ONLY filter`);
              continue;
            }

            const matchedCompetitors = activeCompetitors.filter((comp) =>
              request.monitoring.includes(comp._id.toString())
            );
            if (!matchedCompetitors.length) {
              dbgNoMatchedComps++;
              dlog(`[mail] · skipping "${user.email}" — request has 0 active competitors in monitoring`);
              continue;
            }
            dlog(`[mail] ✓ "${user.email}" — matched ${matchedCompetitors.length} active competitors for brand "${(request.advertiser && request.advertiser[0]) || request.project_name}"`);
            dbgAdded++;

            // Show ALL competitors per brand — no cap. Data already
            // resolved in the parallel pre-fetch above; just look it up.
            const brandCompetitors = [];
            for (const comp of matchedCompetitors) {
              const cached = competitorDataCache.get(comp._id.toString());
              if (cached) brandCompetitors.push(cached);
            }

            if (!brandCompetitors.length) continue;

            const brand_name = (request.advertiser && request.advertiser[0]) || request.project_name || "Your brand";
            const brandEntry = {
              brand_name,
              project_id: String(request._id), // competitors_request._id → brand-cc lookup
              project_name: request.project_name || "Your brand",
              brand_url: request.brand_url || "",
              competitors: brandCompetitors,
            };

            if (userMap[user.email]) {
              const existing = userMap[user.email].brands.find(
                (b) => b.brand_name === brandEntry.brand_name && b.project_name === brandEntry.project_name
              );
              if (existing) {
                const seen = new Set(existing.competitors.map((c) => c.name));
                for (const c of brandEntry.competitors) {
                  if (!seen.has(c.name)) existing.competitors.push(c);
                }
              } else {
                userMap[user.email].brands.push(brandEntry);
              }
            } else {
              userMap[user.email] = {
                email: user.email,
                name: user.userName || "user",
                brands: [brandEntry],
              };
            }
          }
      
          dlog(`[mail] per-request loop done: total=${dbgRequestsTotal}  user-missing=${dbgUserMissing}  filtered-out=${dbgFilteredOut}  no-matched-comps=${dbgNoMatchedComps}  added=${dbgAdded}`);
          dlog(`[mail] userMap built with ${Object.keys(userMap).length} unique user(s): ${JSON.stringify(Object.keys(userMap))}`);

          const results = Object.values(userMap);
          const seenEmails = new Set();
      
          for (const user of results) {
            const normalizedEmail = user.email.trim().toLowerCase();
      
            logger.info("Does seenEmails already have it?", seenEmails.has(normalizedEmail));
      
            if (seenEmails.has(normalizedEmail)) {
              
              continue;
            }
      
            seenEmails.add(normalizedEmail);
            
      
            let mailStatus = "not sent";
      
            const fullUser = await User_details.findOne({ email: user.email });
            if (!fullUser) {
              user.mailStatus = mailStatus;
              continue;
            }
      
            const pendingEmail = await Competitors_request.findOne({
              user_id: fullUser._id,
              email_status: 0,
            });
      
            if (!pendingEmail) {
              logger.info(`Email already sent or not needed for: ${user.email}`);
              user.mailStatus = mailStatus;
              continue;
            }

            // --- Member CC removed (manifest §13/§14) ---
            // CC is dead across the project. Member visibility now happens
            // via a separate brand-isolated DIRECT send to each picked
            // member, fired AFTER the owner's mail goes out below
            // (`_runMemberBrandPass`). Owner mail no longer rides any
            // extra recipients along.

            // --- Email-size guard ---
            // No per-brand competitor cap — show every monitored competitor.
            // If the total payload is too large the splitter below moves
            // half the brands into a second email instead of dropping data.
            const MAX_HTML_BYTES = 220_000;
            const MAX_BATCHES = 2;

            // Measure size with the full set first.
            const fullHtml = emailService.renderTemplate("competitorUpdate.html", {
              name: user.name,
              email: user.email,
              brands: user.brands,
            });
            /* v8 ignore next -- every brand reaching here has a non-empty competitors array (guarded above), so the `|| 0` is unreachable */
            dlog(`[mail] ${user.email} — ${user.brands.length} brand(s), ${user.brands.reduce((s, b) => s + (b.competitors?.length || 0), 0)} comps total, html_bytes=${fullHtml.length}`);

            let batches;
            if (fullHtml.length <= MAX_HTML_BYTES || user.brands.length <= 1) {
              batches = [user.brands];
            } else {
              const half = Math.ceil(user.brands.length / 2);
              batches = [user.brands.slice(0, half), user.brands.slice(half)];
              dlog(`[mail] ${user.email} — html too large (${fullHtml.length} > ${MAX_HTML_BYTES}). Splitting into ${batches.length} email(s): ${batches.map((b) => `${b.length} brand(s)`).join(" + ")}`);
            }
            /* v8 ignore next -- the splitter produces at most 2 batches and MAX_BATCHES is 2, so this cap never trips */
            if (batches.length > MAX_BATCHES) batches = batches.slice(0, MAX_BATCHES);

            try {
              const user_subscribe_detail = await User_details.findOne({ email: user.email });
              if (user_subscribe_detail && user_subscribe_detail.unsubscribed === 1) {
                logger.info(`User ${user.email} has unsubscribed. Skipping email.`);
                dlog(`[mail] ${user.email} — unsubscribed, skipping`);
                mailStatus = "Un-subscribed";
              } else if (await isBlacklisted(user.email)) {
                // Bounce blacklist (manifest §15). Don't mail, log the skip.
                dlog(`[mail] ${user.email} — on bounce blacklist, skipping`);
                logger.info(`User ${user.email} previously bounced. Skipping email.`);
                try {
                  await logSend({
                    send_id: newSendId(),
                    mail_type: "competitorUpdate",
                    to: user.email,
                    /* v8 ignore next -- user.name always defaults to "user", so the null fallback is unreachable */
                    user_name: user.name || null,
                    subject: null,
                    status: "skipped",
                    failure_reason: BLACKLISTED_SKIP_REASON,
                    meta: { source: "cron" },
                  });
                } catch { /* logSend handles its own errors */ }
                mailStatus = "skipped:bounce_blacklist";
              } else {
                let anySent = false;
                for (let i = 0; i < batches.length; i++) {
                  const batchPayload = {
                    to: user.email,
                    code: {
                      brands: batches[i],
                      batchInfo: batches.length > 1 ? { index: i + 1, total: batches.length } : undefined,
                    },
                    name: user.name,
                  };
                  const mailResponse = await emailService.sendEmailDirect(batchPayload);
                  if (mailResponse?.message === "Email sent successfully") {
                    anySent = true;
                  } else {
                    dlog(`[mail] ${user.email} — batch ${i + 1}/${batches.length} FAILED: ${mailResponse?.error || "unknown"}`);
                  }
                }
                if (anySent) {
                  await Competitors_request.updateMany(
                    { user_id: fullUser._id },
                    { $set: { email_status: 1 } }
                  );
                  mailStatus = batches.length > 1 ? `sent (${batches.length} parts)` : "sent";
                  logger.info("updated the mail status to sent");
                }
              }
            } catch (error) {
              console.error(`Mail failed for ${user.email}:`, error.message);
              user.mailStatus = "failed";
            }
            logger.info(`the current mail status ${mailStatus} to this email ${user.email}`);
            user.mailStatus = mailStatus;

            // ── Member-brand DIRECT send (manifest §13) ─────────────────
            // Runs AFTER the owner mail. Its failure NEVER touches the
            // owner's state or mailStatus — its own try/catch swallows.
            // No CC, no BCC. Each member gets their own brand-isolated
            // mail directly. Skips with a logged reason when the assigned
            // brand has no data today (so the admin panel can show why).
            try {
              await this._runMemberBrandPass({
                /* v8 ignore next -- user.brands is always populated before this point */
                userBrands: user.brands || [],
                ownerUserId: fullUser._id,
                /* v8 ignore next -- user.name always defaults to "user", so the final null fallback is unreachable */
                ownerName: fullUser.userName || user.name || null,
                ownerEmail: user.email,
              });
            } catch (e) {
              dlog(`[mail:member] ${user.email} — pass failed (owner mail unaffected): ${e.message}`);
              logger.error(`member-brand pass for ${user.email} failed: ${e.message}`);
            }
          }
      
          dlog(`[mail] ✅ endpoint total time: ${Date.now() - tEndpointStart}ms`);
          return res.send(Response.userSuccessResp("competitors with updated data", results));
        } catch (error) {
          dlog(`[mail] ❌ endpoint failed after ${Date.now() - tEndpointStart}ms: ${error.message}`);
          logger.error("Error in fetching the updated competitors data", error);
          return res.send(
            Response.userFailResp("Error in fetching the updated competitors data", {
              message: error.message,
              stack: error.stack,
            })
          );
        }
      }

/**
 * Member-Brand DIRECT mail pass — manifest §13.
 *
 * For one owner: look at every `brand_cc_members` row this owner has, and
 * for each picked member, send a brand-isolated digest directly to them
 * (no CC). The owner's user/competitor/email_status state is NEVER touched
 * here — this pass is auxiliary.
 *
 * Skips with a logged reason when the assigned brand has no data today
 * (so the admin panel's EmailDetails view explains why the mail wasn't sent).
 *
 * Inputs:
 *   userBrands  — owner's brand payload already built by the main loop
 *                 (each brand has project_id + competitors + counts).
 *   ownerUserId — owner's User_details._id (used as brand_cc_members.user_id).
 *   ownerName   — owner's display name (for the "Added by …" badge).
 *   ownerEmail  — owner's email (for log meta / dlog).
 */
async _runMemberBrandPass({ userBrands, ownerUserId, ownerName, ownerEmail }) {
  const last24hOf = (v) => (v && typeof v === "object") ? (Number(v.last24h) || 0) : (Number(v) || 0);
  const brandHasData = (b) => (b?.competitors || []).some((c) =>
    ["facebook", "instagram", "google"].some((p) => last24hOf(c?.counts?.[p]) > 0)
  );

  // Index brands by project_id so we can look up the payload for each
  // brand_cc_members row without rescanning.
  const brandByProjectId = new Map();
  for (const b of userBrands) {
    if (b?.project_id) brandByProjectId.set(String(b.project_id), b);
  }

  // Every brand_cc_members row this owner has — NOT pre-filtered to
  // data-brands, because we want to LOG the skipped sends too.
  const ccRows = await BrandCcMember.find(
    { user_id: ownerUserId },
    { project_id: 1, member_ids: 1, member_emails: 1 }
  ).lean();
  if (!ccRows.length) {
    dlog(`[mail:member] ${ownerEmail} — no brand_cc_members rows; member-brand pass: 0 sends, 0 skips`);
    return;
  }

  // Resolve member names once across all rows (one Member.find for
  // everyone the owner has picked anywhere).
  const allMemberIds = [...new Set(ccRows.flatMap((r) => (r.member_ids || []).map(String)))];
  const memberDocs = allMemberIds.length
    ? await Member.find({ _id: { $in: allMemberIds } }, { email: 1, name: 1 }).lean()
    : [];
  const nameByEmail = new Map();
  for (const m of memberDocs) {
    const k = String(m.email || "").trim().toLowerCase();
    if (k) nameByEmail.set(k, m.name || "");
  }

  // PASS A — aggregate per member: collect every brand each member is
  // assigned to (data-brands + no-data brands), instead of mailing per
  // (member, brand) pair. One member = one mail.
  const memberAssignments = new Map(); // email → { name, dataBrands[], noDataBrandNames[] }
  for (const row of ccRows) {
    const projectId = String(row.project_id || "");
    const brand = brandByProjectId.get(projectId);
    const emails = (row.member_emails || [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => e && /\S+@\S+\.\S+/.test(e));
    if (!emails.length) continue;

    for (const email of emails) {
      if (!memberAssignments.has(email)) {
        memberAssignments.set(email, {
          name: nameByEmail.get(email) || "",
          dataBrands: [],         // brands that HAVE last-24h data → rendered in the mail
          noDataBrandNames: [],   // brands we silently dropped → recorded in skip log if all dropped
        });
      }
      const entry = memberAssignments.get(email);
      if (!brand) {
        entry.noDataBrandNames.push("(deleted/unmonitored)");
      } else if (brandHasData(brand)) {
        entry.dataBrands.push(brand);
      } else {
        entry.noDataBrandNames.push(brand.brand_name || "(unnamed)");
      }
    }
  }

  // PASS B — one consolidated send per member.
  let sent = 0, failed = 0, skipped = 0;
  for (const [email, entry] of memberAssignments) {
    const memberName = entry.name;
    const assignedBrandNames = [
      ...entry.dataBrands.map((b) => b.brand_name).filter(Boolean),
      ...entry.noDataBrandNames,
    ];

    // Bounce blacklist (manifest §15) — one skip log per member, lists all
    // brands the owner had assigned (so admin panel sees the full picture).
    if (await isBlacklisted(email)) {
      try {
        await logSend({
          send_id: newSendId(),
          mail_type: "competitorUpdate",
          to: email,
          user_name: memberName || null,
          subject: null,
          status: "skipped",
          failure_reason: BLACKLISTED_SKIP_REASON,
          meta: {
            source: "member_brand",
            added_by: ownerUserId,
            added_by_user_name: ownerName || null,
            added_by_email: ownerEmail || null,
            assigned_brand_names: assignedBrandNames,
          },
        });
      } catch { /* logSend handles its own errors */ }
      skipped++;
      continue;
    }

    // All assigned brands had no data → one skip log per member.
    if (!entry.dataBrands.length) {
      try {
        await logSend({
          send_id: newSendId(),
          mail_type: "competitorUpdate",
          to: email,
          user_name: memberName || null,
          subject: null,
          status: "skipped",
          failure_reason: "all assigned brands had no new ads in last 24 hours",
          meta: {
            source: "member_brand",
            added_by: ownerUserId,
            added_by_user_name: ownerName || null,
            added_by_email: ownerEmail || null,
            assigned_brand_names: assignedBrandNames,
          },
        });
      } catch (e) {
        dlog(`[mail:member] ${ownerEmail} → ${email} — skip-log write failed: ${e.message}`);
      }
      skipped++;
      continue;
    }

    // Live send — ONE mail with ALL the member's data-brands (template
    // applies the same top-5 brands / top-3 competitors filter the owner
    // mail uses).
    const result = await emailService.sendCompetitorMemberMail({
      to: email,
      name: memberName || "there",
      addedBy: ownerName || ownerEmail,
      addedByEmail: ownerEmail,
      addedByUserId: ownerUserId,
      brands: entry.dataBrands,
    });
    if (result?.ok) sent++; else failed++;
  }

  dlog(`[mail:member] ${ownerEmail} — pass complete: sent=${sent} failed=${failed} skipped=${skipped}`);
}

async updateDailyCompetitors(req, res) {
    try {
        // Same-day no-op guard (2026-08-20) — lets the old external DevOps
        // crontab and the new in-process competitorMailCron safely coexist
        // during rollout. A marker-read failure fails OPEN (proceeds with
        // the real reset) — same philosophy as isEsUnderStress()'s own
        // fail-open catch — so a transient Mongo hiccup on the guard itself
        // never blocks the actual daily reset.
        const todayIST = moment.utc().utcOffset("+05:30").format("YYYY-MM-DD");
        try {
            const marker = await CompetitorPipelineState.findById("daily_reset").lean();
            if (marker?.lastResetDateIST === todayIST) {
                return res.send(
                    Response.userSuccessResp("Statuses already reset today — no-op", [])
                );
            }
        } catch (e) {
            logger.error(`updateDailyCompetitors: marker read failed, proceeding with reset: ${e.message}`);
        }

        await Competitors.updateMany(
            {},
            {
                $set: {
                    facebook_status: 0,
                    instagram_status: 0,
                    youtube_status: 0,
                    google_status: 0
                }
            }
        );

        await Competitors_request.updateMany(
            {},
            { $set: { email_status: 0 } }
        );

        try {
            await CompetitorPipelineState.updateOne(
                { _id: "daily_reset" },
                { $set: { lastResetDateIST: todayIST } },
                { upsert: true }
            );
        } catch (e) {
            logger.error(`updateDailyCompetitors: marker write failed: ${e.message}`);
        }

        return res.send(
            Response.userSuccessResp("Statuses updated to 0 successfully", [])
        );
    } catch (error) {
        logger.error("Error in updateDailyCompetitors:", error);
        return res.send(
            Response.userFailResp("Failed to update statuses", error)
        );
    }
}

async unSubscribeMail(req,res) {
  try{

    const {email} = req.body;

    if(!email){
      return res.send(Response.validationFailResp("Email is required"));
    }

    const result = await User_details.updateOne(
      {email: email},
      { $set: { unsubscribed: 1 } }
    );
    
    if(result.matchedCount == 0 && result.modifiedCount == 0){
      logger.info("There is no mail by this name");
      return res.send(Response.userFailResp("Email not found in user records"));
    }
     
    return res.send(Response.userSuccessResp("User unsubscribed successfully", []));

  } catch (error){
    logger.error("Error in updating unsubscribing the user",error);
    return res.send(
      Response.userFailResp("Failed to update the user data",error)
    );
  }
}

async reSubscribeMail(req,res) {
  try {
    const {email} = req.body;

    if(!email){
      return res.send(Response.validationFailResp("Email is required"))
    }

    const result = await User_details.updateOne(
      {email: email},
      {$set: { unsubscribed: 0 }}
    );

    if(result.matchedCount == 0){
      logger.info("There is no mail to resubscribe");
      return res.send(Response.userFailResp("Email not found in resubscribe records"));
    }

    return res.send(Response.userSuccessResp("user resubscribed successfully",[]));

  } catch (error) {
    logger.error("Error in updating resubscribing the user",error);
    return res.send(
      Response.userFailResp("Failed to update the user data",error)
    );
  }
}

}

export default new MonitorService();
