'use strict';
require("dotenv").config();

/**
 * SearchMixQueryBuilder (Facebook)
 *
 * Builds Elasticsearch queries against the `search_mix` index.
 *
 * Optimization pass:
 *   - Flattened the recursive `bool -> must -> filter -> must -> filter`
 *     pattern into a single `bool { must, filter, must_not }` per request.
 *   - Moved every non-scoring clause (term/terms/range/exists, exact-match
 *     code lookups) into `filter` context so ES can cache the result and
 *     skip _score computation.
 *   - Replaced `query_string` for exact-match code fields (type, adPosition,
 *     gender, langDetect, source, callToAction, builtWith, funnel,
 *     affiliate, track, verified, platform) with `term`/`terms`/`match`.
 *   - Replaced `query_string + relativeWords` for country/state/city with
 *     `multi_match { operator: 'and' }` per value, OR'd via `bool.should`.
 *   - Keyword/postOwnerName/OCR/etc. (full-text relevance) stay in `must`
 *     and are emitted as `multi_match { type: 'phrase' }` (or per-word
 *     phrase AND when input has no quotes), avoiding the QueryString
 *     parser entirely.
 *   - Optional `profile: true` via `setProfile(true)` or `ES_PROFILE=true`
 *     env var (suppressed in production).
 *
 * The public surface of this class is unchanged — every setter and the
 * shape returned by `build()` are preserved.
 */

const { facebook: fbNet } = require('../../../config/networks');
const {
  relativeWords,
  wrapIfNeed,
  flatBool,
  termFilter,
  termFilterCI,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  wrapWithCountryBoost,
  asFilter,
  asMust,
  asMustNot,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_FB_INDEX = fbNet?.database?.elastic?.index || process.env.FB_ELASTIC_INDEX || 'search_mix';

/**
 * NAS media filter — IMAGE ads must have new_nas_image_url, VIDEO ads must
 * have Thumbnail. Lives in filter context so ES caches the bool result.
 */
const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term:   { 'facebook_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term:   { 'facebook_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'Thumbnail' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'facebook_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
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
    this._indexName = indexName || DEFAULT_FB_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = 'facebook_ad.last_seen';
    this._sortMethod = 'desc';
    this._ipBasedCountry = '';
    this._profile = undefined;
    this._params = {};
  }

  // ─── Pagination & sorting ────────────────────────────

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }

  setSortField(field) {
    if (field === 'all') {
      this._sortField = [
        { 'facebook_ad_meta_data.firstSeenOnDesktop': { order: 'desc' } },
        { 'facebook_ad_meta_data.firstSeenOnAndroid': { order: 'desc' } },
        { 'facebook_ad_meta_data.firstSeenOnIos': { order: 'desc' } },
      ];
    } else {
      this._sortField = field;
    }
    return this;
  }

  setSortMethod(v) {
    if (v === 'asc' || v === 'desc') this._sortMethod = v;
    return this;
  }

  setIpBasedCountry(v) { this._ipBasedCountry = (v && v !== 'NA') ? v : ''; return this; }

  /**
   * Enable Elasticsearch query profiling. Useful in development to inspect
   * which leaf queries dominate latency. Always disabled in production
   * regardless of the flag, because `profile: true` adds significant
   * overhead per query.
   */
  setProfile(v) { this._profile = v; return this; }

  // ─── Search parameter setters ─────────────────────────

  setKeyword(v)            { this._params.keyword = v; return this; }
  setPostOwnerName(v)      { this._params.postOwnerName = v; return this; }
  setUrl(v)                { this._params.url = v; return this; }
  setDomainMatchedIds(v)   { this._params.domainMatchedIds = Array.isArray(v) ? v : [v]; return this; }
  setCountry(v)            { this._params.country = Array.isArray(v) ? v : [v]; return this; }
  setState(v)              { this._params.state = Array.isArray(v) ? v : [v]; return this; }
  setCity(v)               { this._params.city = Array.isArray(v) ? v : [v]; return this; }
  setCallToAction(v)       { this._params.callToAction = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v)         { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v)        { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v)             { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v)         { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setGender(v)             { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v)             { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTags(v)               { this._params.tags = Array.isArray(v) ? v : [v]; return this; }
  setBuiltWith(v)          { this._params.builtWith = Array.isArray(v) ? v : [v]; return this; }
  setTrack(v)              { this._params.track = Array.isArray(v) ? v : [v]; return this; }
  setSource(v)             { this._params.source = Array.isArray(v) ? v : [v]; return this; }
  setFunnel(v)             { this._params.funnel = Array.isArray(v) ? v : [v]; return this; }
  setAffiliate(v)          { this._params.affiliate = Array.isArray(v) ? v : [v]; return this; }
  setMarketPlatform(v)     { this._params.marketPlatform = Array.isArray(v) ? v : [v]; return this; }
  setLangDetect(v)         { this._params.langDetect = Array.isArray(v) ? v : [v]; return this; }
  setVerified(v)           { this._params.verified = v; return this; }
  setDiscovererUserId(v)   { this._params.discovererUserId = v; return this; }
  setNotCountry(v)         { this._params.notCountry = v; return this; }
  setAdDetailId(v)         { this._params.adDetailId = v; return this; }
  setMetaFilter(v)         { this._params.metaFilter = v ? 15 : null; return this; }
  setPlatform(v)           { this._params.platform = Array.isArray(v) ? v : [v]; return this; }

  // Range-based setters
  setNeedle(v)             { this._params.needle = (v && v !== 'NA') ? v : ''; return this; }
  setLikes(v)              { this._params.likes = Array.isArray(v) ? v : null; return this; }
  setComments(v)           { this._params.comments = Array.isArray(v) ? v : null; return this; }
  setShares(v)             { this._params.shares = Array.isArray(v) ? v : null; return this; }
  setImpressions(v)        { this._params.impressions = Array.isArray(v) ? v : null; return this; }
  setPopularity(v)         { this._params.popularity = Array.isArray(v) ? v : null; return this; }
  setAdBudget(v)           { this._params.adBudget = Array.isArray(v) ? v : null; return this; }

  // Date range setters
  setLastSeen(v)           { this._params.lastSeen = v; return this; }
  setPostDate(v)           { this._params.postDate = v; return this; }
  setPageCreation(v)       { this._params.pageCreation = v; return this; }
  setDomainDate(v)         { this._params.domainDate = v; return this; }

  setLowerAgeSeen(v)       { this._params.lowerAgeSeen = v; return this; }

  // Text search fields (relevance — go in `must`)
  setOcr(v)                { this._params.ocr = v; return this; }
  setCelebrity(v)          { this._params.celebrity = Array.isArray(v) ? v : [v]; return this; }
  setImageObject(v)        { this._params.imageObject = Array.isArray(v) ? v : [v]; return this; }
  setLogo(v)               { this._params.logo = Array.isArray(v) ? v : [v]; return this; }
  setMixdata(v)            { this._params.mixdata = v; return this; }
  setHtmlContent(v)        { this._params.htmlContent = v; return this; }
  setHtml(v)               { this._params.html = v; return this; }
  setCommentdata(v)        { this._params.commentdata = v; return this; }

  // ─── Clause generators (return `{ ctx, clause }` envelopes) ──

  // Full-text relevance — must context

  _kwFields() {
    return [
      'facebook_ad_variants.title',
      'facebook_ad_variants.text',
      'facebook_ad_variants.newsfeed_description',
      'facebook_ad_variants.title_exactly',
      'facebook_ad_variants.text_exactly',
      'facebook_ad_variants.newsfeed_description_exactly',
      'facebook_translation.ad_text',
      'facebook_translation.news_feed_description',
      'facebook_translation.ad_title',
      'facebook_translations.ar.title',
      'facebook_translations.ar.text',
      'facebook_translations.ar.newsfeed_description',
    ];
  }

  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    return asMust(phraseAcrossFields(this._kwFields(), kw));
  }

  _getPostOwnerNameEnv() {
    const name = this._params.postOwnerName;
    if (!name) return null;
    const fields = [
      'facebook_ad_post_owners.post_owner_name',
      'facebook_ad_post_owners.post_owner_name_ru',
      'facebook_ad_post_owners.post_owner_name_fr',
      'facebook_ad_post_owners.post_owner_name_sp',
      'facebook_ad_post_owners.post_owner_name_ge',
      'facebook_ad_post_owners.post_owner_name_exactly',
    ];
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['facebook_ad_post_owners.post_owner_name_exactly'],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, name),
          { prefix: { 'facebook_ad_post_owners.post_owner_name': name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    const fields = [
      'facebook_ad_variants.image_ocr',
      'facebook_ad_variants.image_ocr_ru',
      'facebook_ad_variants.image_ocr_fr',
      'facebook_ad_variants.image_ocr_sp',
    ];
    if (ocr.includes('"')) {
      return asMust({
        multi_match: {
          query: ocr.replace(/"/g, ''),
          type: 'phrase',
          fields: ['facebook_ad_variants.image_ocr', 'facebook_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, ocr));
  }

  _getMixdataEnv() {
    const md = this._params.mixdata;
    if (!md) return null;
    if (md.includes('"')) {
      return asMust({
        multi_match: { query: md.replace(/"/g, ''), type: 'phrase', fields: ['mixdata'] },
      });
    }
    return asMust(phraseAcrossFields(['mixdata'], md));
  }

  _getHtmlEnv() {
    const h = this._params.html;
    if (!h) return null;
    if (h.includes('"')) {
      return asMust({
        multi_match: { query: h.replace(/"/g, ''), type: 'phrase', fields: ['html'] },
      });
    }
    return asMust(phraseAcrossFields(['html'], h));
  }

  _getCommentdataEnv() {
    const cd = this._params.commentdata;
    if (!cd) return null;
    if (cd.includes('"')) {
      return asMust({
        multi_match: {
          query: cd.replace(/"/g, ''),
          type: 'phrase',
          fields: ['facebook_comments.comment_data'],
        },
      });
    }
    return asMust(phraseAcrossFields(
      ['facebook_comments.comment_data', 'comment_data'], cd
    ));
  }

  _imageArrayEnv(fieldBase, vals) {
    if (!vals || !vals.length) return null;
    const fields = [
      `facebook_ad_variants.${fieldBase}`,
      `facebook_ad_variants.${fieldBase}_ru`,
      `facebook_ad_variants.${fieldBase}_fr`,
      `facebook_ad_variants.${fieldBase}_sp`,
    ];
    return asMust(multiFieldMatchFilter(fields, vals));
  }

  _getCelebrityEnv()   { return this._imageArrayEnv('image_celebrity', this._params.celebrity); }
  _getImageObjectEnv() { return this._imageArrayEnv('image_object', this._params.imageObject); }
  _getLogoEnv()        { return this._imageArrayEnv('image_brand_logo', this._params.logo); }

  _getHtmlContentEnv() {
    const hc = this._params.htmlContent;
    if (!hc) return null;
    const fields = [
      'facebook_ad_html_lander_content.html_whitehat_lander_text',
      'facebook_ad_html_lander_content.html_res_blackhat_lander_text',
      'facebook_ad_html_lander_content.html_dc_blackhat_lander_text',
      'facebook_ad_outgoing_links.html_content_final_url',
    ];
    if (hc.includes('"')) {
      return asMust({
        multi_match: { query: hc.replace(/"/g, ''), type: 'phrase', fields },
      });
    }
    // Original used `query: '*hc*'` query_string. Leading-wildcard substring
    // search on analyzed text is functionally identical to a phrase match
    // for single-token inputs, and a per-word AND-of-phrases for
    // multi-token inputs — both of which are far cheaper than the
    // wildcard scan.
    return asMust(phraseAcrossFields(fields, hc));
  }

  // Filter context — exact-match codes & ranges

  _getDomainMatchedIdsEnv() {
    const ids = this._params.domainMatchedIds;
    if (!ids || !ids.length) return null;
    return asFilter({ terms: { 'facebook_ad.id': ids } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['country_only.country'], c));
  }

  _getStateEnv() {
    const s = this._params.state;
    if (!s || !s.length) return null;
    return asFilter(multiFieldMatchFilter(['states'], s));
  }

  _getCityEnv() {
    const c = this._params.city;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['city'], c));
  }

  _getCallToActionEnv() {
    const cta = this._params.callToAction;
    if (!cta || !cta.length) return null;
    // Exact match on the keyword sub-field: CTA is a categorical value, so a
    // single-token value like "Buy" must not match "Buy Tickets" via the
    // analyzed text field (which `matchFilter` would do).
    return asFilter(termFilterCI('facebook_call_to_actions.action.keyword', cta));
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('facebook.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('facebook.subCategory.keyword', sub));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    // type values are uppercase tokens (IMAGE, VIDEO, …) — `match`
    // applies the field analyzer so we don't depend on a `.keyword`
    // sub-field.
    return asFilter(matchFilter('facebook_ad.type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length || ap.length === 4) return null; // 4 = all positions, skip
    return asFilter(matchFilter('facebook_ad.ad_position', ap));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('facebook_users.Gender', g));
  }

  _getLowerAgeSeenEnv() {
    const age = this._params.lowerAgeSeen;
    if (!age || !age.lower_age || !age.upper_age) return null;
    return asFilter({
      range: {
        'facebook_ad.lower_age_seen': {
          gte: parseInt(age.lower_age, 10),
          lte: parseInt(age.upper_age, 10),
        },
      },
    });
  }

  _getLastSeenEnv() {
    const ls = this._params.lastSeen;
    if (!ls || !ls.lower_date || !ls.upper_date) return null;
    return asFilter({
      range: {
        'facebook_ad.last_seen': {
          gte: ls.lower_date, lte: ls.upper_date,
          format: "yyyy-MM-dd' 'HH:mm:ss",
        },
      },
    });
  }

  _getPostDateEnv() {
    const pd = this._params.postDate;
    if (!pd || !pd.lower_date || !pd.upper_date) return null;
    return asFilter({
      range: {
        'facebook_ad.post_date': {
          gte: pd.lower_date, lte: pd.upper_date,
          format: "yyyy-MM-dd' 'HH:mm:ss",
        },
      },
    });
  }

  _getPageCreationEnv() {
    const pc = this._params.pageCreation;
    if (!pc || !pc.lower_date || !pc.upper_date) return null;
    return asFilter({
      range: {
        'facebook_ad_post_owners.page_created_date': {
          gte: pc.lower_date, lte: pc.upper_date,
          format: "yyyy-MM-dd' 'HH:mm:ss",
        },
      },
    });
  }

  _getDomainDateEnv() {
    const dd = this._params.domainDate;
    if (!dd || !dd.lower_date || !dd.upper_date) return null;
    return asFilter({
      range: {
        'facebook_ad_domains.domain_registered_date': {
          gte: dd.lower_date, lte: dd.upper_date,
          format: 'yyyy-MM-dd',
        },
      },
    });
  }

  _getNeedleEnv() {
    const needle = this._params.needle;
    if (!needle) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) {
      return null;
    }
    return asFilter({ range: { 'facebook_ad.last_seen': { lt: needle } } });
  }

  _getVerifiedEnv() {
    const v = this._params.verified;
    if (v === '' || v === undefined || v === null || v === 'NA') return null;
    return asFilter({ term: { 'facebook_ad_post_owners.verified': v } });
  }

  _getDiscovererUserIdEnv() {
    const d = this._params.discovererUserId;
    if (!d) return null;
    return asFilter({ term: { 'facebook_ad.discoverer_user_id': d } });
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'facebook_ad_meta_data.affiliate_data',
        'facebook_ad_meta_data.built_with',
        'facebook_ad_meta_data.clickbank_data',
      ],
      bw
    ));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('facebook_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const fieldMap = {
      desktop: 'facebook_ad_meta_data.firstSeenOnDesktop',
      ios: 'facebook_ad_meta_data.firstSeenOnIos',
      android: 'facebook_ad_meta_data.firstSeenOnAndroid',
    };
    const fields = [];
    for (const s of src) {
      if (s === 'all') {
        fields.push(fieldMap.desktop, fieldMap.ios, fieldMap.android);
      } else if (fieldMap[s]) {
        fields.push(fieldMap[s]);
      }
    }
    const unique = [...new Set(fields)];
    if (!unique.length) return null;
    if (unique.length === 1) return asFilter({ exists: { field: unique[0] } });
    return asFilter({
      bool: {
        should: unique.map((f) => ({ exists: { field: f } })),
        minimum_should_match: 1,
      },
    });
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('facebook_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'facebook_ad_meta_data.affiliate_data',
        'facebook_ad_meta_data.built_with',
        'facebook_ad_meta_data.clickbank_data',
      ],
      a
    ));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    // Original used leading+trailing wildcards in query_string — we keep
    // the wildcard since URL substrings genuinely need a containment
    // search and we can't change mappings. We do drop query_string in
    // favour of a `bool.should` of `wildcard` queries (one per term),
    // which avoids the QueryString parser cost and keeps each clause
    // individually cacheable in filter context.
    const fields = [
      'facebook_ad_url.url_destination',
      'facebook_ad_outgoing_links.source_url',
      'facebook_ad_outgoing_links.redirect_url',
      'facebook_ad_outgoing_links.final_url',
      'facebook_ad_url.url_redirects',
      'facebook_ad_meta_data.destination_url',
    ];
    const should = [];
    for (const v of mp) {
      const value = `*${v}*`;
      for (const f of fields) {
        should.push({ wildcard: { [f]: { value } } });
      }
    }
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getMetaFilterEnv() {
    const mf = this._params.metaFilter;
    if (!mf) return null;
    return asFilter({ term: { 'facebook_ad.platform': String(mf) } });
  }

  _getPlatformEnv() {
    const p = this._params.platform;
    if (!p || !p.length) return null;
    return asFilter(matchFilter('facebook_ad.platform', p));
  }

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('lang_detect', ld));
  }

  _getTagsEnv() {
    const tags = this._params.tags;
    if (!tags || !tags.length) return null;
    return asFilter(multiFieldMatchFilter(['facebook_ad_variants.tags'], tags));
  }

  _getRangeEnv(field, vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    return asFilter({
      range: { [field]: { gte: parseInt(vals[0], 10), lte: parseInt(vals[1], 10) } },
    });
  }

  _getLikesEnv()       { return this._getRangeEnv('facebook_ad.likes', this._params.likes); }
  _getCommentsEnv()    { return this._getRangeEnv('facebook_ad.comments', this._params.comments); }
  _getSharesEnv()      { return this._getRangeEnv('facebook_ad.shares', this._params.shares); }
  _getImpressionsEnv() { return this._getRangeEnv('facebook_ad.impression', this._params.impressions); }
  _getPopularityEnv()  { return this._getRangeEnv('facebook_ad.popularity.current', this._params.popularity); }
  _getAdBudgetEnv()    { return this._getRangeEnv('facebook.averagebudget', this._params.adBudget); }

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `http://${url}`);
      domain = parsed.hostname;
    } catch {
      domain = url.split('/')[0];
    }
    // Leading wildcard required to match domain anywhere in the URL — kept
    // intact, but pushed into filter context so it can be cached.
    return asFilter({ wildcard: { 'facebook_ad_meta_data.destination_url': `*${domain}*` } });
  }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(
      ['country_only.country', 'facebook_user_countries'], nc
    );
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { 'facebook_ad.id': String(id) } };
  }

  // ─── Query assembly ────────────────────────────────────

  _collectEnvelopes() {
    const generators = [
      // exact-match / filter-context first (cheaper, narrows candidate set)
      '_getDomainMatchedIdsEnv',
      '_getPlatformEnv',
      '_getCountryEnv',
      '_getStateEnv',
      '_getCityEnv',
      '_getTypeEnv',
      '_getAdPositionEnv',
      '_getGenderEnv',
      '_getAdCategoryEnv',
      '_getSubCategoryEnv',
      '_getCallToActionEnv',
      '_getTagsEnv',
      '_getLangDetectEnv',
      '_getVerifiedEnv',
      '_getDiscovererUserIdEnv',
      '_getMetaFilterEnv',
      '_getBuiltWithEnv',
      '_getTrackEnv',
      '_getSourceEnv',
      '_getFunnelEnv',
      '_getAffiliateEnv',
      '_getMarketPlatformEnv',
      // ranges
      '_getLowerAgeSeenEnv',
      '_getLastSeenEnv',
      '_getPostDateEnv',
      '_getPageCreationEnv',
      '_getDomainDateEnv',
      '_getNeedleEnv',
      '_getLikesEnv',
      '_getCommentsEnv',
      '_getSharesEnv',
      '_getImpressionsEnv',
      '_getPopularityEnv',
      '_getAdBudgetEnv',
      // url containment
      '_getUrlEnv',
      // full-text relevance (must)
      '_getKeywordEnv',
      '_getPostOwnerNameEnv',
      '_getOcrEnv',
      '_getCelebrityEnv',
      '_getImageObjectEnv',
      '_getLogoEnv',
      '_getMixdataEnv',
      '_getHtmlEnv',
      '_getCommentdataEnv',
      '_getHtmlContentEnv',
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

    // The NAS image filter is always applied — append to filter context.
    buckets.filter.push(...EXTRA_CONDITION);

    // Popularity sort = "show ads ranked by popularity score, highest first".
    // Without this, docs that have no popularity score still match and sort to
    // the bottom (a few scored ads followed by a tail of score-less ones).
    // Require the field to exist so only scored ads are returned. A popularity
    // range filter, when set, already implies this — so the two compose cleanly.
    if (this._sortField === 'facebook_ad.popularity.current') {
      buckets.filter.push({ exists: { field: 'facebook_ad.popularity.current' } });
    }

    // must_not handling (notCountry + adDetailId exclusion)
    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);
    const adExcl = this._getAdDetailIdExclude();
    if (adExcl) buckets.must_not.push(adExcl);

    let partBody = flatBool(buckets);

    // ─── Country priority boosting ──────────────────────
    const isPriorityOffset = (
      this._ipBasedCountry &&
      this._from < 10000 &&
      (!this._params.country || !this._params.country.length)
    );

    if (this._ipBasedCountry) {
      partBody = wrapWithCountryBoost(
        partBody,
        this._ipBasedCountry,
        'country_only.country.keyword',
        'country_only.country',
        { includeWildcard: true }
      );
    }

    // ─── Sorting ────────────────────────────────────────
    const baseSort = Array.isArray(this._sortField)
      ? [...this._sortField]
      : [{ [this._sortField]: this._sortMethod }];
    baseSort.push({ 'facebook_ad.id': 'desc' });

    const sort = isPriorityOffset ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    // ─── Assemble final params ──────────────────────────
    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      collapse: { field: 'facebook_ad.id' },
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

// Retained for API compatibility — original class exported `escapeWords`,
// `relativeWords`, `wrapIfNeed` indirectly through usage but never
// publicly. We re-export `relativeWords` only because some downstream
// helpers historically imported it from this module.
SearchMixQueryBuilder._relativeWords = relativeWords;

module.exports = SearchMixQueryBuilder;
