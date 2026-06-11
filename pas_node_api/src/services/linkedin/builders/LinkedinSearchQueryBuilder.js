'use strict';
require('dotenv').config();

/**
 * LinkedinSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `linkedin_ads_data` index.
 * Mostly flat field names (`ad_title`, `ad_text`, `countries`, …).
 *
 * Optimization summary (see common/helpers/esQueryHelpers.js for shared
 * helpers):
 *   - Flat bool with separate must/filter/must_not.
 *   - Exact-match codes (ad_type, ad_position, ad_sub_position, gender,
 *     ad_language, source, callToAction, builtWith, funnel, affiliate,
 *     countries, target_keyword, verified) → match/term/terms in filter
 *     context.
 *   - Keyword/postOwnerName/OCR/htmlContent/celebrity/imageObject/logo
 *     stay in must but emitted via multi_match.
 *   - source previously used query_string with quoted values to phrase
 *     match; now `terms` since values are bare codes.
 *   - Optional `profile: true` via setProfile() / ES_PROFILE env.
 */

const {
  flatBool,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  termFilter,
  termFilterCI,
  wrapWithCountryBoost,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_LI_INDEX = process.env.LI_ELASTIC_INDEX || 'linkedin_ads_data';

// Displayable-media gate (mirrors Facebook's IMAGE+VIDEO pattern).
//   IMAGE → must have new_nas_image_url (NAS image thumbnail)
//   VIDEO → must have `ad_video` (where LinkedIn stores the video thumbnail)
//   other types → pass through unchanged
// Ads missing their thumbnail field fall back to a legacy pasvideos/pasimages
// path the UI hides as blocked media, so counting them inflated "Total Ads"
// (ES said 16 but only the ones with real thumbnails rendered). Filtering here
// makes hits.total equal what actually shows.
const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { "ad_type.keyword": "IMAGE" } },
              { exists: { field: "new_nas_image_url" } },
            ],
            must_not: [
              {
                wildcard: {
                  "new_nas_image_url.keyword": { value: "*DefaultImage*" },
                },
              },
              {
                wildcard: {
                  "new_nas_image_url.keyword": { value: "*pasimage*" },
                },
              },
              {
                wildcard: {
                  "new_nas_image_url.keyword": { value: "*bydefault*" },
                },
              },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { "ad_type.keyword": "VIDEO" } },
              { exists: { field: "ad_video" } },
            ],
            // The thumbnail lives in `ad_video`; the un-migrated ones hold a
            // legacy pasvideos/pasimages/bydefault path the UI hides. Exclude
            // by value (existence alone doesn't separate them — all videos have
            // the field).
            must_not: [
              { wildcard: { "ad_video.keyword": { value: "*pasvideo*" } } },
              { wildcard: { "ad_video.keyword": { value: "*pasimage*" } } },
              { wildcard: { "ad_video.keyword": { value: "*bydefault*" } } },
              {
                wildcard: {
                  "new_nas_image_url.keyword": { value: "*DefaultImage*" },
                },
              },
            ],
          },
        },
        {
          bool: {
            must_not: [{ terms: { "ad_type.keyword": ["IMAGE", "VIDEO"] } }],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

class LinkedinSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_LI_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = 'last_seen';
    this._sortMethod = 'desc';
    this._ipBasedCountry = '';
    this._profile = undefined;
    this._params = {};
  }

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }
  setSortField(field) { this._sortField = field; return this; }
  setSortMethod(v) { if (v === 'asc' || v === 'desc') this._sortMethod = v; return this; }
  setIpBasedCountry(v) { this._ipBasedCountry = (v && v !== 'NA') ? v : ''; return this; }
  setProfile(v) { this._profile = v; return this; }

  setKeyword(v)            { this._params.keyword = v; return this; }
  setPostOwnerName(v)      { this._params.postOwnerName = v; return this; }
  setUrl(v)                { this._params.url = v; return this; }
  setCountry(v)            { this._params.country = Array.isArray(v) ? v : [v]; return this; }
  setState(v)              { this._params.state = Array.isArray(v) ? v : [v]; return this; }
  setCity(v)               { this._params.city = Array.isArray(v) ? v : [v]; return this; }
  setCallToAction(v)       { this._params.callToAction = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v)         { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v)        { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v)             { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v)         { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setAdSubPosition(v)      { this._params.adSubPosition = Array.isArray(v) ? v : [v]; return this; }
  setGender(v)             { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v)             { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTargetKeyword(v)      { this._params.targetKeyword = Array.isArray(v) ? v : [v]; return this; }
  setBuiltWith(v)          { this._params.builtWith = Array.isArray(v) ? v : [v]; return this; }
  setTrack(v)              { this._params.track = Array.isArray(v) ? v : [v]; return this; }
  setSource(v)             { this._params.source = Array.isArray(v) ? v : [v]; return this; }
  setFunnel(v)             { this._params.funnel = Array.isArray(v) ? v : [v]; return this; }
  setAffiliate(v)          { this._params.affiliate = Array.isArray(v) ? v : [v]; return this; }
  setMarketPlatform(v)     { this._params.marketPlatform = Array.isArray(v) ? v : [v]; return this; }
  setLangDetect(v)         { this._params.langDetect = Array.isArray(v) ? v : [v]; return this; }
  setVerified(v)           { this._params.verified = v; return this; }
  setNotCountry(v)         { this._params.notCountry = v; return this; }
  setAdDetailId(v)         { this._params.adDetailId = v; return this; }

  setNeedle(v)             { this._params.needle = (v && v !== 'NA') ? v : ''; return this; }
  setLikes(v)              { this._params.likes = Array.isArray(v) ? v : null; return this; }
  setComments(v)           { this._params.comments = Array.isArray(v) ? v : null; return this; }
  setImpressions(v)        { this._params.impressions = Array.isArray(v) ? v : null; return this; }
  setPopularity(v)         { this._params.popularity = Array.isArray(v) ? v : null; return this; }

  setLastSeen(v)           { this._params.lastSeen = v; return this; }
  setPostDate(v)           { this._params.postDate = v; return this; }
  setDomainDate(v)         { this._params.domainDate = v; return this; }

  setLowerAgeSeen(v)       { this._params.lowerAgeSeen = v; return this; }

  setOcr(v)                { this._params.ocr = v; return this; }
  setCelebrity(v)          { this._params.celebrity = Array.isArray(v) ? v : [v]; return this; }
  setImageObject(v)        { this._params.imageObject = Array.isArray(v) ? v : [v]; return this; }
  setLogo(v)               { this._params.logo = Array.isArray(v) ? v : [v]; return this; }
  setHtmlContent(v)        { this._params.htmlContent = v; return this; }

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
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['linkedin_ad_post_owners.post_owner_name_exactly'],
        },
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

  _getHtmlContentEnv() {
    const hc = this._params.htmlContent;
    if (!hc) return null;
    if (hc.includes('"')) {
      return asMust({ multi_match: { query: hc.replace(/"/g, ''), type: 'phrase', fields: ['html_text'] } });
    }
    return asMust(phraseAcrossFields(['html_text'], hc));
  }

  // ─── filter context ──

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; }
    catch { domain = url.split('/')[0]; }
    return asFilter({ wildcard: { destination_url: `*${domain}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['countries'], c));
  }

  _getStateEnv() {
    const s = this._params.state;
    if (!s || !s.length) return null;
    return asFilter(multiFieldMatchFilter(['state'], s));
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
    return asFilter(termFilterCI('call_to_action.keyword', cta));
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('linkedin.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('linkedin.subCategory.keyword', sub));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('ad_type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length || ap.length >= 4) return null;
    return asFilter(matchFilter('ad_position', ap));
  }

  _getAdSubPositionEnv() {
    const asp = this._params.adSubPosition;
    if (!asp || !asp.length) return null;
    return asFilter(matchFilter('ad_sub_position', asp));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('gender', g));
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

  _getVerifiedEnv() {
    const v = this._params.verified;
    if (v === '' || v === undefined || v === null || v === 'NA') return null;
    return asFilter({ term: { verified: v } });
  }

  _getTargetKeywordEnv() {
    const tk = this._params.targetKeyword;
    if (!tk || !tk.length) return null;
    return asFilter(multiFieldMatchFilter(['linkedin_ad_variants.target_keyword'], tk));
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(matchFilter('ecommerce_platform', bw));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('linkedin_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    // Original used query_string with phrase + quoted values. Bare codes
    // map cleanly to `terms` once we drop the quote-induced parser pass.
    return asFilter(termFilter('source', src));
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

  _getLikesEnv()       { return this._rangeEnv('reactions.likes', this._params.likes); }
  _getCommentsEnv()    { return this._rangeEnv('comments', this._params.comments); }
  _getImpressionsEnv() { return this._rangeEnv('impression', this._params.impressions); }
  _getPopularityEnv()  { return this._rangeEnv('popularity.current', this._params.popularity); }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(['country_only.country'], nc);
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { ad_id: String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv', '_getStateEnv', '_getCityEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getAdSubPositionEnv', '_getGenderEnv',
      '_getCallToActionEnv', '_getAdCategoryEnv', '_getSubCategoryEnv',
      '_getLangDetectEnv', '_getVerifiedEnv', '_getTargetKeywordEnv',
      '_getBuiltWithEnv', '_getTrackEnv', '_getSourceEnv',
      '_getFunnelEnv', '_getAffiliateEnv', '_getMarketPlatformEnv',
      '_getLowerAgeSeenEnv', '_getLastSeenEnv', '_getPostDateEnv',
      '_getDomainDateEnv', '_getNeedleEnv',
      '_getLikesEnv', '_getCommentsEnv', '_getImpressionsEnv', '_getPopularityEnv',
      '_getUrlEnv',
      '_getKeywordEnv', '_getPostOwnerNameEnv',
      '_getOcrEnv', '_getCelebrityEnv', '_getImageObjectEnv', '_getLogoEnv',
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
    buckets.filter.push(...EXTRA_CONDITION);

    // Popularity sort = "show ads ranked by popularity score, highest first".
    // Require the field to exist so score-less docs (which would otherwise sort
    // to the bottom) are excluded entirely. A popularity range filter already
    // implies this, so the two compose cleanly.
    if (this._sortField === 'popularity.current') {
      buckets.filter.push({ exists: { field: 'popularity.current' } });
    }

    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);
    const adExcl = this._getAdDetailIdExclude();
    if (adExcl) buckets.must_not.push(adExcl);

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
        'country_only.country.keyword',
        'country_only.country',
        { includeWildcard: false }
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { _id: 'desc' }];
    const sort = isPriorityOffset ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: LinkedinSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

LinkedinSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'ad_id',
  'reactions',
  'comments',
  'impression',
  'verified',
  'first_seen',
  'duration',
  'popularity',
  'new_nas_image_url',
  'redirect_urls',
  'duration',
];

module.exports = LinkedinSearchQueryBuilder;
