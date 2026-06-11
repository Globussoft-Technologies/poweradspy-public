'use strict';
require('dotenv').config();

/**
 * PinterestSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `pinterest_search_mix` index.
 * Same optimization pass as the Facebook builder; see that file for the
 * detailed explanation.
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

const DEFAULT_PIN_INDEX = process.env.PIN_ELASTIC_INDEX || 'pinterest_search_mix';

const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              { term: { 'pinterest_ad.type.keyword': 'IMAGE' } },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            filter: [
              { term: { 'pinterest_ad.type.keyword': 'VIDEO' } },
              { exists: { field: 'thumbnail' } },
            ],
          },
        },
        { bool: { must_not: [{ terms: { 'pinterest_ad.type.keyword': ['IMAGE', 'VIDEO'] } }] } },
      ],
      minimum_should_match: 1,
    },
  },
];

class PinterestSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_PIN_INDEX;
    this._from = 0; this._size = 20;
    this._sortField = 'pinterest_ad.last_seen'; this._sortMethod = 'desc';
    this._ipBasedCountry = '';
    this._profile = undefined;
    this._params = {};
  }

  setFrom(v) { this._from = parseInt(v, 10) || 0; return this; }
  setSize(v) { this._size = parseInt(v, 10) || 20; return this; }
  setSortField(f) { this._sortField = f; return this; }
  setSortMethod(v) { if (v === 'asc' || v === 'desc') this._sortMethod = v; return this; }
  setIpBasedCountry(v) { this._ipBasedCountry = (v && v !== 'NA') ? v : ''; return this; }
  setProfile(v) { this._profile = v; return this; }

  setKeyword(v)        { this._params.keyword = v; return this; }
  setPostOwnerName(v)  { this._params.postOwnerName = v; return this; }
  setUrl(v)            { this._params.url = v; return this; }
  setCountry(v)        { this._params.country = Array.isArray(v) ? v : [v]; return this; }
  setState(v)          { this._params.state = Array.isArray(v) ? v : [v]; return this; }
  setCity(v)           { this._params.city = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v)     { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v)    { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v)         { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v)     { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setAdSubPosition(v)  { this._params.adSubPosition = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v)         { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTargetKeyword(v)  { this._params.targetKeyword = Array.isArray(v) ? v : [v]; return this; }
  setBuiltWith(v)      { this._params.builtWith = Array.isArray(v) ? v : [v]; return this; }
  setTrack(v)          { this._params.track = Array.isArray(v) ? v : [v]; return this; }
  setSource(v)         { this._params.source = Array.isArray(v) ? v : [v]; return this; }
  setFunnel(v)         { this._params.funnel = Array.isArray(v) ? v : [v]; return this; }
  setAffiliate(v)      { this._params.affiliate = Array.isArray(v) ? v : [v]; return this; }
  setMarketPlatform(v) { this._params.marketPlatform = Array.isArray(v) ? v : [v]; return this; }
  setLangDetect(v)     { this._params.langDetect = Array.isArray(v) ? v : [v]; return this; }
  setNotCountry(v)     { this._params.notCountry = v; return this; }
  setAdDetailId(v)     { this._params.adDetailId = v; return this; }
  setNeedle(v)         { this._params.needle = (v && v !== 'NA') ? v : ''; return this; }
  setLastSeen(v)       { this._params.lastSeen = v; return this; }
  setPostDate(v)       { this._params.postDate = v; return this; }
  setDomainDate(v)     { this._params.domainDate = v; return this; }
  setLowerAgeSeen(v)   { this._params.lowerAgeSeen = v; return this; }
  setOcr(v)            { this._params.ocr = v; return this; }
  setCelebrity(v)      { this._params.celebrity = Array.isArray(v) ? v : [v]; return this; }
  setImageObject(v)    { this._params.imageObject = Array.isArray(v) ? v : [v]; return this; }
  setLogo(v)           { this._params.logo = Array.isArray(v) ? v : [v]; return this; }
  setHtmlContent(v)    { this._params.htmlContent = v; return this; }

  // ─── must (relevance) ──

  _getKeywordEnv() {
    const kw = this._params.keyword;
    if (!kw) return null;
    const fields = [
      'pinterest_ad_variants.title','pinterest_ad_variants.title_ru','pinterest_ad_variants.title_fr','pinterest_ad_variants.title_sp','pinterest_ad_variants.title_ge',
      'pinterest_ad_variants.text','pinterest_ad_variants.text_ru','pinterest_ad_variants.text_fr','pinterest_ad_variants.text_sp','pinterest_ad_variants.text_ge',
      'pinterest_ad_variants.newsfeed_description','pinterest_ad_variants.newsfeed_description_ru','pinterest_ad_variants.newsfeed_description_fr','pinterest_ad_variants.newsfeed_description_sp','pinterest_ad_variants.newsfeed_description_ge',
    ];
    if (kw.includes('"')) {
      return asMust({
        multi_match: {
          query: kw.replace(/"/g, ''),
          type: 'phrase',
          fields: [
            ...fields,
            'pinterest_ad_variants.title_exactly',
            'pinterest_ad_variants.text_exactly',
            'pinterest_ad_variants.newsfeed_description_exactly',
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
      'pinterest_ad_post_owners.post_owner_name','pinterest_ad_post_owners.post_owner_name_ru',
      'pinterest_ad_post_owners.post_owner_name_fr','pinterest_ad_post_owners.post_owner_name_sp',
      'pinterest_ad_post_owners.post_owner_name_ge','pinterest_ad_post_owners.post_owner_name_exactly',
    ];
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['pinterest_ad_post_owners.post_owner_name_exactly'],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, name),
          { prefix: { 'pinterest_ad_post_owners.post_owner_name': name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const o = this._params.ocr;
    if (!o) return null;
    const fields = [
      'pinterest_ad_variants.image_ocr','pinterest_ad_variants.image_ocr_ru',
      'pinterest_ad_variants.image_ocr_fr','pinterest_ad_variants.image_ocr_sp',
    ];
    if (o.includes('"')) {
      return asMust({
        multi_match: {
          query: o.replace(/"/g, ''),
          type: 'phrase',
          fields: ['pinterest_ad_variants.image_ocr','pinterest_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, o));
  }

  _imageArrayEnv(base, vals) {
    if (!vals || !vals.length) return null;
    return asMust(multiFieldMatchFilter(
      [
        `pinterest_ad_variants.${base}`,
        `pinterest_ad_variants.${base}_ru`,
        `pinterest_ad_variants.${base}_fr`,
        `pinterest_ad_variants.${base}_sp`,
      ],
      vals
    ));
  }

  _getCelebrityEnv()   { return this._imageArrayEnv('image_celebrity', this._params.celebrity); }
  _getImageObjectEnv() { return this._imageArrayEnv('image_object', this._params.imageObject); }
  _getLogoEnv()        { return this._imageArrayEnv('image_brand_logo', this._params.logo); }

  _getHtmlContentEnv() {
    const h = this._params.htmlContent;
    if (!h) return null;
    const f = [
      'pinterest_ad_html_lander_content.html_whitehat_lander_text',
      'pinterest_ad_html_lander_content.html_res_blackhat_lander_text',
      'pinterest_ad_html_lander_content.html_dc_blackhat_lander_text',
    ];
    if (h.includes('"')) {
      return asMust({ multi_match: { query: h.replace(/"/g, ''), type: 'phrase', fields: f } });
    }
    return asMust(phraseAcrossFields(f, h));
  }

  // ─── filter context ──

  _getUrlEnv() {
    const u = this._params.url;
    if (!u) return null;
    let d;
    try { d = new URL(u.startsWith('http') ? u : `http://${u}`).hostname; } catch { d = u.split('/')[0]; }
    return asFilter({ wildcard: { 'pinterest_ad_meta_data.destination_url': `*${d}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['pinterest_country_only.country'], c));
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

  _getAdCategoryEnv() {
    const c = this._params.adCategory;
    if (!c || !c.length) return null;
    return asFilter(termFilter('pinterest.category.keyword', c));
  }

  _getSubCategoryEnv() {
    const s = this._params.subCategory;
    if (!s || !s.length) return null;
    return asFilter(termFilter('pinterest.subCategory.keyword', s));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('pinterest_ad.type', t));
  }

  _getAdPositionEnv() {
    const a = this._params.adPosition;
    if (!a || !a.length) return null;
    return asFilter(matchFilter('pinterest_ad.ad_position', a));
  }

  _getAdSubPositionEnv() {
    const a = this._params.adSubPosition;
    if (!a || !a.length) return null;
    return asFilter(matchFilter('pinterest_ad.ad_sub_position', a));
  }

  _getTargetKeywordEnv() {
    const t = this._params.targetKeyword;
    if (!t || !t.length) return null;
    return asFilter(multiFieldMatchFilter(['pinterest_ad_variants.target_keyword'], t));
  }

  _getLowerAgeSeenEnv() {
    const a = this._params.lowerAgeSeen;
    if (!a || !a.lower_age || !a.upper_age) return null;
    return asFilter({ range: { 'pinterest_ad.lower_age_seen': { gte: parseInt(a.lower_age, 10), lte: parseInt(a.upper_age, 10) } } });
  }

  _getLastSeenEnv() {
    const l = this._params.lastSeen;
    if (!l || !l.lower_date || !l.upper_date) return null;
    return asFilter({ range: { 'pinterest_ad.last_seen': { gte: l.lower_date, lte: l.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } } });
  }

  _getPostDateEnv() {
    const p = this._params.postDate;
    if (!p || !p.lower_date || !p.upper_date) return null;
    return asFilter({ range: { 'pinterest_ad.post_date': { gte: p.lower_date, lte: p.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } } });
  }

  _getDomainDateEnv() {
    const d = this._params.domainDate;
    if (!d || !d.lower_date || !d.upper_date) return null;
    return asFilter({ range: { 'pinterest_ad_domains.domain_registered_date': { gte: d.lower_date, lte: d.upper_date, format: 'yyyy-MM-dd' } } });
  }

  _getNeedleEnv() {
    const n = this._params.needle;
    if (!n) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) return null;
    return asFilter({ range: { 'pinterest_ad.last_seen': { lt: n } } });
  }

  _getBuiltWithEnv() {
    const b = this._params.builtWith;
    if (!b || !b.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['pinterest_ad_meta_data.built_with','pinterest_ad_meta_data.affiliate_data','pinterest_ad_meta_data.clickbank_data'],
      b
    ));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('pinterest_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const fm = {
      desktop: 'pinterest_ad_meta_data.firstSeenOnDesktop',
      ios: 'pinterest_ad_meta_data.firstSeenOnIos',
      android: 'pinterest_ad_meta_data.firstSeenOnAndroid',
    };
    const fields = [];
    for (const s of src) { if (s === 'all') fields.push(fm.desktop, fm.ios, fm.android); else if (fm[s]) fields.push(fm[s]); }
    const unique = [...new Set(fields)];
    if (!unique.length) return null;
    if (unique.length === 1) return asFilter({ exists: { field: unique[0] } });
    return asFilter({ bool: { should: unique.map(f => ({ exists: { field: f } })), minimum_should_match: 1 } });
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('pinterest_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['pinterest_ad_meta_data.affiliate_data','pinterest_ad_meta_data.built_with','pinterest_ad_meta_data.clickbank_data'],
      a
    ));
  }

  _getMarketPlatformEnv() {
    const m = this._params.marketPlatform;
    if (!m || !m.length) return null;
    const fields = [
      'pinterest_ad_url.url_destination','pinterest_ad_outgoing_links.source_url',
      'pinterest_ad_outgoing_links.redirect_url','pinterest_ad_outgoing_links.final_url',
      'pinterest_ad_url.url_redirects','pinterest_ad_meta_data.destination_url',
    ];
    const should = [];
    for (const v of m) {
      const value = `*${v}*`;
      for (const f of fields) should.push({ wildcard: { [f]: { value } } });
    }
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getLangDetectEnv() {
    const l = this._params.langDetect;
    if (!l || !l.length) return null;
    return asFilter(matchFilter('lang_detect', l));
  }

  // must_not collectors

  _getNotCountryClause() {
    const n = this._params.notCountry;
    if (!n) return null;
    return multiFieldMatchFilter(['pinterest_country_only.country'], n);
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { 'pinterest_ad.id': String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv', '_getStateEnv', '_getCityEnv',
      '_getAdCategoryEnv', '_getSubCategoryEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getAdSubPositionEnv',
      '_getTargetKeywordEnv',
      '_getLangDetectEnv',
      '_getBuiltWithEnv', '_getTrackEnv', '_getSourceEnv',
      '_getFunnelEnv', '_getAffiliateEnv', '_getMarketPlatformEnv',
      '_getLowerAgeSeenEnv', '_getLastSeenEnv', '_getPostDateEnv',
      '_getDomainDateEnv', '_getNeedleEnv',
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

    const isPrio = this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length);
    if (this._ipBasedCountry) {
      partBody = wrapWithCountryBoost(
        partBody,
        this._ipBasedCountry,
        'pinterest_country_only.country.keyword',
        'pinterest_country_only.country',
        { includeWildcard: false }
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { 'pinterest_ad.id': 'desc' }];
    const sort = isPrio ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: PinterestSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

PinterestSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'pinterest_ad.id',
  'pinterest_ad.days_running',
  'new_nas_image_url',
  'nas_video_url',
  'pinterest_ad_url.url_destination',
  'pinterest_ad_url.url_redirects',
  'pinterest_ad_outgoing_links.source_url',
  'pinterest_ad_outgoing_links.redirect_url',
  'pinterest_ad_outgoing_links.final_url',
  'pinterest_ad_meta_data.destination_url',
];

module.exports = PinterestSearchQueryBuilder;
