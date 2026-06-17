'use strict';

/**
 * SearchMixQueryBuilder for GDN (Google Display Network)
 *
 * Index uses prefixed field names (`gdn_ad.*`, `gdn_ad_variants.*`, …).
 * No IP-based country boost.
 *
 * Optimization summary (see common/helpers/esQueryHelpers.js for the
 * shared infrastructure):
 *   - Flat bool with separate must/filter/must_not arrays.
 *   - All exact-match codes (type, adPosition, adSubPosition, status,
 *     callToAction, langDetect, source, builtWith, funnel, affiliate,
 *     country) moved to filter context and emitted as `match`/`terms`
 *     instead of `query_string`.
 *   - Keyword/postOwnerName/OCR/htmlContent etc. continue to score in
 *     `must` but go through `multi_match` rather than `query_string`.
 *   - Image-size width/height ranges live in filter context (always did,
 *     just made explicit).
 */

const {
  flatBool,
  termFilter,
  matchFilter,
  multiFieldMatchFilter,
  phraseAcrossFields,
  asFilter,
  asMust,
  bucketize,
  paginationDefaults,
  shouldProfile,
} = require('../../common/helpers/esQueryHelpers');

const EXTRA_CONDITION = [
  {
    bool: {
      should: [
        {
          bool: {
            filter: [
              {
                bool: {
                  should: [
                    { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                    { term: { 'gdn_ad.type.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
              { exists: { field: 'new_nas_image_url' } },
            ],
          },
        },
        {
          bool: {
            must_not: [
              {
                bool: {
                  should: [
                    { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                    { term: { 'gdn_ad.type.keyword': '' } },
                  ],
                  minimum_should_match: 1,
                },
              },
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
    this._indexName  = indexName || 'gdn_search_mix_v2';
    this._from       = 0;
    this._size       = 20;
    this._sortField  = 'gdn_ad.last_seen';
    this._sortMethod = 'desc';
    this._profile    = undefined;
    this._params     = {};
  }

  setFrom(v)       { this._from  = parseInt(v, 10) || 0;  return this; }
  setSize(v)       { this._size  = parseInt(v, 10) || 20; return this; }
  setSortField(f)  { this._sortField  = f;                return this; }
  setSortMethod(v) { if (v === 'asc' || v === 'desc') this._sortMethod = v; return this; }
  setProfile(v)    { this._profile = v;                   return this; }

  setKeyword(v)          { this._params.keyword       = v;                               return this; }
  setPostOwnerName(v)    { this._params.postOwnerName = v;                               return this; }
  setUrl(v)              { this._params.url           = v;                               return this; }
  setCountry(v)          { this._params.country       = Array.isArray(v) ? v : [v];     return this; }
  setAdType(v)           { this._params.type          = Array.isArray(v) ? v : [v];     return this; }
  setAdPosition(v)       { this._params.adPosition    = Array.isArray(v) ? v : [v];     return this; }
  setAdSubPosition(v)    { this._params.adSubPosition = Array.isArray(v) ? v : [v];     return this; }
  setStatus(v)           { this._params.status        = Array.isArray(v) ? v : [v];     return this; }
  setCallToAction(v)     { this._params.callToAction  = Array.isArray(v) ? v : [v];     return this; }
  setAdCategory(v)       { this._params.adCategory    = Array.isArray(v) ? v : [v];     return this; }
  setSubCategory(v)      { this._params.subCategory   = Array.isArray(v) ? v : [v];     return this; }
  setTags(v)             { this._params.tags          = Array.isArray(v) ? v : [v];     return this; }
  setTargetKeyword(v)    { this._params.targetKeyword = Array.isArray(v) ? v : [v];     return this; }
  setBuiltWith(v)        { this._params.builtWith     = Array.isArray(v) ? v : [v];     return this; }
  setSource(v)           { this._params.source        = Array.isArray(v) ? v : [v];     return this; }
  setFunnel(v)           { this._params.funnel        = Array.isArray(v) ? v : [v];     return this; }
  setAffiliate(v)        { this._params.affiliate     = Array.isArray(v) ? v : [v];     return this; }
  setLangDetect(v)       { this._params.langDetect    = Array.isArray(v) ? v : [v];     return this; }
  setGender(v)           { this._params.gender        = Array.isArray(v) ? v : [v];     return this; }
  setNotCountry(v)       { this._params.notCountry    = v;                               return this; }
  setNeedle(v)           { this._params.needle        = (v && v !== 'NA') ? v : '';     return this; }
  setOcr(v)              { this._params.ocr           = v;                               return this; }
  setCelebrity(v)        { this._params.celebrity     = Array.isArray(v) ? v : [v];     return this; }
  setLogo(v)             { this._params.logo          = Array.isArray(v) ? v : [v];     return this; }
  setImageObject(v)      { this._params.imageObject   = Array.isArray(v) ? v : [v];     return this; }
  setMarketPlatform(v)   { this._params.marketPlatform = Array.isArray(v) ? v : [v];   return this; }
  setHtmlContent(v)      { this._params.htmlContent   = v;                               return this; }
  setAdImageSize(v)      { this._params.adImageSize   = v;                               return this; }

  setLastSeen(v)     { this._params.lastSeen    = v; return this; }
  setPostDate(v)     { this._params.postDate    = v; return this; }
  setDomainDate(v)   { this._params.domainDate  = v; return this; }
  setLowerAgeSeen(v) { this._params.lowerAgeSeen = v; return this; }

  // ─── Clause generators ──

  _kwFields() {
    return [
      'gdn_ad_variants.title', 'gdn_ad_variants.title_ru', 'gdn_ad_variants.title_fr',
      'gdn_ad_variants.title_sp', 'gdn_ad_variants.title_ge',
      'gdn_ad_variants.text', 'gdn_ad_variants.text_ru', 'gdn_ad_variants.text_fr',
      'gdn_ad_variants.text_sp', 'gdn_ad_variants.text_ge',
      'gdn_ad_variants.newsfeed_description', 'gdn_ad_variants.newsfeed_description_ru',
      'gdn_ad_variants.newsfeed_description_fr', 'gdn_ad_variants.newsfeed_description_sp',
      'gdn_ad_variants.newsfeed_description_ge',
      'gdn_ad_translation.ad_text', 'gdn_ad_translation.news_feed_description', 'gdn_ad_translation.ad_title',
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
            'gdn_ad_variants.title_exactly', 'gdn_ad_variants.text_exactly',
            'gdn_ad_variants.newsfeed_description_exactly',
            ...fields,
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
      'gdn_ad_post_owners.post_owner_name', 'gdn_ad_post_owners.post_owner_name_ru',
      'gdn_ad_post_owners.post_owner_name_fr', 'gdn_ad_post_owners.post_owner_name_sp',
      'gdn_ad_post_owners.post_owner_name_ge', 'gdn_ad_post_owners.post_owner_name_exactly',
    ];
    if (name.includes('"')) {
      return asMust({
        multi_match: {
          query: name.replace(/"/g, ''),
          type: 'phrase',
          fields: ['gdn_ad_post_owners.post_owner_name_exactly', 'gdn_ad_post_owners.post_owner_name'],
        },
      });
    }
    return asMust({
      bool: {
        should: [
          phraseAcrossFields(fields, name),
          { prefix: { 'gdn_ad_post_owners.post_owner_name': name.toLowerCase() } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  _getOcrEnv() {
    const ocr = this._params.ocr;
    if (!ocr) return null;
    const fields = [
      'gdn_ad_variants.image_ocr', 'gdn_ad_variants.image_ocr_ru',
      'gdn_ad_variants.image_ocr_fr', 'gdn_ad_variants.image_ocr_sp',
    ];
    if (ocr.includes('"')) {
      return asMust({
        multi_match: {
          query: ocr.replace(/"/g, ''),
          type: 'phrase',
          fields: ['gdn_ad_variants.image_ocr', 'gdn_ad_variants.image_ocr_exactly'],
        },
      });
    }
    return asMust(phraseAcrossFields(fields, ocr));
  }

  _imageArrayEnv(fieldBase, vals) {
    if (!vals || !vals.length) return null;
    return asMust(multiFieldMatchFilter(
      [
        `gdn_ad_variants.${fieldBase}`,
        `gdn_ad_variants.${fieldBase}_ru`,
        `gdn_ad_variants.${fieldBase}_fr`,
        `gdn_ad_variants.${fieldBase}_sp`,
      ],
      vals
    ));
  }

  _getCelebrityEnv()   { return this._imageArrayEnv('image_celebrity', this._params.celebrity); }
  _getLogoEnv()        { return this._imageArrayEnv('image_brand_logo', this._params.logo); }
  _getImageObjectEnv() { return this._imageArrayEnv('image_object', this._params.imageObject); }

  _getHtmlContentEnv() {
    const html = this._params.htmlContent;
    if (!html) return null;
    const fields = [
      'gdn_ad_html_lander_content.html_whitehat_lander_text',
      'gdn_ad_html_lander_content.html_res_blackhat_lander_text',
      'gdn_ad_html_lander_content.html_dc_blackhat_lander_text',
    ];
    if (html.includes('"')) {
      return asMust({ multi_match: { query: html.replace(/"/g, ''), type: 'phrase', fields } });
    }
    return asMust(phraseAcrossFields(fields, html));
  }

  // ─── Filter context ──

  _getUrlEnv() {
    const url = this._params.url;
    if (!url) return null;
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : `http://${url}`).hostname; }
    catch { domain = url.split('/')[0]; }
    return asFilter({ wildcard: { 'gdn_ad_url.url': `*${domain}*` } });
  }

  _getCountryEnv() {
    const c = this._params.country;
    if (!c || !c.length) return null;
    return asFilter(multiFieldMatchFilter(['gdn_country_only.country'], c));
  }

  _getTypeEnv() {
    const t = this._params.type;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('gdn_ad.type', t));
  }

  _getAdPositionEnv() {
    const ap = this._params.adPosition;
    if (!ap || !ap.length) return null;
    return asFilter(matchFilter('gdn_ad.ad_position', ap));
  }

  _getAdSubPositionEnv() {
    const asp = this._params.adSubPosition;
    if (!asp || !asp.length) return null;
    return asFilter(matchFilter('gdn_ad.ad_sub_position', asp));
  }

  _getStatusEnv() {
    const s = this._params.status;
    if (!s || !s.length) return null;
    return asFilter(matchFilter('gdn_ad.status', s));
  }

  _getCallToActionEnv() {
    const cta = this._params.callToAction;
    if (!cta || !cta.length) return null;
    return asFilter(matchFilter('gdn_call_to_actions.action', cta));
  }

  _getAdCategoryEnv() {
    const c = this._params.adCategory;
    if (!c || !c.length) return null;
    return asFilter(termFilter('gdn.category.keyword', c));
  }

  _getSubCategoryEnv() {
    const c = this._params.subCategory;
    if (!c || !c.length) return null;
    return asFilter(termFilter('gdn.subCategory.keyword', c));
  }

  _getTagsEnv() {
    const t = this._params.tags;
    if (!t || !t.length) return null;
    return asFilter(matchFilter('gdn_ad_variants.tags', t));
  }

  _getTargetKeywordEnv() {
    const tk = this._params.targetKeyword;
    if (!tk || !tk.length) return null;
    return asFilter(matchFilter('gdn_ad_variants.target_keyword', tk));
  }

  _getGenderEnv() {
    const g = this._params.gender;
    if (!g || !g.length) return null;
    return asFilter(matchFilter('gdn_user.gender', g));
  }

  _getLowerAgeSeenEnv() {
    const age = this._params.lowerAgeSeen;
    if (!age || !age.lower_age || !age.upper_age) return null;
    return asFilter({
      range: {
        'gdn_ad.lower_age_seen': {
          gte: parseInt(age.lower_age, 10), lte: parseInt(age.upper_age, 10),
        },
      },
    });
  }

  _getLastSeenEnv() {
    const ls = this._params.lastSeen;
    if (!ls || !ls.lower_date || !ls.upper_date) return null;
    return asFilter({
      range: {
        'gdn_ad.last_seen': {
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
        'gdn_ad.post_date': {
          gte: pd.lower_date, lte: pd.upper_date,
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
        'gdn_ad_domains.domain_registered_date': {
          gte: dd.lower_date, lte: dd.upper_date, format: 'yyyy-MM-dd',
        },
      },
    });
  }

  _getNeedleEnv() {
    const needle = this._params.needle;
    if (!needle) return null;
    return asFilter({ range: { 'gdn_ad.last_seen': { lt: needle } } });
  }

  _getBuiltWithEnv() {
    const bw = this._params.builtWith;
    if (!bw || !bw.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['gdn_ad_meta_data.built_with', 'gdn_ad_meta_data.affiliate_data', 'gdn_ad_meta_data.clickbank_data'],
      bw
    ));
  }

  _getSourceEnv() {
    const src = this._params.source;
    if (!src || !src.length || src.includes('all')) return null;
    return asFilter(matchFilter('gdn_ad.source', src));
  }

  _getFunnelEnv() {
    const f = this._params.funnel;
    if (!f || !f.length) return null;
    return asFilter(matchFilter('gdn_ad_meta_data.built_with_analytics_tracking', f));
  }

  _getAffiliateEnv() {
    const a = this._params.affiliate;
    if (!a || !a.length) return null;
    return asFilter(multiFieldMatchFilter(
      ['gdn_ad_meta_data.affiliate_data', 'gdn_ad_meta_data.built_with', 'gdn_ad_meta_data.clickbank_data'],
      a
    ));
  }

  _getLangDetectEnv() {
    const ld = this._params.langDetect;
    if (!ld || !ld.length) return null;
    return asFilter(matchFilter('lang_detect', ld));
  }

  _getMarketPlatformEnv() {
    const mp = this._params.marketPlatform;
    if (!mp || !mp.length) return null;
    const fields = [
      'gdn_ad_url.url_destination', 'gdn_ad_url.url_redirects',
      'gdn_ad_outgoing_links.source_url', 'gdn_ad_outgoing_links.redirect_url', 'gdn_ad_outgoing_links.final_url',
      'gdn_ad_meta_data.destination_url', 'gdn_ad_meta_data.redirect_url',
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

  _getAdImageSizeEnvs() {
    const size = this._params.adImageSize;
    if (!size || typeof size !== 'string' || !size.includes('x')) return [];
    const parts = size.split('x');
    const width  = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (!width || !height) return [];
    return [
      asFilter({ range: { width:  { gte: width  - 50, lte: width  + 50 } } }),
      asFilter({ range: { height: { gte: height - 50, lte: height + 50 } } }),
    ];
  }

  // must_not collectors

  _getNotCountryClause() {
    const nc = this._params.notCountry;
    if (!nc) return null;
    return multiFieldMatchFilter(['gdn_country_only.country'], nc);
  }

  // ─── Query assembly ──

  _collectEnvelopes() {
    const generators = [
      '_getCountryEnv',
      '_getTypeEnv', '_getAdPositionEnv', '_getAdSubPositionEnv', '_getStatusEnv',
      '_getCallToActionEnv', '_getAdCategoryEnv', '_getSubCategoryEnv',
      '_getTagsEnv', '_getTargetKeywordEnv', '_getGenderEnv',
      '_getLangDetectEnv', '_getBuiltWithEnv', '_getSourceEnv',
      '_getFunnelEnv', '_getAffiliateEnv', '_getMarketPlatformEnv',
      '_getLowerAgeSeenEnv', '_getLastSeenEnv', '_getPostDateEnv',
      '_getDomainDateEnv', '_getNeedleEnv', '_getUrlEnv',
      '_getKeywordEnv', '_getPostOwnerNameEnv',
      '_getOcrEnv', '_getCelebrityEnv', '_getLogoEnv', '_getImageObjectEnv',
      '_getHtmlContentEnv',
    ];
    const out = [];
    for (const g of generators) {
      const env = this[g]();
      if (env) out.push(env);
    }
    out.push(...this._getAdImageSizeEnvs());
    return out;
  }

  build() {
    const envelopes = this._collectEnvelopes();
    const buckets = bucketize(envelopes);
    buckets.filter.push(...EXTRA_CONDITION);

    const nc = this._getNotCountryClause();
    if (nc) buckets.must_not.push(nc);

    const partBody = flatBool(buckets);

    const sort = [{ [this._sortField]: this._sortMethod }, { 'gdn_ad.id': 'desc' }];

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
  'gdn_ad.id',
  'gdn_ad.post_owner_id',
  'gdn_ad.ad_position',
  'gdn_ad.ad_sub_position',
  'gdn_ad.type',
  'gdn_ad.source',
  'gdn_ad.hits',
  'gdn_ad.days_running',
  'gdn_ad.first_seen',
  'gdn_ad.last_seen',
  'gdn_ad.post_date',
  'gdn_ad_post_owners.post_owner_image',
  'gdn_ad_post_owners.post_owner_name',
  'gdn_ad_variants.text',
  'gdn_ad_variants.title',
  'gdn_ad_variants.image_url',
  'gdn_ad_variants.newsfeed_description',
  'gdn_ad_meta_data.destination_url',
  'gdn_ad_meta_data.built_with',
  'gdn_ad_meta_data.built_with_analytics_tracking',
  'gdn_ad_meta_data.affiliate_data',
  'gdn_ad_meta_data.redirect_url',
  'gdn_ad_url.url_destination',
  'gdn_ad_url.url_redirects',
  'gdn_ad_outgoing_links.source_url',
  'gdn_ad_outgoing_links.redirect_url',
  'gdn_ad_outgoing_links.final_url',
  'gdn_country_only.country',
  'new_nas_image_url',
];

module.exports = SearchMixQueryBuilder;
