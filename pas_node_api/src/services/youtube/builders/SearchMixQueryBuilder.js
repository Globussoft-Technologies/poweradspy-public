'use strict';

/**
 * SearchMixQueryBuilder for YouTube
 *
 * Index: `youtube_ads_data`. Field names are FLAT (no `youtube_ad.*`
 * prefix). NAS image filter is implemented as `must_not`.
 *
 * Optimization summary (see common/helpers/esQueryHelpers.js for shared
 * helpers):
 *   - Flat bool with separate must/filter/must_not.
 *   - Exact-match codes (ad_type, ad_position, status, gender, source,
 *     funnel, affiliate_networks, ad_language, callToAction,
 *     built_with_ecommerce_platform, country) → match/term in filter.
 *   - status (numeric) goes through `terms` since values are integers.
 *   - Keyword/postOwnerName/OCR/celebrity/imageObject/logo → multi_match
 *     phrase queries in must.
 *   - Optional `profile: true`.
 */

const { youtube: ytNet } = require('../../../config/networks');
const {
  flatBool,
  termFilter,
  termFilterCI,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  wrapWithCountryBoost,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
  wrapIfNeed,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_YT_INDEX = ytNet?.database?.elastic?.index || process.env.YT_ELASTIC_INDEX || 'youtube_ads_data';

// Displayable-media gate — mirrors the UI's blocked-media filter so hits.total
// equals what actually renders. Two branches:
//   • VIDEO / DISCOVERY → must have a real thumbnail_url (not a placeholder/
//     legacy pasimages/pasvideos/bydefault path the UI hides). YouTube stores
//     the bad ones IN thumbnail_url, so we exclude by value.
//   • everything else (IMAGE, DISPLAY, …) → must have a real new_nas_image_url.
//     DISPLAY ads that were never NAS-migrated have new_nas_image_url=null and
//     only a pasimages SQL path (invisible to ES) the UI hides — requiring the
//     field here drops them from the count. Good IMAGE ads carry a NAS path
//     (…/yt/adImage/…) that isn't a blocked pattern, so they stay.
const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { terms: { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
              { exists: { field: 'thumbnail_url' } },
            ],
            must_not: [
              { wildcard: { "thumbnail_url.keyword": { value: '*pasvideo*' } } },
              { wildcard: { "thumbnail_url.keyword": { value: '*pasimage*' } } },
              { wildcard: { "thumbnail_url.keyword": { value: '*bydefault*' } } },
              { wildcard: { "thumbnail_url.keyword": { value: '*DefaultImage*' } } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { exists: { field: 'new_nas_image_url' } },
            ],
            must_not: [
              { terms: { 'ad_type.keyword': ['VIDEO', 'DISCOVERY'] } },
              { wildcard: { "new_nas_image_url.keyword": { value: '*pasvideo*' } } },
              { wildcard: { "new_nas_image_url.keyword": { value: '*pasimage*' } } },
              { wildcard: { "new_nas_image_url.keyword": { value: '*bydefault*' } } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

class SearchMixQueryBuilder {
  constructor(indexName) {
    this._indexName   = indexName || DEFAULT_YT_INDEX;
    this._from        = 0;
    this._size        = 20;
    this._sortField   = 'last_seen';
    this._sortMethod  = 'desc';
    this._ipBasedCountry = '';
    this._profile     = undefined;
    this._params      = {};
  }

  setFrom(v)   { this._from  = parseInt(v, 10) || 0;  return this; }
  setSize(v)   { this._size  = parseInt(v, 10) || 20; return this; }
  setSortField(field) { this._sortField  = field; return this; }
  setSortMethod(v)    { if (v === 'asc' || v === 'desc') this._sortMethod = v; return this; }
  setIpBasedCountry(v) { this._ipBasedCountry = (v && v !== 'NA') ? v : ''; return this; }
  setProfile(v) { this._profile = v; return this; }

  setKeyword(v)          { this._params.keyword       = v;                               return this; }
  setPostOwnerName(v)    { this._params.postOwnerName = v;                               return this; }
  setUrl(v)              { this._params.url           = v;                               return this; }
  setCountry(v)          { this._params.country       = Array.isArray(v) ? v : [v];     return this; }
  setAdType(v)           { this._params.type          = Array.isArray(v) ? v : [v];     return this; }
  setAdPosition(v)       { this._params.adPosition    = Array.isArray(v) ? v : [v];     return this; }
  setStatus(v)           { this._params.status        = Array.isArray(v) ? v : [v];     return this; }
  setCallToAction(v)     { this._params.callToAction  = Array.isArray(v) ? v : [v];     return this; }
  setAdCategory(v)       { this._params.adCategory    = Array.isArray(v) ? v : [v];     return this; }
  setSubCategory(v)      { this._params.subCategory   = Array.isArray(v) ? v : [v];     return this; }
  setTags(v)             { this._params.tags          = Array.isArray(v) ? v : [v];     return this; }
  setBuiltWith(v)        { this._params.builtWith     = Array.isArray(v) ? v : [v];     return this; }
  setSource(v)           { this._params.source        = Array.isArray(v) ? v : [v];     return this; }
  setFunnel(v)           { this._params.funnel        = Array.isArray(v) ? v : [v];     return this; }
  setAffiliate(v)        { this._params.affiliate     = Array.isArray(v) ? v : [v];     return this; }
  setMarketPlatform(v)   { this._params.marketPlatform = Array.isArray(v) ? v : [v];   return this; }
  setLangDetect(v)       { this._params.langDetect    = Array.isArray(v) ? v : [v];     return this; }
  setVerified(v)         { this._params.verified      = v;                               return this; }
  setDiscovererUserId(v) { this._params.discovererUserId = v;                            return this; }
  setNotCountry(v)       { this._params.notCountry    = v;                               return this; }
  setAdDetailId(v)       { this._params.adDetailId    = v;                               return this; }
  setNeedle(v)           { this._params.needle        = (v && v !== 'NA') ? v : '';     return this; }
  setOcr(v)              { this._params.ocr           = v;                               return this; }
  setCelebrity(v)        { this._params.celebrity     = Array.isArray(v) ? v : [v];     return this; }
  setImageObject(v)      { this._params.imageObject   = Array.isArray(v) ? v : [v];     return this; }
  setLogo(v)             { this._params.logo          = Array.isArray(v) ? v : [v];     return this; }

  setLikes(v)       { this._params.likes    = Array.isArray(v) ? v : null; return this; }
  setComments(v)    { this._params.comments = Array.isArray(v) ? v : null; return this; }
  setViews(v)       { this._params.views    = Array.isArray(v) ? v : null; return this; }
  setDislikes(v)    { this._params.dislikes = Array.isArray(v) ? v : null; return this; }
  setAdBudget(v)    { this._params.adBudget = Array.isArray(v) ? v : null; return this; }

  setLastSeen(v)    { this._params.lastSeen  = v; return this; }
  setPostDate(v)    { this._params.postDate  = v; return this; }
  setDomainDate(v)  { this._params.domainDate = v; return this; }

  setLowerAgeSeen(v) { this._params.lowerAgeSeen = v; return this; }

  // ─── must (relevance) ──

  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    const fields = ['ad_title', 'ad_text', 'newsfeed_description'];
    if (kw.includes('"')) {
      return asMust({ multi_match: { query: kw.replace(/"/g, ''), type: 'phrase', fields } });
    }
    return asMust(phraseAcrossFields(fields, kw));
  }

  _getPostOwnerNameEnv() {
    const name = this._params.postOwnerName;
    if (!name) return null;
    if (name.includes('"')) {
      return asMust({
        multi_match: { query: name.replace(/"/g, ''), type: 'phrase', fields: ['post_owner'] },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(['post_owner'], name),
          { prefix: { post_owner: name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    if (ocr.includes('"')) {
      return asMust({ multi_match: { query: ocr.replace(/"/g, ''), type: 'phrase', fields: ['image_ocr'] } });
    }
    return asMust(phraseAcrossFields(['image_ocr'], ocr));
  }

  _getCelebrityEnv() {
    const v = this._params.celebrity;
    if (!v || !v.length) return null;
    return asMust(multiFieldMatchFilter(['image_celebrity'], v));
  }

  _getImageObjectEnv() {
    const v = this._params.imageObject;
    if (!v || !v.length) return null;
    return asMust(multiFieldMatchFilter(['image_object'], v));
  }

  _getLogoEnv() {
    const v = this._params.logo;
    if (!v || !v.length) return null;
    return asMust(multiFieldMatchFilter(['image_brand'], v));
  }

  // ─── filter context ──

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; }
    catch { domain = url.split('/')[0]; }
    return asFilter({ wildcard: { ad_url: `*${domain}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['countries'], c));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('ad_type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length || ap.length === 4) return null;
    return asFilter(matchFilter('ad_position', ap));
  }

  _getStatusEnv() {
    const s = this._params.status;
    if (!s || !s.length) return null;
    return asFilter({ terms: { status: s.map(v => parseInt(v, 10)) } });
  }

  _getCallToActionEnv() {
    const cta = this._params.callToAction;
    if (!cta || !cta.length) return null;
    // Exact match on the keyword sub-field: CTA is a categorical value, so a
    // single-token value like "Buy" must not match "Buy Tickets" via the
    // analyzed text field (which `matchFilter` would do).
    return asFilter(termFilterCI('call_to_action.keyword', cta));
  }

  _getVerifiedEnv() {
    const v = this._params.verified;
    if (v === '' || v === undefined || v === null || v === 'NA') return null;
    return asFilter({ term: { verified: v } });
  }

  _getDiscovererUserIdEnv() {
    const d = this._params.discovererUserId;
    if (!d) return null;
    return asFilter({ term: { discoverer_user_id: d } });
  }

  _getLowerAgeSeenEnv() {
    const age = this._params.lowerAgeSeen;
    if (!age || !age.lower_age || !age.upper_age) return null;
    return asFilter({ range: { lower_age_seen: { gte: parseInt(age.lower_age, 10), lte: parseInt(age.upper_age, 10) } } });
  }

  _getLastSeenEnv() {
    const ls = this._params.lastSeen;
    if (!ls || !ls.lower_date || !ls.upper_date) return null;
    return asFilter({ range: { last_seen: { gte: ls.lower_date, lte: ls.upper_date, format: 'epoch_second' } } });
  }

  _getPostDateEnv() {
    const pd = this._params.postDate;
    if (!pd || !pd.lower_date || !pd.upper_date) return null;
    return asFilter({ range: { post_date: { gte: pd.lower_date, lte: pd.upper_date, format: 'epoch_second' } } });
  }

  _getDomainDateEnv() {
    const dd = this._params.domainDate;
    if (!dd || !dd.lower_date || !dd.upper_date) return null;
    return asFilter({ range: { domain_registration_date: { gte: dd.lower_date, lte: dd.upper_date, format: 'epoch_second' } } });
  }

  _getNeedleEnv() {
    const needle = this._params.needle;
    if (!needle) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) return null;
    return asFilter({ range: { last_seen: { lt: needle } } });
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('youtube.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('youtube.subCategory.keyword', sub));
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(matchFilter('ecommerce_platform', bw));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const sources = [];
    for (const s of src) {
      if (s === 'all') {
        sources.push('desktop', 'ios', 'android');
      } else if (s) {
        sources.push(s);
      }
    }
    const unique = [...new Set(sources)];
    if (!unique.length) return null;
    if (unique.length === 3) return null;
    return asFilter(matchFilter('source', unique));
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('funnel', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(matchFilter('affiliate_networks', a));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    const should = mp.map(v => ({ wildcard: { redirect_urls: { value: `*${v}*` } } }));
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('ad_language', ld));
  }

  _rangeEnv(field, vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    return asFilter({ range: { [field]: { gte: parseInt(vals[0], 10), lte: parseInt(vals[1], 10) } } });
  }

  _getLikesEnv()    { return this._rangeEnv('reactions.likes', this._params.likes); }
  _getCommentsEnv() { return this._rangeEnv('comments', this._params.comments); }
  _getViewsEnv()    { return this._rangeEnv('views',    this._params.views); }
  _getDislikesEnv() { return this._rangeEnv('youtube_ad.dislikes', this._params.dislikes); }
  _getAdBudgetEnv() { return this._rangeEnv('youtube.averageBudget', this._params.adBudget); }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(['countries'], nc);
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { id: String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getStatusEnv',
      '_getCallToActionEnv', '_getVerifiedEnv', '_getDiscovererUserIdEnv',
      '_getAdCategoryEnv', '_getSubCategoryEnv',
      '_getLangDetectEnv',
      '_getBuiltWithEnv', '_getSourceEnv', '_getFunnelEnv',
      '_getAffiliateEnv', '_getMarketPlatformEnv',
      '_getLowerAgeSeenEnv', '_getLastSeenEnv', '_getPostDateEnv',
      '_getDomainDateEnv', '_getNeedleEnv',
      '_getLikesEnv', '_getCommentsEnv', '_getViewsEnv', '_getDislikesEnv', '_getAdBudgetEnv',
      '_getUrlEnv',
      '_getKeywordEnv', '_getPostOwnerNameEnv',
      '_getOcrEnv', '_getCelebrityEnv', '_getImageObjectEnv', '_getLogoEnv',
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

    // Exclude ads with empty ad_type (invalid YouTube ads)
    buckets.must_not.push({ term: { 'ad_type.keyword': '' } });

    // DISPLAY-type YouTube ads are surfaced under GDN, not YouTube — hide them
    // here so they never appear in YouTube results. They are merged back into the
    // GDN listing by gdn/helpers/youtubeDisplayMerge.js.
    buckets.must_not.push({ term: { 'ad_type.keyword': 'DISPLAY' } });

    // Displayable-media gate (see EXTRA_CONDITION above).
    buckets.filter.push(...EXTRA_CONDITION);

    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);
    const adExcl = this._getAdDetailIdExclude();
    if (adExcl) buckets.must_not.push(adExcl);

    if (!buckets.must.length && !buckets.filter.length) {
      buckets.must.push({ match_all: {} });
    }

    let partBody = flatBool(buckets);

    const isPriorityOffset = (
      this._ipBasedCountry &&
      this._from < 10000 &&
      (!this._params.country || !this._params.country.length)
    );

    if (this._ipBasedCountry) {
      partBody = wrapWithCountryBoost(
        partBody,
        this._ipBasedCountry,
        'countries.keyword',
        'countries',
        { includeWildcard: true }
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { ad_id: 'desc' }];
    const sort = isPriorityOffset ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: SearchMixQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

SearchMixQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'ad_id',
  'ad_type',
  'ad_language',
  'reactions',
  'dislikes',
  'comments',
  'views',
  'verified',
  'countries',
  'duration',
  'call_to_action',
  'text_image_title',
  'youtube.lowerBudget',
  'youtube.upperBudget',
  'youtube.averageBudget',
  'new_nas_image_url',
  'nas_video_url',
  'thumbnail_url',
  'redirect_urls',
];

module.exports = SearchMixQueryBuilder;
