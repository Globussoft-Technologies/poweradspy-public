'use strict';
require('dotenv').config();

/**
 * TiktokSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `tiktok_ads` index.
 *
 * Optimization summary:
 *   - The original `bool { must: [bool { should: filters,
 *     minimum_should_match: filters.length }] }` is just AND-of-filters
 *     with extra wrapping. Replaced with a flat `bool { filter: [...] }`
 *     so ES skips _score and uses the bitset filter cache.
 *   - The keyword search (`*kw*` wildcard fan-out) stays a `bool.should`
 *     of `wildcard` clauses but lives inside `must` so it scores;
 *     advertiser/domain stay as wildcards too.
 *   - Industry/budget/language/country/age/gender are already
 *     `terms`/`term` and now sit cleanly in filter context.
 *   - Date and numeric ranges all in filter.
 *   - Optional `profile: true` via setProfile() / ES_PROFILE env.
 */

const {
  flatBool,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_TT_INDEX = process.env.TT_ELASTIC_INDEX || 'tiktok_ads';

class TiktokSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_TT_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = 'updatedAt';
    this._sortMethod = 'desc';
    this._profile = undefined;
    this._params = {};
  }

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }
  setSortField(f) { this._sortField = f; return this; }
  setSortMethod(v) { if (v === 'asc' || v === 'desc') this._sortMethod = v; return this; }
  setProfile(v) { this._profile = v; return this; }

  setKeyword(v) { this._params.keyword = v; return this; }
  setAdvertiser(v) { this._params.advertiser = v; return this; }
  setDomain(v) { this._params.domain = v; return this; }
  setIndustry(v) { this._params.industry = Array.isArray(v) ? v : [v]; return this; }
  setCountry(v) { this._params.country = Array.isArray(v) ? v : [v]; return this; }
  setGender(v) { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setAge(v) { this._params.age = Array.isArray(v) ? v : [v]; return this; }
  setBudget(v) { this._params.budget = Array.isArray(v) ? v : [v]; return this; }
  setLanguage(v) { this._params.language = Array.isArray(v) ? v : [v]; return this; }
  setLikes(v) { this._params.likes = v; return this; }
  setComments(v) { this._params.comments = v; return this; }
  setShares(v) { this._params.shares = v; return this; }
  setPopularity(v) { this._params.popularity = v; return this; }
  setImpression(v) { this._params.impression = v; return this; }
  setCtr(v) { this._params.ctr = v; return this; }
  setAdSeen(v) { this._params.adSeen = v; return this; }
  setPostDate(v) { this._params.postDate = v; return this; }
  setDomainDate(v) { this._params.domainDate = v; return this; }

  // ─── Clause generators ──

  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    const value = `*${kw.toLowerCase()}*`;
    // Keyword stays in must so its should-of-wildcards contributes to _score.
    return asMust({
      bool: {
        should: [
          { wildcard: { 'ad_title.keyword': { value } } },
          { wildcard: { industry:           { value } } },
          { wildcard: { post_owner:         { value } } },
          { wildcard: { target_keywords:    { value } } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getAdvertiserEnv() {
    const a = this._params.advertiser;
    if (!a) return null;
    return asFilter({ prefix: { post_owner: a.toLowerCase() } });
  }

  _getDomainEnv() {
    const d = this._params.domain;
    if (!d) return null;
    let domain = d.replace(/^(https?:\/\/)?/, '');
    domain = domain.split('/')[0];
    domain = domain.split('.').slice(0, -1).join('.');
    return asFilter({ wildcard: { destination_url: { value: `*${domain}*` } } });
  }

  _getIndustryEnv() {
    const v = this._params.industry;
    if (!v || !v.length) return null;
    return asFilter({ terms: { industry: v } });
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    const should = g.map(x => ({ term: { [`gender.gender_details.${x}`]: '1' } }));
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getAgeEnv() {
    const a = this._params.age;
    if (!a || !a.length) return null;
    const should = a.map(x => {
      if (x === 'Above 55') return { term: { 'age.age_details.55+': '1' } };
      return { term: { [`age.age_details.${x}`]: '1' } };
    });
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getBudgetEnv() {
    const b = this._params.budget;
    if (!b || !b.length) return null;
    return asFilter({ terms: { budget: b } });
  }

  _getLanguageEnv() {
    const l = this._params.language;
    if (!l || !l.length) return null;
    return asFilter({ terms: { language: l } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter({ terms: { countries: c } });
  }

  _rangeEnv(field, range, defaults) {
    if (!range) return null;
    return asFilter({
      range: {
        [field]: {
          gte: range.min ?? defaults[0],
          lte: range.max ?? defaults[1],
        },
      },
    });
  }

  _getLikesEnv()      { return this._rangeEnv('likes',      this._params.likes,      [0, 10000000]); }
  _getCommentsEnv()   { return this._rangeEnv('comments',   this._params.comments,   [0, 1000000]); }
  _getSharesEnv()     { return this._rangeEnv('shares',     this._params.shares,     [0, 1000000]); }
  _getPopularityEnv() { return this._rangeEnv('popularity', this._params.popularity, [0, 100]); }
  _getImpressionEnv() { return this._rangeEnv('impression', this._params.impression, [0, 10000000]); }

  _getCtrEnv() {
    const c = this._params.ctr;
    if (!c) return null;
    return asFilter({
      range: {
        ctr: {
          gte: (c.min ?? 0) / 100,
          lte: c.max ? c.max / 100 : 100000000,
        },
      },
    });
  }

  _dateRangeEnv(field, r) {
    if (!r || !r.startDate || !r.endDate) return null;
    return asFilter({
      range: { [field]: { gte: r.startDate, lte: r.endDate, format: 'strict_date_optional_time' } },
    });
  }

  _getAdSeenEnv()     { return this._dateRangeEnv('last_seen',              this._params.adSeen); }
  _getPostDateEnv()   { return this._dateRangeEnv('first_seen',             this._params.postDate); }
  _getDomainDateEnv() { return this._dateRangeEnv('domain_registered_date', this._params.domainDate); }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getAdvertiserEnv', '_getDomainEnv',
      '_getIndustryEnv', '_getGenderEnv', '_getAgeEnv',
      '_getBudgetEnv', '_getLanguageEnv', '_getCountryEnv',
      '_getLikesEnv', '_getCommentsEnv', '_getSharesEnv',
      '_getPopularityEnv', '_getImpressionEnv', '_getCtrEnv',
      '_getAdSeenEnv', '_getPostDateEnv', '_getDomainDateEnv',
      '_getKeywordEnv',
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

    // Ensure non-empty bool — match_all guarantees something to score
    // against when no filter or text query is provided.
    if (!buckets.must.length && !buckets.filter.length) {
      buckets.must.push({ match_all: {} });
    }

    // Displayable-media gate. The UI hides a TikTok ad if EITHER its thumbnail
    // (`video_cover`) OR its video (`video_url`) is a legacy pasvideos/pasimages/
    // bydefault path — so existence alone isn't enough (both fields can hold a
    // blocked value). Require video_cover to exist and exclude blocked values on
    // both fields, mirroring the frontend regex. Applies to the returned hits and
    // the `total_ads` cardinality count alike.
    buckets.filter.push({
      bool: {
        filter: [{ exists: { field: 'video_cover' } }],
        must_not: [
          { wildcard: { "video_cover.keyword": { value: '*pasvideo*' } } },
          { wildcard: { "video_cover.keyword": { value: '*pasimage*' } } },
          { wildcard: { "video_cover.keyword": { value: '*bydefault*' } } },
          { wildcard: { video_url: { value: '*pasvideo*' } } },
          { wildcard: { video_url: { value: '*pasimage*' } } },
          { wildcard: { video_url: { value: '*bydefault*' } } },
        ],
      },
    });

    // Popularity sort = "show ads ranked by popularity score, highest first".
    // Require the field to exist so score-less docs (which would otherwise sort
    // to the bottom) are excluded entirely. A popularity range filter already
    // implies this, so the two compose cleanly.
    if (this._sortField === 'popularity') {
      buckets.filter.push({ exists: { field: 'popularity' } });
    }

    const partBody = flatBool(buckets);

    const body = {
      query: partBody,
      from: this._from,
      size: this._size,
      sort: [{ [this._sortField]: { order: this._sortMethod } }],
      _source: TiktokSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      track_total_hits: true,
      aggs: { total_ads: { cardinality: { field: 'sql_id' } } },
      collapse: { field: 'sql_id' },
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

TiktokSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'sql_id', 'likes', 'comments', 'shares', 'ctr', 'popularity',
  'impression', 'ad_title', 'video_url', 'video_cover',
  'post_owner_id', 'library_url', 'industry',
  'post_owner', 'first_seen', 'last_seen', 'budget', 'days_running', 'language',
];

module.exports = TiktokSearchQueryBuilder;
