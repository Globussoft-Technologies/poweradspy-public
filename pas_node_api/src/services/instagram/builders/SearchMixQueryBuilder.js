'use strict';
require("dotenv").config();

/**
 * SearchMixQueryBuilder (Instagram)
 *
 * Mirrors the Facebook builder structure (same prefixed-schema pattern,
 * but `instagram_*` field names). See the Facebook builder for the
 * detailed explanation of the optimizations applied:
 *   - flat bool with separate must/filter/must_not
 *   - non-scoring clauses pushed into filter context
 *   - query_string replaced by term/terms/match/multi_match where the
 *     QueryString grammar wasn't doing real work
 *   - market platform leading-wildcard kept (mapping-bound) but emitted
 *     as `wildcard` clauses inside filter context for cacheability
 *   - optional `profile: true` via setProfile() or ES_PROFILE env var
 */

const { instagram: igNet } = require('../../../config/networks');
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
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_IG_INDEX = igNet?.database?.elastic?.index || process.env.IG_ELASTIC_INDEX || 'search_mix';

const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        // IMAGE / STORIES — must have a NAS image URL
        {
          bool: {
            filter: [
              { terms:  { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        // VIDEO — must have a thumbnail
        {
          bool: {
            filter: [
              { term:   { 'instagram_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'thumbnail' } },
            ],
          },
        },
        // Everything else (carousel, reel, etc.) — pass through
        {
          bool: {
            must_not: [
              { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } },
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
    this._indexName = indexName || DEFAULT_IG_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = 'instagram_ad.last_seen';
    this._sortMethod = 'desc';
    this._ipBasedCountry = '';
    this._profile = undefined;
    this._params = {};
  }

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }

  setSortField(field) {
    if (field === 'all') {
      this._sortField = [
        { 'instagram_ad_meta_data.firstSeenOnDesktop': { order: 'desc' } },
        { 'instagram_ad_meta_data.firstSeenOnAndroid': { order: 'desc' } },
        { 'instagram_ad_meta_data.firstSeenOnIos': { order: 'desc' } },
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
  setProfile(v) { this._profile = v; return this; }

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

  setNeedle(v)             { this._params.needle = (v && v !== 'NA') ? v : ''; return this; }
  setLikes(v)              { this._params.likes = Array.isArray(v) ? v : null; return this; }
  setComments(v)           { this._params.comments = Array.isArray(v) ? v : null; return this; }
  setShares(v)             { this._params.shares = Array.isArray(v) ? v : null; return this; }
  setImpressions(v)        { this._params.impressions = Array.isArray(v) ? v : null; return this; }
  setPopularity(v)         { this._params.popularity = Array.isArray(v) ? v : null; return this; }
  setAdBudget(v)           { this._params.adBudget = Array.isArray(v) ? v : null; return this; }

  setLastSeen(v)           { this._params.lastSeen = v; return this; }
  setPostDate(v)           { this._params.postDate = v; return this; }
  setPageCreation(v)       { this._params.pageCreation = v; return this; }
  setDomainDate(v)         { this._params.domainDate = v; return this; }

  setLowerAgeSeen(v)       { this._params.lowerAgeSeen = v; return this; }

  setOcr(v)                { this._params.ocr = v; return this; }
  setCelebrity(v)          { this._params.celebrity = Array.isArray(v) ? v : [v]; return this; }
  setImageObject(v)        { this._params.imageObject = Array.isArray(v) ? v : [v]; return this; }
  setLogo(v)               { this._params.logo = Array.isArray(v) ? v : [v]; return this; }
  setMixdata(v)            { this._params.mixdata = v; return this; }
  setHtmlContent(v)        { this._params.htmlContent = v; return this; }
  setHtml(v)               { this._params.html = v; return this; }
  setCommentdata(v)        { this._params.commentdata = v; return this; }

  // ─── Clause generators ──

  _kwFields() {
    return [
      'instagram_ad_variants.title',
      'instagram_ad_variants.text',
      'instagram_ad_variants.newsfeed_description',
      'instagram_ad_variants.title_exactly',
      'instagram_ad_variants.text_exactly',
      'instagram_ad_variants.newsfeed_description_exactly',
      'instagram_translation.ad_text',
      'instagram_translation.news_feed_description',
      'instagram_translation.ad_title',
      'instagram_translations.ar.title',
      'instagram_translations.ar.text',
      'instagram_translations.ar.newsfeed_description',
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
      'instagram_ad_post_owners.post_owner_name',
      'instagram_ad_post_owners.post_owner_name_ru',
      'instagram_ad_post_owners.post_owner_name_fr',
      'instagram_ad_post_owners.post_owner_name_sp',
      'instagram_ad_post_owners.post_owner_name_ge',
      'instagram_ad_post_owners.post_owner_name_exactly',
    ];
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['instagram_ad_post_owners.post_owner_name_exactly'],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, name),
          { prefix: { 'instagram_ad_post_owners.post_owner_name': name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    const fields = [
      'instagram_ad_variants.image_ocr',
      'instagram_ad_variants.image_ocr_ru',
      'instagram_ad_variants.image_ocr_fr',
      'instagram_ad_variants.image_ocr_sp',
    ];
    if (ocr.includes('"')) {
      return asMust({
        multi_match: {
          query: ocr.replace(/"/g, ''),
          type: 'phrase',
          fields: ['instagram_ad_variants.image_ocr', 'instagram_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, ocr));
  }

  _imageArrayEnv(fieldBase, vals) {
    if (!vals || !vals.length) return null;
    const fields = [
      `instagram_ad_variants.${fieldBase}`,
      `instagram_ad_variants.${fieldBase}_ru`,
      `instagram_ad_variants.${fieldBase}_fr`,
      `instagram_ad_variants.${fieldBase}_sp`,
    ];
    return asMust(multiFieldMatchFilter(fields, vals));
  }

  _getCelebrityEnv()   { return this._imageArrayEnv('image_celebrity', this._params.celebrity); }
  _getImageObjectEnv() { return this._imageArrayEnv('image_object', this._params.imageObject); }
  _getLogoEnv()        { return this._imageArrayEnv('image_brand_logo', this._params.logo); }

  _getMixdataEnv() {
    const md = this._params.mixdata;
    if (!md) return null;
    if (md.includes('"')) {
      return asMust({ multi_match: { query: md.replace(/"/g, ''), type: 'phrase', fields: ['mixdata'] } });
    }
    return asMust(phraseAcrossFields(['mixdata'], md));
  }

  _getHtmlEnv() {
    const h = this._params.html;
    if (!h) return null;
    if (h.includes('"')) {
      return asMust({ multi_match: { query: h.replace(/"/g, ''), type: 'phrase', fields: ['html'] } });
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
          fields: ['instagram_comments.comment_data'],
        },
      });
    }
    return asMust(phraseAcrossFields(
      ['instagram_comments.comment_data', 'comment_data'], cd
    ));
  }

  _getHtmlContentEnv() {
    const hc = this._params.htmlContent;
    if (!hc) return null;
    const fields = [
      'instagram_ad_html_lander_content.html_whitehat_lander_text',
      'instagram_ad_html_lander_content.html_res_blackhat_lander_text',
      'instagram_ad_html_lander_content.html_dc_blackhat_lander_text',
      'instagram_ad_outgoing_links.html_content_final_url',
    ];
    if (hc.includes('"')) {
      return asMust({ multi_match: { query: hc.replace(/"/g, ''), type: 'phrase', fields } });
    }
    return asMust(phraseAcrossFields(fields, hc));
  }

  // ─── Filter context ──

  _getDomainMatchedIdsEnv() {
    const ids = this._params.domainMatchedIds;
    if (!ids || !ids.length) return null;
    return asFilter({ terms: { 'instagram_ad.id': ids } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['instagram_country_only.country'], c));
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
    return asFilter(termFilterCI('instagram_call_to_action.call_to_action.keyword', cta));
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('instagram.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('instagram.subCategory.keyword', sub));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('instagram_ad.type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length || ap.length === 4) return null;
    return asFilter(matchFilter('instagram_ad.ad_position', ap));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('instagram_users.Gender', g));
  }

  _getLowerAgeSeenEnv() {
    const age = this._params.lowerAgeSeen;
    if (!age || !age.lower_age || !age.upper_age) return null;
    return asFilter({
      range: {
        'instagram_ad.lower_age_seen': {
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
        'instagram_ad.last_seen': {
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
        'instagram_ad.post_date': {
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
        'instagram_ad_post_owners.page_created_date': {
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
        'instagram_ad_domain.domain_registered_date': {
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
    return asFilter({ range: { 'instagram_ad.last_seen': { lt: needle } } });
  }

  _getVerifiedEnv() {
    const v = this._params.verified;
    if (v === '' || v === undefined || v === null || v === 'NA') return null;
    return asFilter({ term: { 'instagram_ad_post_owners.verified': v } });
  }

  _getDiscovererUserIdEnv() {
    const d = this._params.discovererUserId;
    if (!d) return null;
    return asFilter({ term: { 'instagram_ad.discoverer_user_id': d } });
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'instagram_ad_meta_data.affiliate_data',
        'instagram_ad_meta_data.built_with',
        'instagram_ad_meta_data.clickbank_data',
      ],
      bw
    ));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('instagram_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const fieldMap = {
      desktop: 'instagram_ad_meta_data.firstSeenOnDesktop',
      ios: 'instagram_ad_meta_data.firstSeenOnIos',
      android: 'instagram_ad_meta_data.firstSeenOnAndroid',
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
        should: unique.map(f => ({ exists: { field: f } })),
        minimum_should_match: 1,
      },
    });
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('instagram_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'instagram_ad_meta_data.affiliate_data',
        'instagram_ad_meta_data.built_with',
        'instagram_ad_meta_data.clickbank_data',
      ],
      a
    ));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    const fields = [
      'instagram_ad_url.url_destination',
      'instagram_ad_outgoing_links.source_url',
      'instagram_ad_outgoing_links.redirect_url',
      'instagram_ad_outgoing_links.final_url',
      'instagram_ad_url.url_redirects',
      'instagram_ad_meta_data.destination_url',
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
    return asFilter({ term: { 'instagram_ad_meta_data.platform': String(mf) } });
  }

  _getPlatformEnv() {
    const p = this._params.platform;
    if (!p || !p.length) return null;
    return asFilter(matchFilter('instagram_ad_meta_data.platform', p));
  }

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('lang_detect', ld));
  }

  _getTagsEnv() {
    const tags = this._params.tags;
    if (!tags || !tags.length) return null;
    return asFilter(multiFieldMatchFilter(['instagram_ad_variants.tags'], tags));
  }

  _getRangeEnv(field, vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    return asFilter({
      range: { [field]: { gte: parseInt(vals[0], 10), lte: parseInt(vals[1], 10) } },
    });
  }

  _getLikesEnv()       { return this._getRangeEnv('instagram_ad.likes', this._params.likes); }
  _getCommentsEnv()    { return this._getRangeEnv('instagram_ad.comments', this._params.comments); }
  _getSharesEnv()      { return this._getRangeEnv('instagram_ad.shares', this._params.shares); }
  _getImpressionsEnv() { return this._getRangeEnv('instagram_ad.impression', this._params.impressions); }
  _getPopularityEnv()  { return this._getRangeEnv('instagram_ad.popularity.current', this._params.popularity); }
  _getAdBudgetEnv()    { return this._getRangeEnv('instagram.averagebudget', this._params.adBudget); }

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
    return asFilter({ wildcard: { 'instagram_ad_meta_data.destination_url': `*${domain}*` } });
  }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(
      ['instagram_country_only.country', 'instagram_user_countries'], nc
    );
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { 'instagram_ad.id': String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
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
      '_getUrlEnv',
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
    buckets.filter.push(...EXTRA_CONDITION);

    // Popularity sort = "show ads ranked by popularity score, highest first".
    // Require the field to exist so score-less docs (which would otherwise sort
    // to the bottom) are excluded entirely. A popularity range filter already
    // implies this, so the two compose cleanly.
    if (this._sortField === 'instagram_ad.popularity.current') {
      buckets.filter.push({ exists: { field: 'instagram_ad.popularity.current' } });
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
        'instagram_country_only.country.keyword',
        'instagram_country_only.country',
        { includeWildcard: false }
      );
    }

    const baseSort = Array.isArray(this._sortField)
      ? [...this._sortField]
      : [{ [this._sortField]: this._sortMethod }];
    baseSort.push({ 'instagram_ad.id': 'desc' });

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
  'instagram_ad.id',
  'instagram_ad.likes',
  'instagram_ad.shares',
  'instagram_ad.comments',
  'instagram_ad.impression',
  'instagram_ad.days_running',
  'instagram_ad.popularity',
  'instagram_ad_post_owners.verified',
  'instagram_call_to_action.call_to_action',
  'lang_detect',
  'new_nas_image_url',
  'nas_video_url',
  'instagram_ad_meta_data.destination_url',
  'instagram_ad_url.url_redirects',
  'instagram_ad_url.url',
  'instagram_ad_url.url_destination',
  'instagram_ad_outgoing_links.source_url',
  'instagram_ad_outgoing_links.redirect_url',
  'instagram_ad_outgoing_links.final_url',
];

SearchMixQueryBuilder._relativeWords = relativeWords;

module.exports = SearchMixQueryBuilder;
