"use strict";
require("dotenv").config();

/**
 * GoogleSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `google_ads_data` index.
 * Flat field names (no `google_ad.*` prefix) and a NAS image filter
 * implemented as `must_not` (exclude IMAGE without NAS).
 *
 * Optimization summary (see common/helpers/esQueryHelpers.js):
 *   - Flat bool with separate must/filter/must_not.
 *   - Exact-match codes (type, ad_position, ad_sub_position, gender,
 *     ad_language/lang_detect, source, callToAction, builtWith, funnel,
 *     affiliate, country, target_keyword) → match/terms in filter context.
 *   - Keyword/postOwnerName/htmlContent etc → multi_match (phrase) in must.
 *   - "ORGANIC SEARCH" exclusion is now a `term` on `type` rather than a
 *     query_string parse, applied when no type filter is set.
 *   - Optional `profile: true` via setProfile() / ES_PROFILE env.
 */

const {
  flatBool,
  termFilter,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  wrapWithCountryBoost,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require("../../common/helpers/esQueryHelpers");

const DEFAULT_GOOG_INDEX = process.env.GOOG_ELASTIC_INDEX || "google_ads_data";

/**
 * NAS image must_not — IMAGE ads with no/empty new_nas_image_url are
 * excluded (kept identical to the original semantics).
 */
const IMAGE_MUST_NOT = {
  bool: {
    filter: [
      { term: { type: "IMAGE" } },
      {
        bool: {
          should: [
            {
              bool: { must_not: [{ exists: { field: "new_nas_image_url" } }] },
            },
            { term: { "new_nas_image_url.keyword": "" } },
          ],
          minimum_should_match: 1,
        },
      },
    ],
  },
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

  setFrom(v) {
    this._from = parseInt(v, 10) || 0;
    return this;
  }
  setSize(v) {
    this._size = parseInt(v, 10) || 20;
    return this;
  }
  setSortField(f) {
    this._sortField = f;
    return this;
  }
  setSortMethod(v) {
    if (v === "asc" || v === "desc") this._sortMethod = v;
    return this;
  }
  setIpBasedCountry(v) {
    this._ipBasedCountry = v && v !== "NA" ? v : "";
    return this;
  }
  setProfile(v) {
    this._profile = v;
    return this;
  }

  setKeyword(v) {
    this._params.keyword = v;
    return this;
  }
  // Pre-resolved per-word "longest tokens" for the keyword box — each entry is
  // the fully stemmed whole word the index actually stored (resolved upstream
  // via landerTokenResolver against the `text` field's analyzer). When set,
  // these are term/span-matched instead of running the raw keyword back through
  // the field's edge_ngram analyzer. See _getKeywordEnv for the why.
  setKeywordTokens(v) {
    this._params.keywordTokens = Array.isArray(v) ? v.filter(Boolean) : null;
    return this;
  }
  // Frontend "Search Precisely" (payload `exact_search` 0/1). When true, the
  // keyword words must appear adjacent + in order (phrase). When false, every
  // word must merely be present (AND). See _getKeywordEnv.
  setExactSearch(v) {
    this._params.exactSearch = !!v;
    return this;
  }
  setPostOwnerName(v) {
    this._params.postOwnerName = v;
    return this;
  }
  setUrl(v) {
    this._params.url = v;
    return this;
  }
  setCountry(v) {
    this._params.country = Array.isArray(v) ? v : [v];
    return this;
  }
  setState(v) {
    this._params.state = Array.isArray(v) ? v : [v];
    return this;
  }
  setCity(v) {
    this._params.city = Array.isArray(v) ? v : [v];
    return this;
  }
  setCallToAction(v) {
    this._params.callToAction = Array.isArray(v) ? v : [v];
    return this;
  }
  setAdCategory(v) {
    this._params.adCategory = Array.isArray(v) ? v : [v];
    return this;
  }
  setSubCategory(v) {
    this._params.subCategory = Array.isArray(v) ? v : [v];
    return this;
  }
  setAdType(v) {
    this._params.type = Array.isArray(v) ? v : [v];
    return this;
  }
  setAdPosition(v) {
    this._params.adPosition = Array.isArray(v) ? v : [v];
    return this;
  }
  setAdSubPosition(v) {
    this._params.adSubPosition = Array.isArray(v) ? v : [v];
    return this;
  }
  setGender(v) {
    this._params.gender = Array.isArray(v) ? v : [v];
    return this;
  }
  setStatus(v) {
    this._params.status = Array.isArray(v) ? v : [v];
    return this;
  }
  setTargetKeyword(v) {
    this._params.targetKeyword = Array.isArray(v) ? v : [v];
    return this;
  }
  setTags(v) {
    this._params.tags = Array.isArray(v) ? v : [v];
    return this;
  }
  setBuiltWith(v) {
    this._params.builtWith = Array.isArray(v) ? v : [v];
    return this;
  }
  setTrack(v) {
    this._params.track = Array.isArray(v) ? v : [v];
    return this;
  }
  setSource(v) {
    this._params.source = Array.isArray(v) ? v : [v];
    return this;
  }
  setFunnel(v) {
    this._params.funnel = Array.isArray(v) ? v : [v];
    return this;
  }
  setAffiliate(v) {
    this._params.affiliate = Array.isArray(v) ? v : [v];
    return this;
  }
  setMarketPlatform(v) {
    this._params.marketPlatform = Array.isArray(v) ? v : [v];
    return this;
  }
  setLangDetect(v) {
    this._params.langDetect = Array.isArray(v) ? v : [v];
    return this;
  }
  setNotCountry(v) {
    this._params.notCountry = v;
    return this;
  }
  setAdDetailId(v) {
    this._params.adDetailId = v;
    return this;
  }
  setNeedle(v) {
    this._params.needle = v && v !== "NA" ? v : "";
    return this;
  }
  setLikes(v) {
    this._params.likes = Array.isArray(v) ? v : null;
    return this;
  }
  setComments(v) {
    this._params.comments = Array.isArray(v) ? v : null;
    return this;
  }
  setDislikes(v) {
    this._params.dislikes = Array.isArray(v) ? v : null;
    return this;
  }
  setViews(v) {
    this._params.views = Array.isArray(v) ? v : null;
    return this;
  }
  setAdBudget(v) {
    this._params.adBudget = Array.isArray(v) ? v : null;
    return this;
  }
  setLastSeen(v) {
    this._params.lastSeen = v;
    return this;
  }
  setPostDate(v) {
    this._params.postDate = v;
    return this;
  }
  setDomainDate(v) {
    this._params.domainDate = v;
    return this;
  }
  setLowerAgeSeen(v) {
    this._params.lowerAgeSeen = v;
    return this;
  }
  setHtmlContent(v) {
    this._params.htmlContent = v;
    return this;
  }

  // ─── Clause generators ──

  _getKeywordEnv() {
    const fields = [
      "text",
      "title",
      "newsfeed_description",
      "news_feed_description",
    ];
    // target_keyword intentionally excluded: it's the advertiser's bidding
    // keyword (targeting metadata), not ad content. Searching it from the
    // main keyword box surfaces irrelevant ads whose copy doesn't mention
    // the term but whose advertiser bids on it. Filter-style targeting
    // lookup is still available via setTargetKeyword() / _getTargetKeywordEnv.
    //
    // ROOT CAUSE of the relevance bug: `text/title/newsfeed_description` are
    // analyzed with `custom_analyzer`, whose `autocomplete` token-filter is an
    // edge_ngram (min_gram=1, max_gram=20). At search time "hair" expands to
    // Synonym(h, hai, hair) — all at one position — so a phrase/match clause
    // matched ANY doc sharing a leading character ("Hair" search pulled in
    // "Haier" fridges, "HR Solutions", "Hosting", etc.).
    //
    // FIX (query-only, no mapping/reindex — mirrors landerTokenResolver used
    // for built_with/funnel): the controller pre-resolves each query word to
    // the LONGEST token its own analyzer produced (the fully-stemmed whole
    // word, e.g. "solutions" -> "soluti") and passes them via setKeywordTokens.
    // We then term/span-match those exact tokens so ES never re-expands them
    // into the over-matching ngram prefixes.
    const tokens = this._params.keywordTokens;
    if (tokens && tokens.length) {
      // Single word → exact stemmed-token match across the fields.
      if (tokens.length === 1) {
        return asMust({
          bool: {
            should: fields.map((f) => ({ term: { [f]: tokens[0] } })),
            minimum_should_match: 1,
          },
        });
      }
      // "Search Precisely" (exact_search=1): the words must appear as a true
      // consecutive phrase, in order (slop:0). This is what makes precise mode
      // exact — e.g. "car insurance" matches "Car Insurance" but NOT "Care
      // Health Insurance" (stemmed "care"->"car" with a word in between).
      // OR across the fields.
      if (this._params.exactSearch) {
        return asMust({
          bool: {
            should: fields.map((f) => ({
              span_near: {
                clauses: tokens.map((tok) => ({ span_term: { [f]: tok } })),
                slop: 0,
                in_order: true,
              },
            })),
            minimum_should_match: 1,
          },
        });
      }
      // Default: every word must be present (AND), each matched across fields.
      return asMust({
        bool: {
          must: tokens.map((tok) => ({
            bool: {
              should: fields.map((f) => ({ term: { [f]: tok } })),
              minimum_should_match: 1,
            },
          })),
        },
      });
    }

    // Fallback (no pre-resolved tokens): keep the legacy phrase behaviour so any
    // caller that only calls setKeyword() still works. This path still runs
    // through the edge_ngram analyzer and over-matches — the controllers now
    // always resolve tokens, so it's only a safety net.
    const kw = this._params.keyword;
    if (!kw) return null;
    if (kw.includes('"')) {
      return asMust({
        multi_match: { query: kw.replace(/"/g, ""), type: "phrase", fields },
      });
    }
    return asMust(phraseAcrossFields(fields, kw));
  }

  _getPostOwnerNameEnv() {
    const name = this._params.postOwnerName;
    if (!name) return null;
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ""),
          type: "phrase",
          fields: ["post_owner_name"],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(["post_owner_name"], name),
          { prefix: { post_owner_name: name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getHtmlContentEnv() {
    const h = this._params.htmlContent;
    if (!h) return null;
    if (h.includes('"')) {
      return asMust({
        multi_match: {
          query: h.replace(/"/g, ""),
          type: "phrase",
          fields: ["html_dc_blackhat_lander_text"],
        },
      });
    }
    return asMust(phraseAcrossFields(["html_dc_blackhat_lander_text"], h));
  }

  // ─── Filter context ──

  _getUrlEnv() {
    const u = this._params.url;
    if (!u) return null;
    let d;
    try {
      d = new URL(u.startsWith("http") ? u : `http://${u}`).hostname;
    } catch {
      d = u.split("/")[0];
    }
    return asFilter({ wildcard: { destination_url: `*${d}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(["country"], c));
  }

  _getStateEnv() {
    const s = this._params.state;
    if (!s || !s.length) return null;
    return asFilter(multiFieldMatchFilter(["state"], s));
  }

  _getCityEnv() {
    const c = this._params.city;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(["city"], c));
  }

  _getCallToActionEnv() {
    const cta = this._params.callToAction;
    if (!cta || !cta.length) return null;
    return asFilter(matchFilter("action", cta));
  }

  _getAdCategoryEnv() {
    const c = this._params.adCategory;
    if (!c || !c.length) return null;
    return asFilter({
      match: { category: { query: String(c[0]), operator: "and" } },
    });
  }

  _getSubCategoryEnv() {
    const s = this._params.subCategory;
    if (!s || !s.length) return null;
    return asFilter({ match_phrase: { subCategory: s[0] } });
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter("type", t));
  }

  _getAdPositionEnv() {
    const a = this._params.adPosition;
    if (!a || !a.length) return null;
    return asFilter(matchFilter("ad_position", a));
  }

  _getAdSubPositionEnv() {
    const a = this._params.adSubPosition;
    if (!a || !a.length) return null;
    return asFilter(matchFilter("ad_sub_position", a));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter("gender", g));
  }

  _getTargetKeywordEnv() {
    const t = this._params.targetKeyword;
    if (!t || !t.length) return null;
    return asFilter(multiFieldMatchFilter(["target_keyword"], t));
  }

  _getTagsEnv() {
    const t = this._params.tags;
    if (!t || !t.length) return null;
    // Original used a default-field-less query_string with OR — match across
    // a deliberately empty field list isn't a thing; use _all-style multi_match
    // would be wrong. Original behaviour relied on whatever default field ES
    // resolves; here we keep it on `tags` which is what the index actually has.
    return asFilter(matchFilter("tags", t));
  }

  _getLowerAgeSeenEnv() {
    const a = this._params.lowerAgeSeen;
    if (!a || !a.lower_age || !a.upper_age) return null;
    return asFilter({
      range: {
        lower_age_seen: {
          gte: parseInt(a.lower_age, 10),
          lte: parseInt(a.upper_age, 10),
        },
      },
    });
  }

  _getLastSeenEnv() {
    const l = this._params.lastSeen;
    if (!l || !l.lower_date || !l.upper_date) return null;
    return asFilter({
      range: {
        last_seen: {
          gte: l.lower_date,
          lte: l.upper_date,
          format: "yyyy-MM-dd' 'HH:mm:ss",
        },
      },
    });
  }

  _getPostDateEnv() {
    const p = this._params.postDate;
    if (!p || !p.lower_date || !p.upper_date) return null;
    return asFilter({
      range: {
        post_date: {
          gte: p.lower_date,
          lte: p.upper_date,
          format: "yyyy-MM-dd' 'HH:mm:ss",
        },
      },
    });
  }

  _getDomainDateEnv() {
    const d = this._params.domainDate;
    if (!d || !d.lower_date || !d.upper_date) return null;
    return asFilter({
      range: {
        domain_registered_date: {
          gte: d.lower_date,
          lte: d.upper_date,
          format: "yyyy-MM-dd",
        },
      },
    });
  }

  _getNeedleEnv() {
    const n = this._params.needle;
    if (!n) return null;
    if (
      this._ipBasedCountry &&
      this._from < 10000 &&
      (!this._params.country || !this._params.country.length)
    )
      return null;
    return asFilter({ range: { last_seen: { lt: n } } });
  }

  _rangeEnv(field, vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    return asFilter({
      range: {
        [field]: { gte: parseInt(vals[0], 10), lte: parseInt(vals[1], 10) },
      },
    });
  }

  _getLikesEnv() {
    return this._rangeEnv("likes", this._params.likes);
  }
  _getCommentsEnv() {
    return this._rangeEnv("comments", this._params.comments);
  }
  _getDislikesEnv() {
    return this._rangeEnv("dislikes", this._params.dislikes);
  }
  _getViewsEnv() {
    return this._rangeEnv("views", this._params.views);
  }
  _getAdBudgetEnv() {
    return this._rangeEnv("adBudget", this._params.adBudget);
  }

  _getBuiltWithEnv() {
    const b = this._params.builtWith;
    if (!b || !b.length) return null;
    // `built_with` is edge_ngram analyzed; an analyzed `match` collapses the
    // query n-grams and over-matches any shared prefix (e.g. "WooCommerce"
    // matching "Wix"). The controller resolves each value to the exact stemmed
    // token the field indexed (via landerTokenResolver), so we `term`-match it.
    return asFilter(termFilter("built_with", b));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter("url", t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const filtered = src.filter((s) => s !== "all");
    if (filtered.length === 0) return null;
    return asFilter(termFilter("source", filtered));
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    // Same edge_ngram concern as `built_with` — values are resolved to exact
    // stemmed tokens upstream, so `term`-match rather than analyzed `match`.
    return asFilter(termFilter("built_with_analytics_tracking", f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(matchFilter("affiliate_data", a));
  }

  _getMarketPlatformEnv() {
    const m = this._params.marketPlatform;
    if (!m || !m.length) return null;
    const fields = [
      "url_destination",
      "url_redirects",
      "source_url",
      "redirect_url",
      "final_url",
      "destination_url",
    ];
    const should = [];
    for (const v of m) {
      const value = `*${v}*`;
      for (const f of fields) {
        should.push({ wildcard: { [f]: { value } } });
      }
    }
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getLangDetectEnv() {
    const l = this._params.langDetect;
    if (!l || !l.length) return null;
    return asFilter(matchFilter("lang_detect", l));
  }

  // must_not collectors

  _getNotCountryClause() {
    const n = this._params.notCountry;
    if (!n) return null;
    return multiFieldMatchFilter(["country"], n);
  }

  _getAdDetailIdExclude() {
    const i = this._params.adDetailId;
    if (!i) return null;
    return { term: { id: String(i) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      "_getCountryEnv",
      "_getStateEnv",
      "_getCityEnv",
      "_getTypeEnv",
      "_getAdPositionEnv",
      "_getAdSubPositionEnv",
      "_getGenderEnv",
      "_getCallToActionEnv",
      "_getAdCategoryEnv",
      "_getSubCategoryEnv",
      "_getTargetKeywordEnv",
      "_getTagsEnv",
      "_getLangDetectEnv",
      "_getBuiltWithEnv",
      "_getTrackEnv",
      "_getSourceEnv",
      "_getFunnelEnv",
      "_getAffiliateEnv",
      "_getMarketPlatformEnv",
      "_getLowerAgeSeenEnv",
      "_getLastSeenEnv",
      "_getPostDateEnv",
      "_getDomainDateEnv",
      "_getNeedleEnv",
      "_getLikesEnv",
      "_getCommentsEnv",
      "_getDislikesEnv",
      "_getViewsEnv",
      "_getAdBudgetEnv",
      "_getUrlEnv",
      "_getKeywordEnv",
      "_getPostOwnerNameEnv",
      "_getHtmlContentEnv",
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

    // NAS image filter — applied as must_not so non-IMAGE ads pass through
    // and IMAGE ads without a valid NAS URL are excluded.
    buckets.must_not.push(IMAGE_MUST_NOT);

    // Exclude ORGANIC SEARCH when no explicit type filter is set.
    if (!this._params.type || this._params.type.length === 0) {
      buckets.must_not.push({ match_phrase: { type: "ORGANIC SEARCH" } });
    }

    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);
    const adExcl = this._getAdDetailIdExclude();
    if (adExcl) buckets.must_not.push(adExcl);

    // Ensure there's always at least a match_all in must so empty-search
    // requests still produce a valid bool with the must_not constraints.
    if (!buckets.must.length && !buckets.filter.length) {
      buckets.must.push({ match_all: {} });
    }

    let partBody = flatBool(buckets);

    const isPrio =
      this._ipBasedCountry &&
      this._from < 10000 &&
      (!this._params.country || !this._params.country.length);
    if (this._ipBasedCountry) {
      partBody = wrapWithCountryBoost(
        partBody,
        this._ipBasedCountry,
        "country.keyword",
        "country",
        { includeWildcard: false },
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { id: "desc" }];
    const sort = isPrio ? [{ _score: "desc" }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: GoogleSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
      collapse: { field: 'id' },
      aggs: {
        unique_count: { cardinality: { field: 'id', precision_threshold: 1000 } },
      },
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
  "likes",
  "comments",
  "dislikes",
  "views",
  'days_running',
];

module.exports = GoogleSearchQueryBuilder;
