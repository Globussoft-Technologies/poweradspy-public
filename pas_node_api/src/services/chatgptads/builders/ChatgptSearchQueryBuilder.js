'use strict';

const {
  anySearchValueEnvelope,
  exactSearchValueClause,
} = require('../../common/helpers/esQueryHelpers');

/**
 * ChatgptSearchQueryBuilder — builds Elasticsearch queries against `chatgpt_search_mix`.
 *
 * Written fresh for this network (NOT a copy of facebook's SearchMixQueryBuilder): the
 * chatgpt_search_mix mapping uses FLAT field names and google_ads_data_v2's low-CPU
 * conventions (see docs/insertion/chatgptads/MANIFEST.md §4), so every clause here follows
 * the same rules the mapping was designed for:
 *   - exact-match filters (country, advertiser, domain, status) → `term`/`terms` on keyword
 *     fields, in filter context (cacheable, no scoring);
 *   - free-text search → `multi_match` on the `text` fields (content_analyzer), never a
 *     leading `*wildcard*` — that is the CPU trap the mapping explicitly avoids;
 *   - date ranges → `range` on the `yyyy-MM-dd HH:mm:ss` date fields, values sent as
 *     epoch seconds with an explicit `format`.
 *
 * Supported search/filter set (per product scope — Category and CTA are intentionally
 * absent: the payload carries neither field yet):
 *   keyword search (ad text / advertiser / domain), advertiser, country, ad type (image/video),
 *   language, ad position, marketing platform, first seen / last seen date range,
 *   sort newest | most seen | longest running.
 */

const { chatgptads: cgaNet } = require('../../../config/networks');

const DEFAULT_INDEX = cgaNet?.database?.elastic?.index || 'chatgpt_search_mix';

// Full-text fields — all mapped `text` + content_analyzer, so cross_fields is valid.
const KEYWORD_FIELDS = ['ad_title^3', 'ad_text^2', 'newsfeed_description', 'post_owner_name^2'];

// Sort keys the controller may pass → real ES field.
const SORT_FIELDS = {
  newest: 'first_seen',
  most_seen: 'hits',
  longest_running: 'days_running',
  last_seen: 'last_seen',
};

/**
 * Same hostname normalisation insertion applies before storing `domain`
 * (chatgptadsPipeline.extractDomain → hostname without "www."), so a user typing
 * "https://www.leeford.com/x" matches the stored "leeford.com".
 */
function normalizeDomain(value) {
  let s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  return s.replace(/^www\./, '');
}

function cleanList(values) {
  return [...new Set((values || [])
    .map((v) => String(v ?? '').trim())
    .filter((v) => v && v.toUpperCase() !== 'NA'))];
}

class ChatgptSearchQueryBuilder {
  constructor(index) {
    this.index = (index || DEFAULT_INDEX).toLowerCase();
    this.from = 0;
    this.size = 20;
    this.sortField = SORT_FIELDS.newest;
    this.sortOrder = 'desc';
    this.must = [];
    this.filter = [{ term: { status: 1 } }];
  }

  setFrom(from) { this.from = Math.max(0, Number(from) || 0); return this; }

  setSize(size) { this.size = Math.min(Math.max(Number(size) || 20, 1), 100); return this; }

  /** @param {'newest'|'most_seen'|'longest_running'|'last_seen'} key */
  setSort(key, order = 'desc') {
    this.sortField = SORT_FIELDS[key] || SORT_FIELDS.newest;
    this.sortOrder = order === 'asc' ? 'asc' : 'desc';
    return this;
  }

  /** Keyword search box — ad title/text/description + advertiser, or an exact domain/ad id. */
  setKeyword(text) {
    const env = anySearchValueEnvelope(text, (q) => {
      const should = [{
        multi_match: { query: q, fields: KEYWORD_FIELDS, type: 'cross_fields', operator: 'and' },
      }];
      const domain = normalizeDomain(q);
      if (domain && !/\s/.test(domain)) should.push({ term: { domain } });
      if (/^\d+$/.test(q)) should.push({ term: { ad_id: q } });
      return { ctx: 'must', clause: { bool: { should, minimum_should_match: 1 } } };
    });
    if (env) this.must.push(env.clause);
    return this;
  }

  /**
   * "Advertiser" search box. Word match on post_owner_name by default; exact=true matches the
   * whole name via the lowercase-normalized `.kw` sub-field.
   */
  setPostOwnerName(text, exact = false) {
    if (exact) {
      const clause = exactSearchValueClause('post_owner_name.kw', text);
      if (clause) this.filter.push(clause);
      return this;
    }
    const env = anySearchValueEnvelope(text, (q) => ({
      ctx: 'must', clause: { match: { post_owner_name: { query: q, operator: 'and' } } },
    }));
    if (env) this.must.push(env.clause);
    return this;
  }

  /** "Domain" search box — exact hostname (www-stripped, same as insertion). */
  setDomain(text) {
    const domain = normalizeDomain(text);
    if (domain) this.filter.push({ term: { domain } });
    return this;
  }

  /** Advertiser filter (SDUI multi-select) — exact advertiser names. */
  setAdvertisers(values) {
    const list = cleanList(values);
    if (list.length) this.filter.push({ terms: { 'post_owner_name.kw': list } });
    return this;
  }

  /**
   * Ad Type filter (shared SDUI `ad_types`: Image / Video) — the frontend sends IMAGE / VIDEO,
   * which is exactly what insertion stores in `type` (keyword + lowercase normalizer).
   */
  setAdType(values) {
    const list = cleanList(values).map((v) => v.replace(/-/g, '_').toUpperCase());
    if (list.length) this.filter.push({ terms: { type: list } });
    return this;
  }

  /**
   * Language filter — the ad's detected language as stored by insertion in `lang_detect`
   * (full English name, e.g. "English"; keyword + lowercase normalizer).
   */
  setLanguage(values) {
    const list = cleanList(values);
    if (list.length) this.filter.push({ terms: { lang_detect: list } });
    return this;
  }

  /** Ad Position filter — ChatGPT placement as sent by the extension, e.g. "conversational_bottom". */
  setAdPosition(values) {
    const list = cleanList(values);
    if (list.length) this.filter.push({ terms: { ad_position: list } });
    return this;
  }

  /**
   * Marketing Platform filter — SDUI option values are URL fragments ("doubleclick",
   * "hubs.ly", …), so this is a containment match on the ad's destination URL and domain.
   * The one deliberate `*wildcard*` in this builder: URL substrings genuinely need it, and
   * every other clause stays in filter context so the cost is bounded to the matched set.
   */
  setMarketPlatform(values) {
    const list = cleanList(values).map((v) => v.toLowerCase());
    if (!list.length) return this;
    const should = [];
    for (const v of list) {
      should.push({ wildcard: { destination_url: { value: `*${v}*` } } });
      should.push({ wildcard: { domain: { value: `*${v}*` } } });
    }
    this.filter.push({ bool: { should, minimum_should_match: 1 } });
    return this;
  }

  /** Country filter — country NAMES (the payload sends resolved names, not ISO codes). */
  setCountry(values) {
    const list = cleanList(values);
    if (list.length) this.filter.push({ terms: { country: list } });
    return this;
  }

  /** Saved page — restrict to these external ad ids. */
  setAdIds(adIds) {
    this.filter.push({ terms: { ad_id: cleanList(adIds) } });
    return this;
  }

  /** Hidden page — ads the user hid OR any ad from an advertiser they hid. */
  setHiddenScope({ adIds = [], ownerLowers = [] }) {
    const should = [];
    const ids = cleanList(adIds);
    const owners = cleanList(ownerLowers);
    if (ids.length) should.push({ terms: { ad_id: ids } });
    if (owners.length) should.push({ terms: { post_owner_lower: owners } });
    this.filter.push({ bool: { should, minimum_should_match: 1 } });
    return this;
  }

  /** @param {{gte?: number, lte?: number}} range epoch seconds */
  setFirstSeen(range) { return this._dateRange('first_seen', range); }

  /** @param {{gte?: number, lte?: number}} range epoch seconds */
  setLastSeen(range) { return this._dateRange('last_seen', range); }

  _dateRange(field, range) {
    if (!range) return this;
    const r = { format: 'epoch_second' };
    if (Number.isFinite(range.gte)) r.gte = Math.floor(range.gte);
    if (Number.isFinite(range.lte)) r.lte = Math.floor(range.lte);
    if (r.gte === undefined && r.lte === undefined) return this;
    this.filter.push({ range: { [field]: r } });
    return this;
  }

  build() {
    return {
      index: this.index,
      body: {
        from: this.from,
        size: this.size,
        track_total_hits: true,
        query: { bool: { must: this.must, filter: this.filter } },
        // `id` tie-breaker keeps pagination stable when many ads share a sort value
        // (e.g. hits = 1 or days_running = 1 for every brand-new ad).
        sort: [
          { [this.sortField]: { order: this.sortOrder, missing: '_last' } },
          { id: { order: 'desc' } },
        ],
      },
    };
  }
}

module.exports = ChatgptSearchQueryBuilder;
module.exports.normalizeDomain = normalizeDomain;
module.exports.SORT_FIELDS = SORT_FIELDS;
