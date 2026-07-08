'use strict';
require('dotenv').config();

/**
 * QuoraSearchQueryBuilder
 *
 * Builds Elasticsearch queries against the `quora_search_mix` index.
 * See the Facebook builder docstring for the full optimization rationale.
 */

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
} = require('../../common/helpers/esQueryHelpers');

const DEFAULT_QR_INDEX = process.env.QR_ELASTIC_INDEX || 'quora_search_mix';

const EXTRA_CONDITION = [{
  bool: {
    should: [
      // IMAGE — must have NAS image URL
      {
        bool: {
          filter: [
            { term: { 'quora_ad.type.keyword': 'IMAGE' } },
            { exists: { field: 'new_nas_image_url' } },
          ],
        },
      },
      // VIDEO — shared NAS field + thumbnail
      {
        bool: {
          filter: [
            { term: { 'quora_ad.type.keyword': 'VIDEO' } },
            { exists: { field: 'new_nas_image_url' } },
            { exists: { field: 'thumbnail' } },
          ],
        },
      },
      { bool: { must_not: [{ terms: { 'quora_ad.type.keyword': ['IMAGE', 'VIDEO'] } }] } },
    ],
    minimum_should_match: 1,
  },
}];

class QuoraSearchQueryBuilder {
  constructor(indexName) {
    this._indexName = indexName || DEFAULT_QR_INDEX;
    this._from = 0; this._size = 20;
    this._sortField = 'quora_ad.last_seen'; this._sortMethod = 'desc';
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
  setCallToAction(v)   { this._params.callToAction = Array.isArray(v) ? v : [v]; return this; }
  setAdCategory(v)     { this._params.adCategory = Array.isArray(v) ? v : [v]; return this; }
  setSubCategory(v)    { this._params.subCategory = Array.isArray(v) ? v : [v]; return this; }
  setAdType(v)         { this._params.type = Array.isArray(v) ? v : [v]; return this; }
  setAdPosition(v)     { this._params.adPosition = Array.isArray(v) ? v : [v]; return this; }
  setGender(v)         { this._params.gender = Array.isArray(v) ? v : [v]; return this; }
  setStatus(v)         { this._params.status = Array.isArray(v) ? v : [v]; return this; }
  setTags(v)           { this._params.tags = Array.isArray(v) ? v : [v]; return this; }
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
      'quora_ad_variants.title', 'quora_ad_variants.title_ru', 'quora_ad_variants.title_fr', 'quora_ad_variants.title_sp',
      'quora_ad_variants.text', 'quora_ad_variants.text_ru', 'quora_ad_variants.text_fr', 'quora_ad_variants.text_sp',
      'quora_ad_variants.newsfeed_description', 'quora_ad_variants.newsfeed_description_ru', 'quora_ad_variants.newsfeed_description_fr', 'quora_ad_variants.newsfeed_description_sp',
      'quora_ad_translation.ad_text', 'quora_ad_translation.news_feed_description', 'quora_ad_translation.ad_title',
    ];
    if (kw.includes('"')) {
      return asMust({
        multi_match: {
          query: kw.replace(/"/g, ''),
          type: 'phrase',
          fields: [
            ...fields,
            'quora_ad_variants.title_exactly', 'quora_ad_variants.text_exactly', 'quora_ad_variants.newsfeed_description_exactly',
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
      'quora_ad_post_owners.post_owner_name', 'quora_ad_post_owners.post_owner_name_ru',
      'quora_ad_post_owners.post_owner_name_fr', 'quora_ad_post_owners.post_owner_name_sp',
      'quora_ad_post_owners.post_owner_name_ge', 'quora_ad_post_owners.post_owner_name_exactly',
    ];
    const clean = name.replace(/"/g, '');
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, clean),
          { prefix: { 'quora_ad_post_owners.post_owner_name': clean.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    const fields = [
      'quora_ad_variants.image_ocr', 'quora_ad_variants.image_ocr_ru',
      'quora_ad_variants.image_ocr_fr', 'quora_ad_variants.image_ocr_sp',
    ];
    if (ocr.includes('"')) {
      return asMust({
        multi_match: {
          query: ocr.replace(/"/g, ''),
          type: 'phrase',
          fields: ['quora_ad_variants.image_ocr', 'quora_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, ocr));
  }

  _imageArrayEnv(base, vals) {
    if (!vals || !vals.length) return null;
    return asMust(multiFieldMatchFilter(
      [
        `quora_ad_variants.${base}`,
        `quora_ad_variants.${base}_ru`,
        `quora_ad_variants.${base}_fr`,
        `quora_ad_variants.${base}_sp`,
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
    const f = [
      'quora_ad_html_lander_content.html_whitehat_lander_text',
      'quora_ad_html_lander_content.html_res_blackhat_lander_text',
      'quora_ad_html_lander_content.html_dc_blackhat_lander_text',
    ];
    if (hc.includes('"')) {
      return asMust({ multi_match: { query: hc.replace(/"/g, ''), type: 'phrase', fields: f } });
    }
    return asMust(phraseAcrossFields(f, hc));
  }

  // ─── filter context ──

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; }
    catch { domain = url.split('/')[0]; }
    return asFilter({ wildcard: { 'quora_ad_meta_data.destination_url': `*${domain}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['quora_country_only.country'], c));
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
    return asFilter(termFilterCI('quora_call_to_action.call_to_action.keyword', cta));
  }

  _getAdCategoryEnv() {
    const cat = this._params.adCategory;
    if (!cat || !cat.length) return null;
    return asFilter(termFilter('quora.category.keyword', cat));
  }

  _getSubCategoryEnv() {
    const sub = this._params.subCategory;
    if (!sub || !sub.length) return null;
    return asFilter(termFilter('quora.subCategory.keyword', sub));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('quora_ad.type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length) return null;
    return asFilter(matchFilter('quora_ad.ad_position', ap));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('quora_user.gender', g));
  }

  _getTagsEnv() {
    const t = this._params.tags;
    if (!t || !t.length) return null;
    return asFilter(multiFieldMatchFilter(['quora_ad_variants.tags'], t));
  }

  _getLowerAgeSeenEnv() {
    const a = this._params.lowerAgeSeen;
    if (!a || !a.lower_age || !a.upper_age) return null;
    return asFilter({ range: { 'quora_ad.lower_age_seen': { gte: parseInt(a.lower_age, 10), lte: parseInt(a.upper_age, 10) } } });
  }

  _getLastSeenEnv() {
    const ls = this._params.lastSeen;
    if (!ls || !ls.lower_date || !ls.upper_date) return null;
    return asFilter({ range: { 'quora_ad.last_seen': { gte: ls.lower_date, lte: ls.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } } });
  }

  _getPostDateEnv() {
    const pd = this._params.postDate;
    if (!pd || !pd.lower_date || !pd.upper_date) return null;
    return asFilter({ range: { 'quora_ad.post_date': { gte: pd.lower_date, lte: pd.upper_date, format: "yyyy-MM-dd' 'HH:mm:ss" } } });
  }

  _getDomainDateEnv() {
    const dd = this._params.domainDate;
    if (!dd || !dd.lower_date || !dd.upper_date) return null;
    return asFilter({ range: { 'quora_ad_domain.domain_registered_date': { gte: dd.lower_date, lte: dd.upper_date, format: 'yyyy-MM-dd' } } });
  }

  _getNeedleEnv() {
    const n = this._params.needle;
    if (!n) return null;
    if (this._ipBasedCountry && this._from < 10000 && (!this._params.country || !this._params.country.length)) return null;
    return asFilter({ range: { 'quora_ad.last_seen': { lt: n } } });
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['quora_ad_meta_data.affiliate_data', 'quora_ad_meta_data.clickbank_data', 'quora_ad_meta_data.built_with'],
      bw
    ));
  }

  _getTrackEnv() {
    const t = this._params.track;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('quora_ad_url.url', t));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length) return null;
    const fm = {
      desktop: 'quora_ad_meta_data.firstSeenOnDesktop',
      ios: 'quora_ad_meta_data.firstSeenOnIos',
      android: 'quora_ad_meta_data.firstSeenOnAndroid',
    };
    const fields = [];
    for (const s of src) {
      if (s === 'all') fields.push(fm.desktop, fm.ios, fm.android);
      else if (fm[s]) fields.push(fm[s]);
    }
    const unique = [...new Set(fields)];
    if (!unique.length) return null;
    if (unique.length === 1) return asFilter({ exists: { field: unique[0] } });
    return asFilter({ bool: { should: unique.map(f => ({ exists: { field: f } })), minimum_should_match: 1 } });
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('quora_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['quora_ad_meta_data.affiliate_data', 'quora_ad_meta_data.built_with', 'quora_ad_meta_data.clickbank_data'],
      a
    ));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    const fields = [
      'quora_ad_url.url_destination', 'quora_ad_outgoing_links.source_url',
      'quora_ad_outgoing_links.redirect_url', 'quora_ad_outgoing_links.final_url',
      'quora_ad_url.url_redirects', 'quora_ad_meta_data.destination_url',
    ];
    const should = [];
    for (const v of mp) {
      const value = `*${v}*`;
      for (const f of fields) should.push({ wildcard: { [f]: { value } } });
    }
    return asFilter({ bool: { should, minimum_should_match: 1 } });
  }

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('lang_detect', ld));
  }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(['quora_country_only.country'], nc);
  }

  _getAdDetailIdExclude() {
    const id = this._params.adDetailId;
    if (!id) return null;
    return { term: { 'quora_ad.id': String(id) } };
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv', '_getStateEnv', '_getCityEnv',
      '_getCallToActionEnv', '_getAdCategoryEnv', '_getSubCategoryEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getGenderEnv',
      '_getTagsEnv', '_getLangDetectEnv',
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
        'quora_country_only.country.keyword',
        'quora_country_only.country',
        { includeWildcard: false }
      );
    }

    const baseSort = [{ [this._sortField]: this._sortMethod }, { 'quora_ad.id': 'desc' }];
    const sort = isPrio ? [{ _score: 'desc' }, ...baseSort] : baseSort;

    const body = {
      from: this._from,
      size: this._size,
      sort,
      query: partBody,
      _source: QuoraSearchQueryBuilder.SEARCH_SOURCE_FIELDS,
      ...paginationDefaults(),
    };

    if (shouldProfile(this._profile)) body.profile = true;

    return { index: this._indexName, body };
  }
}

QuoraSearchQueryBuilder.SEARCH_SOURCE_FIELDS = [
  'quora_ad.id',
  'quora_ad.days_running',
  'lang_detect',
  'new_nas_image_url',
  'quora_ad.type',
  'quora_ad_url.url_destination',
  'quora_ad_url.url_redirects',
  'quora_ad_outgoing_links.source_url',
  'quora_ad_outgoing_links.redirect_url',
  'quora_ad_outgoing_links.final_url',
  'quora_ad_meta_data.destination_url',
];

module.exports = QuoraSearchQueryBuilder;
