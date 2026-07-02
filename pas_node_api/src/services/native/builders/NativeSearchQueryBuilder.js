'use strict';
require('dotenv').config();

/**
 * NativeSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `native_search_mix` index.
 * Optimized to flat-bool / filter-context / match+terms style — see the
 * Facebook builder docstring for the full rationale.
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
  wrapIfNeed,
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_NAT_INDEX = process.env.NAT_ELASTIC_INDEX || 'native_search_mix_v2';

const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { terms: { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
              { exists: { field: 'native_ad.nas_url' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              { terms: { 'native_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
];

class NativeSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_NAT_INDEX;
    this._from = 0;
    this._size = 20;
    this._sortField = 'native_ad.last_seen';
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
  setNetwork(v)            { this._params.network = Array.isArray(v) ? v : [v]; return this; }
  setCallToAction(v)       { this._params.callToAction = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v)         { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v)        { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setCategory(v)           { this._params.category = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v)             { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v)         { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setAdSubPosition(v)      { this._params.adSubPosition = Array.isArray(v) ? v : [v]; return this; }
  setGender(v)             { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v)             { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTargetKeyword(v)      { this._params.targetKeyword = Array.isArray(v) ? v : [v]; return this; }
  setTags(v)               { this._params.tags = Array.isArray(v) ? v : [v]; return this; }
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

  _kwFields() {
    return [
      'native_ad_variants.title', 'native_ad_variants.title_ru',
      'native_ad_variants.title_fr', 'native_ad_variants.title_sp', 'native_ad_variants.title_ge',
      'native_ad_variants.text', 'native_ad_variants.text_ru',
      'native_ad_variants.text_fr', 'native_ad_variants.text_sp', 'native_ad_variants.text_ge',
      'native_ad_variants.newsfeed_description', 'native_ad_variants.newsfeed_description_ru',
      'native_ad_variants.newsfeed_description_fr', 'native_ad_variants.newsfeed_description_sp',
      'native_ad_variants.newsfeed_description_ge',
      'native_ad_translation.ad_text', 'native_ad_translation.news_feed_description', 'native_ad_translation.ad_title',
    ];
  }

  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    const fields = this._kwFields();
    if (kw.includes('"')) {
      return asMust({
        multi_match: {
          query: kw.replace(/"/g, ''),
          type: 'phrase',
          fields: [
            ...fields,
            'native_ad_variants.title_exactly',
            'native_ad_variants.text_exactly',
            'native_ad_variants.newsfeed_description_exactly',
          ],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, kw));
  }

  _getPostOwnerNameEnv() {
    const name = this._params.postOwnerName;
    if (!name) return null;
    const fields = [
      'native_ad_post_owners.post_owner_name', 'native_ad_post_owners.post_owner_name_ru',
      'native_ad_post_owners.post_owner_name_fr', 'native_ad_post_owners.post_owner_name_sp',
      'native_ad_post_owners.post_owner_name_ge', 'native_ad_post_owners.post_owner_name_exactly',
    ];
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['native_ad_post_owners.post_owner_name_exactly', 'native_ad_post_owners.post_owner_name'],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, name),
          { prefix: { 'native_ad_post_owners.post_owner_name': name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    const fields = [
      'native_ad_variants.image_ocr', 'native_ad_variants.image_ocr_ru',
      'native_ad_variants.image_ocr_fr', 'native_ad_variants.image_ocr_sp',
    ];
    if (ocr.includes('"')) {
      return asMust({
        multi_match: {
          query: ocr.replace(/"/g, ''),
          type: 'phrase',
          fields: ['native_ad_variants.image_ocr', 'native_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, ocr));
  }

  _imageArrayEnv(fieldBase, vals) {
    if (!vals || !vals.length) return null;
    return asMust(multiFieldMatchFilter(
      [
        `native_ad_variants.${fieldBase}`,
        `native_ad_variants.${fieldBase}_ru`,
        `native_ad_variants.${fieldBase}_fr`,
        `native_ad_variants.${fieldBase}_sp`,
      ],
      vals
    ));
  }

  _getCelebrityEnv()   { return this._imageArrayEnv('image_celebrity', this._params.celebrity); }
  _getImageObjectEnv() { return this._imageArrayEnv('image_object', this._params.imageObject); }
  _getLogoEnv()        { return this._imageArrayEnv('image_brand_logo', this._params.logo); }

  _getHtmlContentEnv() {
    const hc = this._params.htmlContent;
    if (!hc) return null;
    const fields = [
      'native_ad_html_lander_content.html_whitehat_lander_text',
      'native_ad_html_lander_content.html_res_blackhat_lander_text',
      'native_ad_html_lander_content.html_dc_blackhat_lander_text',
    ];
    if (hc.includes('"')) {
      return asMust({ multi_match: { query: hc.replace(/"/g, ''), type: 'phrase', fields } });
    }
    return asMust(phraseAcrossFields(fields, hc));
  }

  // ─── filter context ──

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; }
    catch { domain = url.split('/')[0]; }
    return asFilter({ wildcard: { 'native_ad_meta_data.destination_url': `*${domain}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['native_country_only.country'], c));
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

  _getNetworkEnv() {
    const n = this._params.network;
    if (!n || !n.length) return null;
    return asFilter(multiFieldMatchFilter(['networks.network'], n));
  }

  _getCallToActionEnv() {
    const cta = this._params.callToAction;
    if (!cta || !cta.length) return null;
    return asFilter(matchFilter('native_call_to_actions.action', cta));
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('native.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('native.subCategory.keyword', sub));
  }

  _getCategoryEnv() {
    const cat = this._params.category;
    if (!cat || !cat.length) return null;
    return asFilter(matchFilter('native_category.category', cat));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('native_ad.type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length) return null;
    return asFilter(matchFilter('native_ad.ad_position', ap));
  }

  _getAdSubPositionEnv() {
    const asp = this._params.adSubPosition;
    if (!asp || !asp.length) return null;
    return asFilter(matchFilter('native_ad.ad_sub_position', asp));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('native_user.gender', g));
  }

  _getLowerAgeSeenEnv() {
    const age = this._params.lowerAgeSeen;
    if (!age || !age.lower_age || !age.upper_age) return null;
    return asFilter({
      range: { 'native_ad.lower_age_seen': { gte: parseInt(age.lower_age, 10), lte: parseInt(age.upper_age, 10) } },
    });
  }

  _getLastSeenEnv() {
    const ls = this._params.lastSeen;
    if (!ls || !ls.lower_date || !ls.upper_date) return null;
    return asFilter({
      range: { 'native_ad.last_seen': { gte: ls.lower_date, lte: ls.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } },
    });
  }

  _getPostDateEnv() {
    const pd = this._params.postDate;
    if (!pd || !pd.lower_date || !pd.upper_date) return null;
    return asFilter({
      range: { 'native_ad.post_date': { gte: pd.lower_date, lte: pd.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } },
    });
  }

  _getDomainDateEnv() {
    const dd = this._params.domainDate;
    if (!dd || !dd.lower_date || !dd.upper_date) return null;
    return asFilter({
      range: { 'native_ad_domains.domain_registered_date': { gte: dd.lower_date, lte: dd.upper_date, format: 'yyyy-MM-dd' } },
    });
  }

  _getNeedleEnv() {
    const needle = this._params.needle;
    if (!needle) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) return null;
    return asFilter({ range: { 'native_ad.last_seen': { lt: needle } } });
  }

  _getTargetKeywordEnv() {
    const tk = this._params.targetKeyword;
    if (!tk || !tk.length) return null;
    return asFilter(multiFieldMatchFilter(['native_ad_variants.target_keyword'], tk));
  }

  _getTagsEnv() {
    const tags = this._params.tags;
    if (!tags || !tags.length) return null;
    return asFilter(multiFieldMatchFilter(['native_ad_variants.tags'], tags));
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'native_ad_meta_data.affiliate_data',
        'native_ad_meta_data.clickbank_data',
        'native_ad_meta_data.built_with',
      ],
      bw
    ));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('native_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const filtered = src.filter(s => s !== 'all');
    if (filtered.length === 0) return null;
    return asFilter(termFilter('native_ad.source', filtered));
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('native_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      [
        'native_ad_meta_data.affiliate_data',
        'native_ad_meta_data.built_with',
        'native_ad_meta_data.clickbank_data',
      ],
      a
    ));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    const fields = [
      'native_ad_url.url_destination',
      'native_ad_outgoing_links.source_url',
      'native_ad_outgoing_links.redirect_url',
      'native_ad_outgoing_links.final_url',
      'native_ad_url.url_redirects',
      'native_ad_meta_data.destination_url',
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

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('lang_detect', ld));
  }

  _rangeEnv(field, vals) {
    if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
    return asFilter({ range: { [field]: { gte: parseInt(vals[0], 10), lte: parseInt(vals[1], 10) } } });
  }

  _getLikesEnv()    { return this._rangeEnv('native_ad.likes', this._params.likes); }
  _getCommentsEnv() { return this._rangeEnv('native_ad.comments', this._params.comments); }

  _getVerifiedEnv() {
    const v = this._params.verified;
    if (v === '' || v === undefined || v === null || v === 'NA') return null;
    return asFilter({ term: { 'native_ad_post_owners.verified': v } });
  }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(['native_country_only.country'], nc);
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { 'native_ad.id': String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv', '_getStateEnv', '_getCityEnv',
      '_getNetworkEnv', '_getCallToActionEnv', '_getAdCategoryEnv',
      '_getSubCategoryEnv', '_getCategoryEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getAdSubPositionEnv', '_getGenderEnv',
      '_getLangDetectEnv', '_getVerifiedEnv',
      '_getTargetKeywordEnv', '_getTagsEnv',
      '_getBuiltWithEnv', '_getTrackEnv', '_getSourceEnv',
      '_getFunnelEnv', '_getAffiliateEnv', '_getMarketPlatformEnv',
      '_getLowerAgeSeenEnv', '_getLastSeenEnv', '_getPostDateEnv',
      '_getDomainDateEnv', '_getNeedleEnv',
      '_getLikesEnv', '_getCommentsEnv',
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
        'native_country_only.country.keyword',
        'native_country_only.country',
        { includeWildcard: false }
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { 'native_ad.id': 'desc' }];
    const sort = isPriorityOffset ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: NativeSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

NativeSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'native_ad.id',
  'native_ad.days_running',
  'native_ad.type',
  'native_ad.ad_position',
  'native_ad.ad_sub_position',
  'native_ad.post_date',
  'native_ad.first_seen',
  'native_ad.last_seen',
  'native_ad.post_owner_id',
  'native_ad.nas_url',
  'native_ad_post_owners.post_owner_name',
  'native_ad_post_owners.post_owner_image',
  'native_ad_meta_data.destination_url',
  'native_ad_meta_data.redirect_url',
  'native_ad_meta_data.built_with',
  'native_ad_meta_data.built_with_analytics_tracking',
  'native_ad_meta_data.affiliate_data',
  'native_ad_url.url_destination',
  'native_ad_url.url_redirects',
  'native_ad_variants.title',
  'native_ad_variants.text',
  'native_ad_variants.newsfeed_description',
  'native_ad_variants.image_url',
  'native_ad_outgoing_links.source_url',
  'native_ad_outgoing_links.redirect_url',
  'native_ad_outgoing_links.final_url',
  'native_ad_domains.domain',
  'native_ad_domains.domain_registered_date',
  'native_country_only.country',
  'networks.network',
  'new_nas_image_url',
  'lang_detect',
];

module.exports = NativeSearchQueryBuilder;
