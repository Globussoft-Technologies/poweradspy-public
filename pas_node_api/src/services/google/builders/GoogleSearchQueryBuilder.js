"use strict";
require("dotenv").config();

/**
 * GoogleSearchQueryBuilder — v2 index (google_ads_data_v2, clean mapping).
 *
 * The index was reindexed off the old edge_ngram `custom_analyzer` onto:
 *   - content fields (text/title/newsfeed_description/news_feed_description/
 *     post_owner_name) → `content_analyzer` = standard + lowercase + asciifolding
 *     (NO edge_ngram, NO stemming). So whole-word matching is exact:
 *     "bus" no longer matches "business", "hair" no longer matches "Haier".
 *   - every exact-code field (type, country, category, subCategory, source,
 *     built_with, ad_position, …) → `keyword` + lowercase_normalizer, so a
 *     `term`/`terms` filter is case-insensitive AND cache-friendly.
 *   - `id` is the ES `_id` (unique) → collapse + cardinality agg dropped.
 *
 * Query design (FAST):
 *   - Everything goes in `filter` context (no scoring, cacheable) because the
 *     product sorts by recency (last_seen), not relevance.
 *   - Keyword: match cross_fields AND (default) / match_phrase (Search Precisely).
 *   - Advertiser: match AND + phrase-prefix (typeahead) / match_phrase (precise).
 *   - Domain: term + wildcard on the clean `domain` field.
 *   - No collapse, no cardinality agg → hits.total is exact (ids are unique).
 */

const {
  flatBool,
  termFilter,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require("../../common/helpers/esQueryHelpers");

const DEFAULT_GOOG_INDEX = process.env.GOOG_ELASTIC_INDEX || "google_ads_data_v2";

// Content fields searched by the keyword box (all on content_analyzer).
const CONTENT_FIELDS = [
  "text",
  "title",
  "newsfeed_description",
  "news_feed_description",
];

/**
 * NAS image must_not — IMAGE ads with no/empty new_nas_image_url are excluded.
 * `type` is keyword+normalizer so the term value is lowercased to match.
 */
const IMAGE_MUST_NOT = {
  bool: {
    filter: [
      { term: { type: "image" } },
      {
        bool: {
          should: [
            { bool: { must_not: [{ exists: { field: "new_nas_image_url" } }] } },
            { term: { new_nas_image_url: "" } },
          ],
          minimum_should_match: 1,
        },
      },
    ],
  },
};

/**
 * Marketing-platform label → domain substring.
 * Mirrors the detection logic in frontend_user_activity/controllers/userActivityController.js.
 * Searching `domain` for these substrings is fast (low cardinality) and relevant,
 * instead of scanning every unique URL with a leading wildcard.
 */
const MARKET_PLATFORM_DOMAIN_PATTERNS = {
  'adobe audience manager': 'demdex.net',
  'branch':                 'branch',
  'conversionx':            'conversionx',
  'google marketing platform': 'doubleclick',
  'hootsuite':              'ow.ly',
  'hubspot':                'hubs.ly',
  'kenshoo':                'xg4ken.com',
  'neustar':                'agkn.com',
};

class GoogleSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_GOOG_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = "last_seen";
    this._sortMethod = "desc";
    this._ipBasedCountry = "";
    this._profile = undefined;
    this._params = {};
  }

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }
  setSortField(f) { this._sortField = f; return this; }
  setSortMethod(v) { if (v === "asc" || v === "desc") this._sortMethod = v; return this; }
  setIpBasedCountry(v) { this._ipBasedCountry = v && v !== "NA" ? v : ""; return this; }
  setProfile(v) { this._profile = v; return this; }

  setKeyword(v) { this._params.keyword = v; return this; }
  // Frontend "Search Precisely" (payload `exact_search` 0/1). When true, keyword
  // and advertiser are matched as an exact consecutive phrase instead of AND.
  setExactSearch(v) { this._params.exactSearch = !!v; return this; }
  setPostOwnerName(v) { this._params.postOwnerName = v; return this; }
  setUrl(v) { this._params.url = v; return this; }
  setCountry(v) { this._params.country = Array.isArray(v) ? v : [v]; return this; }
  setState(v) { this._params.state = Array.isArray(v) ? v : [v]; return this; }
  setCity(v) { this._params.city = Array.isArray(v) ? v : [v]; return this; }
  setCallToAction(v) { this._params.callToAction = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v) { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v) { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v) { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v) { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setAdSubPosition(v) { this._params.adSubPosition = Array.isArray(v) ? v : [v]; return this; }
  setGender(v) { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v) { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTargetKeyword(v) { this._params.targetKeyword = Array.isArray(v) ? v : [v]; return this; }
  setTags(v) { this._params.tags = Array.isArray(v) ? v : [v]; return this; }
  setBuiltWith(v) { this._params.builtWith = Array.isArray(v) ? v : [v]; return this; }
  setTrack(v) { this._params.track = Array.isArray(v) ? v : [v]; return this; }
  setSource(v) { this._params.source = Array.isArray(v) ? v : [v]; return this; }
  setFunnel(v) { this._params.funnel = Array.isArray(v) ? v : [v]; return this; }
  setAffiliate(v) { this._params.affiliate = Array.isArray(v) ? v : [v]; return this; }
  setMarketPlatform(v) { this._params.marketPlatform = Array.isArray(v) ? v : [v]; return this; }
  setLangDetect(v) { this._params.langDetect = Array.isArray(v) ? v : [v]; return this; }
  setNotCountry(v) { this._params.notCountry = v; return this; }
  setAdDetailId(v) { this._params.adDetailId = v; return this; }
  setNeedle(v) { this._params.needle = v && v !== "NA" ? v : ""; return this; }
  setLikes(v) { this._params.likes = Array.isArray(v) ? v : null; return this; }
  setComments(v) { this._params.comments = Array.isArray(v) ? v : null; return this; }
  setDislikes(v) { this._params.dislikes = Array.isArray(v) ? v : null; return this; }
  setViews(v) { this._params.views = Array.isArray(v) ? v : null; return this; }
  setAdBudget(v) { this._params.adBudget = Array.isArray(v) ? v : null; return this; }
  setLastSeen(v) { this._params.lastSeen = v; return this; }
  setPostDate(v) { this._params.postDate = v; return this; }
  setDomainDate(v) { this._params.domainDate = v; return this; }
  setLowerAgeSeen(v) { this._params.lowerAgeSeen = v; return this; }
  setHtmlContent(v) { this._params.htmlContent = v; return this; }

  // ─── Text search (filter context — sort is by recency, not score) ──

  _isExact() {
    return !!this._params.exactSearch;
  }

  /**
   * Keyword box. content_analyzer fields → whole-word matching.
   *   - default          : cross_fields AND (every word present across fields)
   *   - exact / "…"      : match_phrase (consecutive words, in order)
   */
  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    const quoted = String(kw).includes('"');
    const clean = String(kw).replace(/"/g, "").trim();
    if (!clean) return null;
    if (this._isExact() || quoted) {
      return asFilter({ multi_match: { query: clean, type: "phrase", fields: CONTENT_FIELDS } });
    }
    return asFilter({
      multi_match: { query: clean, type: "cross_fields", operator: "and", fields: CONTENT_FIELDS },
    });
  }

  /**
   * Advertiser (post_owner_name — content_analyzer text + .kw).
   *   - default : word match (AND) + phrase-prefix (typeahead)
   *   - exact   : match_phrase
   */
  _getPostOwnerNameEnv() {
    const name = this._params.postOwnerName;
    if (!name) return null;
    const quoted = String(name).includes('"');
    const clean = String(name).replace(/"/g, "").trim();
    if (!clean) return null;
    if (this._isExact() || quoted) {
      return asFilter({ match_phrase: { post_owner_name: clean } });
    }
    return asFilter({
      bool: {
        should: [
          { match: { post_owner_name: { query: clean, operator: "and" } } },
          { match_phrase_prefix: { post_owner_name: clean } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getHtmlContentEnv() {
    const h = this._params.htmlContent;
    if (!h) return null;
    const clean = String(h).replace(/"/g, "").trim();
    if (!clean) return null;
    const exact = this._isExact() || String(h).includes('"');
    return asFilter({
      [exact ? "match_phrase" : "match"]: exact
        ? { html_dc_blackhat_lander_text: clean }
        : { html_dc_blackhat_lander_text: { query: clean, operator: "and" } },
    });
  }

  // ─── Domain / URL ──

  _getUrlEnv() {
    const u = this._params.url;
    if (!u) return null;
    let host;
    try {
      host = new URL(u.startsWith("http") ? u : `http://${u}`).hostname;
    } catch {
      host = String(u).split("/")[0];
    }
    host = String(host || "").replace(/^www\./i, "").toLowerCase().trim();
    if (!host) return null;
    // `domain` is a clean keyword (lowercase_normalizer, 99.99% filled). term =
    // fast exact path; prefix catches "amazon" → amazon.in/amazon.com etc.
    // Deliberately NO leading-wildcard (`*host*`) — on 197M docs it cost ~1.1s
    // vs ~40ms for term+prefix (both use the sorted term dictionary).
    return asFilter({
      bool: {
        should: [
          { term: { domain: host } },
          { prefix: { domain: host } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  // ─── Exact-code filters (keyword + normalizer → term/terms, case-insensitive) ──

  _getCountryEnv()      { const c = this._params.country;      return c && c.length ? asFilter(termFilter("country", c)) : null; }
  _getStateEnv()        { const s = this._params.state;        return s && s.length ? asFilter(termFilter("state", s)) : null; }
  _getCityEnv()         { const c = this._params.city;         return c && c.length ? asFilter(termFilter("city", c)) : null; }
  _getAdCategoryEnv()   { const c = this._params.adCategory;   return c && c.length ? asFilter(termFilter("category", c)) : null; }
  _getSubCategoryEnv()  { const s = this._params.subCategory;  return s && s.length ? asFilter(termFilter("subCategory", s)) : null; }
  _getTypeEnv()         { const t = this._params.type;         return t && t.length ? asFilter(termFilter("type", t)) : null; }
  _getAdPositionEnv()   { const a = this._params.adPosition;   return a && a.length ? asFilter(termFilter("ad_position", a)) : null; }
  _getAdSubPositionEnv(){ const a = this._params.adSubPosition;return a && a.length ? asFilter(termFilter("ad_sub_position", a)) : null; }
  _getTargetKeywordEnv(){ const t = this._params.targetKeyword;return t && t.length ? asFilter(termFilter("target_keyword", t)) : null; }
  _getLangDetectEnv()   { const l = this._params.langDetect;   return l && l.length ? asFilter(termFilter("lang_detect", l)) : null; }
  _getBuiltWithEnv()    { const b = this._params.builtWith;    return b && b.length ? asFilter(termFilter("built_with", b)) : null; }
  _getAffiliateEnv()    { const a = this._params.affiliate;    return a && a.length ? asFilter(termFilter("affiliate_data", a)) : null; }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const filtered = src.filter((s) => s !== "all");
    return filtered.length ? asFilter(termFilter("source", filtered)) : null;
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    return f && f.length ? asFilter(termFilter("built_with_analytics_tracking", f)) : null;
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    // Emergency CPU guard: track used to fan out over the high-cardinality `url`
    // keyword field with a leading wildcard. We now search only the much smaller
    // `domain` field, which still matches tracker/platform domains (e.g. voluum,
    // binom, appsflyer) and keeps the rest of search alive.
    const values = this._safeWildcardValues(t);
    if (!values.length) return null;
    return asFilter({
      bool: { should: values.map((v) => ({ wildcard: { domain: { value: `*${v}*` } } })), minimum_should_match: 1 },
    });
  }

  _getMarketPlatformEnv() {
    const m = this._params.marketPlatform;
    if (!m || !m.length) return null;
    // Emergency CPU guard: the previous query fanned out over 6 URL keyword
    // fields with leading wildcards, killing the ES cluster.
    // We now resolve the platform label to its known domain substring (e.g.
    // "Hubspot" -> "hubs.ly", "Google Marketing Platform" -> "doubleclick")
    // and search only the much smaller `domain` field.
    const values = this._safeWildcardValues(m);
    if (!values.length) return null;
    const patterns = [];
    for (const v of values) {
      const p = MARKET_PLATFORM_DOMAIN_PATTERNS[v] || v.replace(/\s+/g, '');
      if (p && p.length >= 2) patterns.push(p);
    }
    if (!patterns.length) return null;
    return asFilter({
      bool: { should: patterns.map((p) => ({ wildcard: { domain: { value: `*${p}*` } } })), minimum_should_match: 1 },
    });
  }

  /** Sanitise wildcard inputs so one UI selection can't enumerate the whole term dict. */
  _safeWildcardValues(raw) {
    const MAX_VALUES = 10;
    const MIN_LEN = 3;
    const values = (Array.isArray(raw) ? raw : [raw])
      .map((v) => String(v).toLowerCase().trim())
      .filter((v) => v.length >= MIN_LEN)
      .slice(0, MAX_VALUES);
    if (Array.isArray(raw) && raw.length > MAX_VALUES) {
      // eslint-disable-next-line no-console
      console.warn(`[GoogleSearchQueryBuilder] wildcard input truncated from ${raw.length} to ${MAX_VALUES} values`);
    }
    return values;
  }

  // Fields not present on the v2 Google index → no-op (avoid querying unmapped
  // fields, which would zero-out results under dynamic:false). These filters
  // only apply to networks that actually have the data (enforced via SDUI).
  _getCallToActionEnv() { return null; } // no `action` field on google
  _getGenderEnv()       { return null; } // no `gender` field
  _getTagsEnv()         { return null; } // no `tags` field
  _getLowerAgeSeenEnv() { return null; } // no `lower_age_seen` field
  _getLikesEnv()        { return null; }
  _getCommentsEnv()     { return null; }
  _getDislikesEnv()     { return null; }
  _getViewsEnv()        { return null; }
  _getAdBudgetEnv()     { return null; }

  // ─── Date ranges ──

  _getLastSeenEnv() {
    const l = this._params.lastSeen;
    if (!l || !l.lower_date || !l.upper_date) return null;
    return asFilter({ range: { last_seen: { gte: l.lower_date, lte: l.upper_date, format: "yyyy-MM-dd HH:mm:ss" } } });
  }

  _getPostDateEnv() {
    const p = this._params.postDate;
    if (!p || !p.lower_date || !p.upper_date) return null;
    return asFilter({ range: { post_date: { gte: p.lower_date, lte: p.upper_date, format: "yyyy-MM-dd HH:mm:ss" } } });
  }

  _getDomainDateEnv() {
    const d = this._params.domainDate;
    if (!d || !d.lower_date || !d.upper_date) return null;
    return asFilter({ range: { domain_registered_date: { gte: d.lower_date, lte: d.upper_date, format: "yyyy-MM-dd" } } });
  }

  _getNeedleEnv() {
    const n = this._params.needle;
    if (!n) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) return null;
    return asFilter({ range: { last_seen: { lt: n } } });
  }

  // ─── must_not collectors ──

  _getNotCountryClause() {
    const n = this._params.notCountry;
    if (!n) return null;
    return termFilter("country", Array.isArray(n) ? n : [n]);
  }

  _getAdDetailIdExclude() {
    const i = this._params.adDetailId;
    if (!i) return null;
    return { term: { id: parseInt(i, 10) || i } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      "_getCountryEnv", "_getStateEnv", "_getCityEnv",
      "_getTypeEnv", "_getAdPositionEnv", "_getAdSubPositionEnv",
      "_getAdCategoryEnv", "_getSubCategoryEnv", "_getTargetKeywordEnv",
      "_getLangDetectEnv", "_getBuiltWithEnv", "_getSourceEnv", "_getFunnelEnv",
      "_getAffiliateEnv", "_getTrackEnv", "_getMarketPlatformEnv",
      "_getLastSeenEnv", "_getPostDateEnv", "_getDomainDateEnv", "_getNeedleEnv",
      "_getUrlEnv", "_getKeywordEnv", "_getPostOwnerNameEnv", "_getHtmlContentEnv",
    ];
    const out = [];
    for (const g of generators) {
      const env = this[g]();
      if (env) out.push(env);
    }
    return out;
  }

  build() {
    const envelopes = this._collectEnvelopes();
    const buckets = bucketize(envelopes);

    // NAS image filter — IMAGE ads without a valid NAS URL are excluded.
    buckets.must_not.push(IMAGE_MUST_NOT);

    // Exclude ORGANIC SEARCH when no explicit type filter is set (146M of 197M
    // docs are organic — this is the dominant default-search constraint).
    if (!this._params.type || this._params.type.length === 0) {
      buckets.must_not.push({ term: { type: "organic search" } });
    }

    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);
    const adExcl = this._getAdDetailIdExclude();
    if (adExcl) buckets.must_not.push(adExcl);

    // Always have at least a match_all so the must_not constraints still apply
    // on an otherwise-empty search.
    if (!buckets.must.length && !buckets.filter.length) {
      buckets.must.push({ match_all: {} });
    }

    let partBody = flatBool(buckets);

    // IP-based country priority boost (only when no explicit country filter).
    const isPrio =
      this._ipBasedCountry &&
      this._from < 10000 &&
      (!this._params.country || !this._params.country.length);
    if (this._ipBasedCountry) {
      partBody = {
        bool: {
          must: [partBody],
          should: [{ constant_score: { filter: { term: { country: String(this._ipBasedCountry).toLowerCase() } }, boost: 1000000 } }],
          minimum_should_match: 0,
        },
      };
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { id: "desc" }];
    const sort = isPrio ? [{ _score: "desc" }, ...baseSort] : baseSort;

    // `id` is the unique ES _id (reindexed with _id=source.id) → no collapse /
    // cardinality agg needed; hits.total is the exact unique count.
    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: GoogleSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      // Per-request CPU circuit-breaker. Normal searches finish in ms so this never
      // trips and results are unchanged; it only caps a pathological query so one
      // request can't peg the ES CPU indefinitely — ES returns what it found.
      // Tune without redeploy via GOOG_ES_TIMEOUT (e.g. "3s"); default 5s.
      timeout: process.env.GOOG_ES_TIMEOUT || '5s',
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

GoogleSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  "id",
  "ad_id",
  "new_nas_image_url",
  "title",
  "text",
  "newsfeed_description",
  "news_feed_description",
  "post_owner_image",
  "post_owner_name",
  "target_keyword",
  "type",
  "built_with",
  "affiliate_data",
  "built_with_analytics_tracking",
  "first_seen",
  "destination_url",
  "url_destination",
  "url_redirects",
  "source_url",
  "redirect_url",
  "final_url",
  "ad_position",
  "ad_sub_position",
  "country",
  "domain",
  "category",
  "subCategory",
  "days_running",
];

module.exports = GoogleSearchQueryBuilder;
