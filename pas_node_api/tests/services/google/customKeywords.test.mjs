import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const config = require('../../../src/config');
const repo = require('../../../src/services/google/insertion/repository');
const api = require('../../../src/insertion/helpers/apiClients');
const { normCustomKeyword, customKeywordNorms, customKeywordTags } = require('../../../src/services/google/insertion/normalize');
const customKeywords = require('../../../src/services/google/controllers/customKeywordsController');
const { processMetaAd } = require('../../../src/services/google/insertion/metaAdsPipeline');

const CFG = { enabled: true, maxKeywordLength: 100 };

// The tests must not depend on the local config.json allow-list: start every test with it empty (= everyone).
{
  const _allowed = config.customKeywords.allowedUserIds;
  beforeEach(() => { config.customKeywords.allowedUserIds = []; });
  afterAll(() => { config.customKeywords.allowedUserIds = _allowed; });
}

describe('custom keyword helpers', () => {
  it('normalizes: trim, collapse spaces, lower-case, "|" becomes a space', () => {
    expect(normCustomKeyword('  Nike   Running SHOES ')).toBe('nike running shoes');
    expect(normCustomKeyword('a|b')).toBe('a b');
    expect(normCustomKeyword(null)).toBe('');
  });

  it('customKeywordNorms: custom_keyword is a list (a single string works too), no user id involved', () => {
    expect(customKeywordNorms({ custom_keyword: ['Nike  Shoes ', 'yoga mat'] }, CFG)).toEqual(['nike shoes', 'yoga mat']);
    expect(customKeywordNorms({ custom_keyword: 'Nike  Shoes ' }, CFG)).toEqual(['nike shoes']);
    expect(customKeywordNorms({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: 999 }, CFG)).toEqual(['nike shoes']); // a sent id is ignored
  });

  it('customKeywordNorms: drops duplicates, blanks, non-text and over-long items', () => {
    expect(customKeywordNorms({ custom_keyword: ['a', 'A ', '', '   ', null, undefined, { x: 1 }, ['n'], 'x'.repeat(101), 'b'] }, CFG)).toEqual(['a', 'b']);
    expect(customKeywordNorms({ custom_keyword: [7, '7'] }, CFG)).toEqual(['7']);
  });

  it('customKeywordNorms: [] for an ordinary ad, when the feature is off, and it caps the list at maxClaimSize', () => {
    expect(customKeywordNorms({}, CFG)).toEqual([]);
    expect(customKeywordNorms({ custom_keyword: [] }, CFG)).toEqual([]);
    expect(customKeywordNorms({ custom_keyword: ['x'] }, { ...CFG, enabled: false })).toEqual([]);
    expect(customKeywordNorms({ custom_keyword: ['x'] }, undefined)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => `kw${i}`);
    expect(customKeywordNorms({ custom_keyword: many }, { ...CFG, maxClaimSize: 3 })).toEqual(['kw0', 'kw1', 'kw2']);
  });

  it('customKeywordTags: one "<userId>:<keyword>" tag per owner', () => {
    expect(customKeywordTags('nike shoes', [281, 305])).toEqual(['281:nike shoes', '305:nike shoes']);
    expect(customKeywordTags('nike shoes', [])).toEqual([]);
    expect(customKeywordTags('nike shoes', undefined)).toEqual([]);
  });
});

describe('repository.mergeVariantCustomKeyword', () => {
  const exec = (current) => ({
    query: vi.fn(async (sql) => (/^SELECT/.test(sql) ? (current === undefined ? [] : [{ custom_keyword: current }]) : { affectedRows: 1 })),
  });

  it('appends a new tag to the "|" list', async () => {
    const e = exec('281:nike');
    expect(await repo.mergeVariantCustomKeyword(e, 7, '305:gym bag')).toEqual(['281:nike', '305:gym bag']);
    expect(e.query).toHaveBeenLastCalledWith(expect.stringMatching(/^UPDATE google_text_ad_variants SET custom_keyword/), ['281:nike|305:gym bag', 7]);
  });

  it('starts the list when the column is empty/NULL', async () => {
    const e = exec(null);
    expect(await repo.mergeVariantCustomKeyword(e, 7, '281:nike')).toEqual(['281:nike']);
    expect(e.query).toHaveBeenLastCalledWith(expect.any(String), ['281:nike', 7]);
  });

  it('does not write again when the tag is already there', async () => {
    const e = exec('281:nike|305:gym bag');
    await repo.mergeVariantCustomKeyword(e, 7, '281:nike');
    expect(e.query).toHaveBeenCalledTimes(1); // only the SELECT
  });

  it('adds several tags in one write, skipping the ones already there', async () => {
    const e = exec('281:nike');
    expect(await repo.mergeVariantCustomKeyword(e, 7, ['281:nike', '305:nike', '412:nike'])).toEqual(['281:nike', '305:nike', '412:nike']);
    expect(e.query).toHaveBeenCalledTimes(2); // one SELECT, one UPDATE
    expect(e.query.mock.calls[1][1][0]).toBe('281:nike|305:nike|412:nike');
  });

  it('does nothing when the ad has no variant row', async () => {
    const e = exec(undefined);
    expect(await repo.mergeVariantCustomKeyword(e, 7, '281:nike')).toEqual([]);
    expect(e.query).toHaveBeenCalledTimes(1);
  });
});

describe('google pipeline carries custom_keyword', () => {
  const originals = {};
  let elastic;
  let savedCfg;

  const validAd = (extra = {}) => ({
    network: 'GoogleText', type: 'TEXT', post_owner: 'Acme', post_owner_image: null, ad_title: 't', ad_image: null,
    newsfeed_description: 'd', platform: 3, destination_url: 'http://acme.com/a', g_temp_url: null, ad_id: 'AD1',
    post_date: '1700000000', first_seen: '1700000000', last_seen: '1700000000', city: null, state: null, country: 'US',
    ad_position: 'top', ad_sub_position: null, ad_number_position: null, ad_text: 'txt', version: '2.0.30', ip_address: null,
    target_keyword: 'nike', target_page: null, source: 'desktop', ad_ranking: '1', ...extra,
  });

  const stubRepo = ({ existing }) => {
    for (const k of Object.keys(repo)) { originals[k] = repo[k]; repo[k] = vi.fn(async () => ({ code: 400, data: null })); }
    repo.withTransaction = vi.fn(async (_s, fn) => fn({}));
    repo.getAdByAdId = vi.fn(async () => (existing ? { code: 200, data: [{ id: 7 }] } : { code: 400, data: null }));
    repo.getJoinedAd = vi.fn(async () => [{ id: 7, first_seen: '2024-01-01 00:00:00', post_date: '2024-01-01 00:00:00' }]);
    for (const k of ['insertPostOwner', 'insertDomain', 'insertCountryOnly', 'insertCountry', 'insertVariant']) repo[k] = vi.fn(async () => 5);
    repo.insertGoogleTextAd = vi.fn(async () => 10);
    repo.mergeVariantCustomKeyword = vi.fn(async () => []);
  };

  beforeEach(() => {
    savedCfg = { ...config.customKeywords };
    originals.translate = api.translate;
    originals.adgptInsert = api.adgptInsert;
    api.translate = vi.fn(async () => ({ ok: false }));
    api.adgptInsert = vi.fn();
    elastic = {
      indexName: 'idx',
      search: vi.fn(async () => ({ hits: { hits: [{ _id: 'e1', _source: {} }] } })),
      update: vi.fn(async () => ({})),
      index: vi.fn(async () => ({})),
    };
  });
  afterEach(() => {
    Object.assign(config.customKeywords, savedCfg);
    for (const [k, v] of Object.entries(originals)) {
      if (k === 'translate' || k === 'adgptInsert') api[k] = v; else repo[k] = v;
    }
  });

  const run = (ad, existing) => {
    stubRepo({ existing });
    return processMetaAd(ad, { db: { sql: {}, elastic }, log: { warn: vi.fn(), error: vi.fn() }, network: 'google' });
  };

  // The scraper sends only `custom_keyword` (a list); the owners come from Mongo (stubbed here).
  // `map` is { keyword: [user ids] }; a keyword that is not in it has no owners.
  const owners = (map) => { customKeywords.findKeywordOwners = vi.fn(async (keys) => new Map(keys.map((k) => [k, map[k] || []]))); };
  const realFindOwners = customKeywords.findKeywordOwners;
  afterEach(() => { customKeywords.findKeywordOwners = realFindOwners; });

  it('UPDATE: tags every owner of the keyword in SQL and in the ES array (atomic script)', async () => {
    config.customKeywords.enabled = true;
    owners({ 'nike shoes': [281, 305] });
    const r = await run(validAd({ custom_keyword: ['Nike Shoes'] }), true); // no user id sent
    expect(r.code).toBe(200);
    expect(customKeywords.findKeywordOwners).toHaveBeenCalledWith(['nike shoes']);
    expect(repo.mergeVariantCustomKeyword).toHaveBeenCalledWith(expect.anything(), 7, ['281:nike shoes', '305:nike shoes']);
    expect(elastic.update).toHaveBeenCalledTimes(2);
    const scripted = elastic.update.mock.calls[1][0];
    expect(scripted.retry_on_conflict).toBe(3);
    expect(scripted.body.script.params).toEqual({ ts: ['281:nike shoes', '305:nike shoes'] });
    expect(scripted.body.script.source).toContain('custom_keyword');
  });

  it('one ad can carry several keywords: tags for every owner of every keyword, no duplicates', async () => {
    config.customKeywords.enabled = true;
    owners({ 'nike shoes': [281], 'yoga mat': [281, 305], 'gym bag': [412] });
    const r = await run(validAd({ custom_keyword: ['Nike Shoes', 'yoga mat', 'nike shoes', 'unknown', 'gym bag'] }), false);
    expect(r.code).toBe(200);
    expect(customKeywords.findKeywordOwners).toHaveBeenCalledWith(['nike shoes', 'yoga mat', 'unknown', 'gym bag']);
    const tags = ['281:nike shoes', '281:yoga mat', '305:yoga mat', '412:gym bag'];
    expect(repo.mergeVariantCustomKeyword).toHaveBeenCalledWith(expect.anything(), 10, tags);
    expect(elastic.index.mock.calls[0][0].body.custom_keyword).toEqual(tags);
  });

  it('a single string is still accepted for custom_keyword', async () => {
    config.customKeywords.enabled = true;
    owners({ 'nike shoes': [281] });
    await run(validAd({ custom_keyword: 'Nike Shoes' }), false);
    expect(elastic.index.mock.calls[0][0].body.custom_keyword).toEqual(['281:nike shoes']);
  });

  it('a user id sent by the scraper is ignored: the owners come from the database', async () => {
    config.customKeywords.enabled = true;
    owners({ 'nike shoes': [281] });
    await run(validAd({ custom_keyword: ['Nike Shoes'], custom_keyword_user_id: 999 }), false);
    expect(repo.mergeVariantCustomKeyword).toHaveBeenCalledWith(expect.anything(), 10, ['281:nike shoes']);
    expect(JSON.stringify(elastic.index.mock.calls[0][0].body)).not.toContain('999:');
  });

  it('UPDATE: nothing extra happens when the feature is off', async () => {
    config.customKeywords.enabled = false;
    owners({ 'nike shoes': [281] });
    const r = await run(validAd({ custom_keyword: ['Nike Shoes'] }), true);
    expect(r.code).toBe(200);
    expect(customKeywords.findKeywordOwners).not.toHaveBeenCalled();
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect(elastic.update).toHaveBeenCalledTimes(1);
  });

  it('keywords nobody uploaded (no owners) save the ad without tags', async () => {
    config.customKeywords.enabled = true;
    owners({});
    const r = await run(validAd({ custom_keyword: ['unknown words'] }), false);
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect('custom_keyword' in elastic.index.mock.calls[0][0].body).toBe(false);
  });

  it('an owner lookup failure (Mongo down) never fails the ad: it is saved without tags', async () => {
    config.customKeywords.enabled = true;
    customKeywords.findKeywordOwners = vi.fn(async () => { throw new Error('mongo down'); });
    const warn = vi.fn();
    stubRepo({ existing: false });
    const r = await processMetaAd(validAd({ custom_keyword: ['nike'] }), { db: { sql: {}, elastic }, log: { warn, error: vi.fn() }, network: 'google' });
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('gtext custom_keyword owner lookup failed', { error: 'mongo down' });
  });

  it('UPDATE: a failing SQL write never fails the ad', async () => {
    config.customKeywords.enabled = true;
    owners({ a: [1] });
    stubRepo({ existing: true });
    repo.mergeVariantCustomKeyword = vi.fn(async () => { throw new Error("Unknown column 'custom_keyword'"); });
    const r = await processMetaAd(validAd({ custom_keyword: ['a'] }), { db: { sql: {}, elastic }, log: { warn: vi.fn(), error: vi.fn() }, network: 'google' });
    expect(r.code).toBe(200);
  });

  it('an ordinary ad never asks for owners, gets no custom_keyword key and no extra SQL (unchanged)', async () => {
    config.customKeywords.enabled = true;
    owners({ 'nike shoes': [281] });
    const r = await run(validAd(), false);
    expect(r.code).toBe(200);
    expect(customKeywords.findKeywordOwners).not.toHaveBeenCalled(); // no Mongo query on the normal path
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect('custom_keyword' in elastic.index.mock.calls[0][0].body).toBe(false);
  });
});

describe('findKeywordOwners (who owns the keywords)', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const prevGetMongo = dbManager.getMongo;
  const prevEnabled = config.customKeywords.enabled;
  const rows = [
    { userId: 281, keywordNorm: 'nike shoes' }, { userId: 305, keywordNorm: 'nike shoes' },
    { userId: 281, keywordNorm: 'nike shoes' }, { userId: 412, keywordNorm: 'yoga mat' },
  ];
  let finds;
  beforeEach(() => {
    customKeywords._test.clearOwnersCache();
    config.customKeywords.enabled = true;
    finds = vi.fn();
    const col = {
      createIndexes: async () => [],
      find: (filter, opts) => { finds(filter, opts); return { toArray: async () => rows.filter((r) => filter.keywordNorm.$in.includes(r.keywordNorm)) }; },
    };
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
  });
  afterEach(() => { config.customKeywords.enabled = prevEnabled; config.customKeywords.allowedUserIds = []; dbManager.getMongo = prevGetMongo; customKeywords._test.clearOwnersCache(); });

  it('returns a Map keyword -> owners, each owner once, with ONE Mongo query for the whole list', async () => {
    const m = await customKeywords.findKeywordOwners(['nike shoes', 'yoga mat', 'nobody']);
    expect([...m.entries()]).toEqual([['nike shoes', [281, 305]], ['yoga mat', [412]], ['nobody', []]]);
    expect(finds).toHaveBeenCalledTimes(1);
    expect(finds).toHaveBeenCalledWith({ keywordNorm: { $in: ['nike shoes', 'yoga mat', 'nobody'] } }, { projection: { userId: 1, keywordNorm: 1 } });
  });

  it('keeps only users who are allowed to use the feature', async () => {
    config.customKeywords.allowedUserIds = ['305'];
    expect((await customKeywords.findKeywordOwners(['nike shoes'])).get('nike shoes')).toEqual([305]);
  });

  it('is cached, so many ads cost no extra query; only keywords not seen yet are asked for', async () => {
    await customKeywords.findKeywordOwners(['gym bag']);
    await customKeywords.findKeywordOwners(['gym bag']);
    expect(finds).toHaveBeenCalledTimes(1);
    await customKeywords.findKeywordOwners(['gym bag', 'yoga mat']);
    expect(finds).toHaveBeenCalledTimes(2);
    expect(finds.mock.calls[1][0]).toEqual({ keywordNorm: { $in: ['yoga mat'] } });
  });

  it('throws when the database is unavailable (the pipeline turns that into "no tags")', async () => {
    dbManager.getMongo = () => null;
    await expect(customKeywords.findKeywordOwners(['x'])).rejects.toThrow('unavailable');
  });
});

describe('keyword search also matches the users own custom-keyword ads', () => {
  const { searchAds } = require('../../../src/services/google/controllers/adSearchController');
  const prev = config.customKeywords.enabled;
  afterEach(() => { config.customKeywords.enabled = prev; });

  async function esBody(body, user = { user_id: 281 }) {
    const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } }));
    await searchAds({ body: { user_id: 281, ...body }, query: {}, user }, { elastic: { indexName: 'google_ads_data_v2', search } }, { info() {}, error() {}, warn() {} });
    return JSON.stringify(search.mock.calls[0][0].body);
  }

  it('ORs the "<token user id>:<keyword>" tag into the keyword query when enabled', async () => {
    config.customKeywords.enabled = true;
    const es = await esBody({ keyword: '  Nike  Shoes ' });
    expect(es).toContain('{"term":{"custom_keyword":"281:nike shoes"}}');
    expect(es).toContain('"minimum_should_match":1'); // normal match OR the tag
  });

  it('uses the token user id, not a user id sent in the request', async () => {
    config.customKeywords.enabled = true;
    const es = await esBody({ user_id: 999, keyword: 'nike' }, { user_id: 281 });
    expect(es).toContain('"custom_keyword":"281:nike"');
    expect(es).not.toContain('999:nike');
  });

  it('changes nothing while the feature is off', async () => {
    config.customKeywords.enabled = false;
    expect(await esBody({ keyword: 'nike' })).not.toContain('custom_keyword');
  });

  it('adds nothing without a keyword, without a user in the token, or for an over-long keyword', async () => {
    config.customKeywords.enabled = true;
    expect(await esBody({ advertiser: 'nike' })).not.toContain('custom_keyword');
    expect(await esBody({ keyword: 'x'.repeat(101) })).not.toContain('custom_keyword');
    const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } }));
    await searchAds({ body: { user_id: 1, keyword: 'nike' }, query: {} }, { elastic: { search } }, { info() {}, error() {}, warn() {} });
    expect(JSON.stringify(search.mock.calls[0][0].body)).not.toContain('custom_keyword');
  });
});

// A small in-memory stand-in for the Mongo collection: exactly the operations the scraper calls use.
function makeCollection(initial = []) {
  const docs = initial.map((d, i) => ({
    _id: `id${i + 1}`, status: 'pending', attempts: 0, retryAfter: 0, claimedBy: null, claimedAt: null, completedAt: null,
    lastError: null, createdAt: new Date(2026, 0, 1, 0, 0, i), keywordNorm: String(d.keyword).trim().toLowerCase().replace(/\s+/g, ' '), ...d,
  }));
  const match = (d, f) => Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => match(d, sub));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$in' in v) return v.$in.includes(d[k]);
      if ('$ne' in v) return d[k] !== v.$ne;
      if ('$lte' in v) return d[k] <= v.$lte;
      if ('$lt' in v) return d[k] !== null && d[k] < v.$lt;
    }
    return d[k] === v;
  });
  const apply = (d, u) => { Object.assign(d, u.$set || {}); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; };
  const byOldest = (a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id));
  const run = (stages, input) => stages.reduce((rows, st) => {
    if (st.$match) return rows.filter((d) => match(d, st.$match));
    if (st.$group) {
      const groups = new Map();
      for (const d of rows) {
        const key = d[st.$group._id.slice(1)];
        const g = groups.get(key) || { _id: key, _n: 0 };
        for (const [out, spec] of Object.entries(st.$group)) {
          if (out === '_id') continue;
          const [op, arg] = Object.entries(spec)[0];
          const val = typeof arg === 'string' ? d[arg.slice(1)] : arg;
          if (op === '$sum') g[out] = (g[out] || 0) + val;
          else if (op === '$first') { if (!(out in g)) g[out] = val; }
          else if (op === '$max') g[out] = g[out] === undefined || val > g[out] ? val : g[out];
          else if (op === '$min') g[out] = g[out] === undefined || val < g[out] ? val : g[out];
        }
        groups.set(key, g);
      }
      return [...groups.values()];
    }
    if (st.$sort) { const keys = Object.keys(st.$sort); return [...rows].sort((a, b) => { for (const k of keys) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; }); }
    if (st.$skip !== undefined) return rows.slice(st.$skip);
    if (st.$limit !== undefined) return rows.slice(0, st.$limit);
    if (st.$count) return [{ [st.$count]: rows.length }];
    if (st.$facet) { const out = {}; for (const [name, sub] of Object.entries(st.$facet)) out[name] = run(sub, rows); return [out]; }
    return rows;
  }, input);
  return {
    docs,
    createIndexes: async () => [],
    find: (f) => ({ toArray: async () => docs.filter((d) => match(d, f)) }),
    findOne: async (f) => docs.find((d) => match(d, f)) || null,
    updateOne: async (f, u) => { const d = docs.find((x) => match(x, f)); if (!d) return { modifiedCount: 0 }; apply(d, u); return { modifiedCount: 1 }; },
    updateMany: async (f, u) => { const hit = docs.filter((d) => match(d, f)); hit.forEach((d) => apply(d, u)); return { modifiedCount: hit.length }; },
    findOneAndUpdate: async (f, u) => { const d = docs.filter((x) => match(x, f)).sort(byOldest)[0]; if (!d) return null; apply(d, u); return d; },
    countDocuments: async (f) => docs.filter((d) => match(d, f)).length,
    estimatedDocumentCount: async () => docs.length,
    aggregate: (pipeline) => ({ toArray: async () => run(pipeline, docs) }),
  };
}

describe('scraper GET /scraper/keywords: the scraper decides how many keywords, and which ones', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const prev = { enabled: config.customKeywords.enabled };
  const prevGetMongo = dbManager.getMongo;
  let col;
  afterEach(() => { config.customKeywords.enabled = prev.enabled; dbManager.getMongo = prevGetMongo; });

  const res = () => { const r = { code: 200, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const use = (docs) => { config.customKeywords.enabled = true; col = makeCollection(docs); dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } }); };
  const get = async (query = {}, scraper = 's1') => { const r = res(); await ctl.getScraperKeywords({ get: () => scraper, query, body: {} }, r); return r; };
  const status = (id) => col.docs.find((d) => d._id === id).status;
  const pool = () => use([
    { userId: 1, keyword: 'gym bag' }, { userId: 1, keyword: 'yoga mat' }, { userId: 2, keyword: 'nike shoes' },
    { userId: 3, keyword: 'best crm' }, { userId: 3, keyword: 'running socks' },
  ]);

  it('takes one keyword by default; the answer has no user id and is never cached', async () => {
    pool();
    const r = await get();
    expect(r.body).toMatchObject({ code: 200, message: 'claimed', scraper: 's1', skipped: [], left: 4, total: 5 });
    expect(r.body.data).toEqual([{ id: 'id1', keyword: 'gym bag', attempt: 1 }]);
    expect(JSON.stringify(r.body)).not.toContain('userId');
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(status('id1')).toBe('in_progress');
  });

  it('takes as many keywords as the scraper asks for (size), oldest first', async () => {
    pool();
    const r = await get({ size: '3' });
    expect(r.body.data.map((d) => d.keyword)).toEqual(['gym bag', 'yoga mat', 'nike shoes']);
    expect(r.body.left).toBe(2);
    const q = await get({ size: '2' }, 's2');
    expect(q.body.data.map((d) => d.keyword)).toEqual(['best crm', 'running socks']);
    expect(q.body.left).toBe(0);
  });

  it('says so when nothing is left', async () => {
    pool();
    await get({ size: '10' });
    const r = await get({ size: '5' }, 's2');
    expect(r.body).toMatchObject({ code: 200, message: 'no pending keywords', data: [], left: 0 });
  });

  it('size 0 takes nothing', async () => {
    pool();
    const r = await get({ size: '0' });
    expect(r.body).toMatchObject({ message: 'ok', data: [], left: 5 });
    expect(col.docs.every((d) => d.status === 'pending')).toBe(true);
  });

  it('a keyword uploaded by several users is taken once for all of them', async () => {
    use([{ userId: 1, keyword: 'Nike Shoes' }, { userId: 2, keyword: 'nike  shoes' }, { userId: 3, keyword: 'yoga mat' }]);
    const r = await get({ size: '1' });
    expect(r.body.data).toHaveLength(1);
    expect(col.docs.filter((d) => d.keywordNorm === 'nike shoes').map((d) => d.status)).toEqual(['in_progress', 'in_progress']);
    expect(r.body.left).toBe(1); // only "yoga mat" is still waiting
  });

  it('keyword: takes exactly the named keywords (any case, repeat the parameter), even one that is already done, and says what it skipped', async () => {
    use([
      { userId: 1, keyword: 'gym bag' }, { userId: 1, keyword: 'yoga mat', status: 'done' },
      { userId: 2, keyword: 'nike shoes', status: 'in_progress', claimedBy: 'other', claimedAt: new Date() },
    ]);
    const r = await get({ keyword: ['YOGA mat', 'Gym Bag', 'nike shoes', 'no such keyword'] });
    expect(r.body.data.map((d) => d.keyword)).toEqual(['yoga mat', 'gym bag']);
    expect(r.body.skipped).toEqual([{ keyword: 'nike shoes', reason: 'in_progress' }, { keyword: 'no such keyword', reason: 'not_found' }]);
    expect(['id1', 'id2'].map(status)).toEqual(['in_progress', 'in_progress']);
    expect(col.docs[2].claimedBy).toBe('other'); // still the other scraper's
  });

  it('keyword: a single keyword works, and a comma inside a keyword is not a separator', async () => {
    use([{ userId: 1, keyword: 'best, crm software' }, { userId: 1, keyword: 'best' }]);
    const r = await get({ keyword: 'Best, CRM Software' });
    expect(r.body.data.map((d) => d.keyword)).toEqual(['best, crm software']);
    expect(status('id2')).toBe('pending');
  });

  it('a stale claim (nobody finished it for too long) can be taken by name or from the queue', async () => {
    const old = new Date(Date.now() - 120 * 60000);
    const stale = () => use([{ userId: 1, keyword: 'gym bag', status: 'in_progress', claimedBy: 'crashed', claimedAt: old }]);
    stale();
    expect((await get({ keyword: 'gym bag' })).body.data).toHaveLength(1);
    stale();
    expect((await get({ size: '1' })).body.data).toHaveLength(1);
  });

  it('only keywords of allowed users are handed out, and counted', async () => {
    pool();
    config.customKeywords.allowedUserIds = ['3'];
    const r = await get({ size: '10' });
    expect(r.body.data.map((d) => d.keyword)).toEqual(['best crm', 'running socks']);
    expect(r.body.left).toBe(0);
    expect((await get({ keyword: 'gym bag' })).body.skipped).toEqual([{ keyword: 'gym bag', reason: 'not_found' }]);
  });

  it('the scraper name can also come as ?scraper=', async () => {
    pool();
    const r = res();
    await ctl.getScraperKeywords({ get: () => '', query: { scraper: 'from-query' }, body: {} }, r);
    expect(r.body.scraper).toBe('from-query');
    expect(col.docs[0].claimedBy).toBe('from-query');
  });

  it('rejects bad input with a clear 400 and changes nothing', async () => {
    pool();
    for (const [query, text] of [
      [{ size: '-1' }, 'size must be'], [{ size: '101' }, 'size must be'], [{ size: 'abc' }, 'size must be'], [{ size: '1.5' }, 'size must be'],
      [{ keyword: '' }, 'keyword must be'], [{ keyword: ['', '  '] }, 'keyword must be'],
      [{ status: 'weird' }, 'status must be one of'],
    ]) {
      const r = await get(query);
      expect(r.code, JSON.stringify(query)).toBe(400);
      expect(r.body.message, JSON.stringify(query)).toContain(text);
    }
    expect(col.docs.every((d) => d.status === 'pending')).toBe(true);
    const noName = res();
    await ctl.getScraperKeywords({ get: () => '', query: {}, body: {} }, noName);
    expect(noName.code).toBe(400);
  });

  it('is 503 while the feature is off', async () => {
    pool();
    config.customKeywords.enabled = false;
    expect((await get()).code).toBe(503);
  });
});

describe('scraper GET /scraper/keywords?status=: look at what is waiting and what is done (takes nothing)', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const prev = config.customKeywords.enabled;
  const prevGetMongo = dbManager.getMongo;
  afterEach(() => { config.customKeywords.enabled = prev; dbManager.getMongo = prevGetMongo; });
  const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  let col;
  const setup = () => {
    config.customKeywords.enabled = true;
    col = makeCollection([
      { userId: 1, keyword: 'gym bag' }, { userId: 2, keyword: 'Gym  Bag' }, { userId: 1, keyword: 'yoga mat' },
      { userId: 3, keyword: 'best crm', status: 'in_progress', claimedBy: 's1', attempts: 1 },
      { userId: 3, keyword: 'running socks', status: 'done' }, { userId: 1, keyword: 'old news', status: 'failed', attempts: 3, lastError: 'captcha' },
    ]);
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
  };
  const look = async (query = {}, scraper = 's1') => { const r = res(); await ctl.getScraperKeywords({ get: () => scraper, query: { status: 'pending', ...query }, body: {} }, r); return r; };

  it('lists the waiting keywords, one row per keyword, with counts of every status; nothing is taken', async () => {
    setup();
    const r = await look();
    expect(r.body).toMatchObject({ code: 200, status: 'pending', page: 1, total: 2, counts: { pending: 3, in_progress: 1, done: 1, no_ads_found: 0, failed: 1 } });
    expect(r.body.data.map((d) => [d.keyword, d.owners])).toEqual([['gym bag', 2], ['yoga mat', 1]]);
    expect(col.docs.filter((d) => d.status === 'pending')).toHaveLength(3); // still all pending
  });

  it('lists a chosen status; in_progress shows which scraper has it; failed shows why', async () => {
    setup();
    expect((await look({ status: 'in_progress' })).body.data).toMatchObject([{ keyword: 'best crm', claimedBy: 's1', attempts: 1 }]);
    expect((await look({ status: 'done' })).body.data.map((d) => d.keyword)).toEqual(['running socks']);
    expect((await look({ status: 'failed' })).body.data[0]).toMatchObject({ keyword: 'old news', lastError: 'captcha' });
  });

  it('pages through the list', async () => {
    setup();
    const p1 = await look({ limit: '1', page: '1' });
    const p2 = await look({ limit: '1', page: '2' });
    expect([p1.body.data[0].keyword, p2.body.data[0].keyword]).toEqual(['gym bag', 'yoga mat']);
    expect(p1.body.total).toBe(2);
    expect(p1.body.pageSize).toBe(1);
  });

  it('never shows a user id', async () => {
    setup();
    for (const status of ['pending', 'in_progress', 'done', 'failed']) expect(JSON.stringify((await look({ status })).body)).not.toMatch(/userId|"user/);
  });

  it('only counts and lists keywords of allowed users', async () => {
    setup();
    config.customKeywords.allowedUserIds = ['3'];
    expect((await look({ status: 'done' })).body.counts).toMatchObject({ pending: 0, in_progress: 1, done: 1, failed: 0 });
    expect((await look()).body.data).toEqual([]);
  });
});

describe('scraper POST /scraper/results: send back how each keyword went', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const prev = { enabled: config.customKeywords.enabled, maxAttempts: config.customKeywords.maxAttempts };
  const prevGetMongo = dbManager.getMongo;
  let col;
  afterEach(() => { config.customKeywords.enabled = prev.enabled; config.customKeywords.maxAttempts = prev.maxAttempts; dbManager.getMongo = prevGetMongo; });

  const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const use = (docs) => { config.customKeywords.enabled = true; col = makeCollection(docs); dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } }); };
  const get = async (query = {}, scraper = 's1') => { const r = res(); await ctl.getScraperKeywords({ get: () => scraper, query, body: {} }, r); return r; };
  const post = async (body, scraper = 's1') => { const r = res(); await ctl.postScraperResults({ get: () => scraper, body, query: {} }, r); return r; };
  const status = (id) => col.docs.find((d) => d._id === id).status;
  const pool = () => use([
    { userId: 1, keyword: 'gym bag' }, { userId: 1, keyword: 'yoga mat' }, { userId: 2, keyword: 'nike shoes' },
    { userId: 3, keyword: 'best crm' }, { userId: 3, keyword: 'running socks' },
  ]);

  it('closes exactly the keywords named (by keyword or by id), each with its own status', async () => {
    pool();
    await get({ size: '4' });
    const r = await post({ results: [{ keyword: 'gym bag', status: 'done' }, { id: 'id3', status: 'no_ads_found' }, { keyword: 'yoga mat', status: 'failed', error: 'captcha' }] });
    expect(r.body).toMatchObject({ code: 200, message: 'recorded', scraper: 's1', ignored: [] });
    expect(r.body.closed.map((c) => [c.keyword, c.status])).toEqual([['gym bag', 'done'], ['nike shoes', 'no_ads_found'], ['yoga mat', 'pending']]);
    expect(status('id4')).toBe('in_progress'); // "best crm" was not reported, so it is still being scraped
    const failed = col.docs.find((d) => d._id === 'id2');
    expect(failed.lastError).toBe('captcha');
    expect(failed.retryAfter).toBeGreaterThan(Date.now()); // retried later, not right away
  });

  it('the status words are case-insensitive, and "completed" counts as done', async () => {
    pool();
    await get({ size: '2' });
    const r = await post({ results: [{ keyword: 'gym bag', status: 'DONE' }, { keyword: 'yoga mat', status: 'completed' }] });
    expect(r.body.closed.map((c) => c.status)).toEqual(['done', 'done']);
  });

  it('a keyword uploaded by several users is closed for all of them together', async () => {
    use([{ userId: 1, keyword: 'Nike Shoes' }, { userId: 2, keyword: 'nike  shoes' }]);
    await get({ size: '1' });
    const r = await post({ results: [{ keyword: 'NIKE SHOES', status: 'done' }] });
    expect(r.body.closed).toHaveLength(1);
    expect(col.docs.map((d) => d.status)).toEqual(['done', 'done']);
  });

  it('a failed keyword stays failed once maxAttempts is used up', async () => {
    use([{ userId: 1, keyword: 'gym bag', attempts: 2 }]);
    config.customKeywords.maxAttempts = 3;
    await get({ size: '1' }); // attempts becomes 3
    const r = await post({ results: [{ keyword: 'gym bag', status: 'failed' }] });
    expect(r.body.closed[0].status).toBe('failed');
    expect(status('id1')).toBe('failed');
  });

  it('{ status } closes EVERYTHING this scraper holds', async () => {
    pool();
    await get({ size: '3' });
    const r = await post({ status: 'done' });
    expect(r.body.closed).toHaveLength(3);
    expect(['id1', 'id2', 'id3'].map(status)).toEqual(['done', 'done', 'done']);
    pool();
    await get({ size: '2' });
    await post({ status: 'no_ads_found' });
    expect(['id1', 'id2'].map(status)).toEqual(['no_ads_found', 'no_ads_found']);
  });

  it('one scraper cannot close what another scraper holds: it comes back as ignored', async () => {
    pool();
    await get({ size: '1' }, 's1');
    const r = await post({ results: [{ keyword: 'gym bag', status: 'done' }, { keyword: 'never taken', status: 'done' }] }, 's2');
    expect(r.body).toMatchObject({ message: 'nothing to close', closed: [] });
    expect(r.body.ignored).toEqual([{ keyword: 'gym bag', reason: 'not_held' }, { keyword: 'never taken', reason: 'not_held' }]);
    expect(status('id1')).toBe('in_progress');
  });

  it('reporting the same keyword twice closes it once and ignores the repeat', async () => {
    pool();
    await get({ size: '1' });
    const r = await post({ results: [{ keyword: 'gym bag', status: 'done' }, { keyword: 'gym bag', status: 'failed' }] });
    expect(r.body.closed).toHaveLength(1);
    expect(r.body.ignored).toEqual([{ keyword: 'gym bag', reason: 'not_held' }]);
    expect(status('id1')).toBe('done');
  });

  it('rejects bad input with a clear 400 and changes nothing', async () => {
    pool();
    await get({ size: '1' });
    for (const [body, text] of [
      [{}, 'send results'], [undefined, 'send results'], [{ results: 'gym bag' }, 'results must be'], [{ results: [] }, 'results must be'],
      [{ results: [{ keyword: 'a', status: 'weird' }] }, 'each result needs'], [{ results: [{ keyword: 'a' }] }, 'each result needs'],
      [{ results: [{ status: 'done' }] }, 'each result needs'], [{ status: 'weird' }, 'status must be'],
    ]) {
      const r = await post(body);
      expect(r.code, JSON.stringify(body)).toBe(400);
      expect(r.body.message, JSON.stringify(body)).toContain(text);
    }
    expect(status('id1')).toBe('in_progress'); // nothing was closed by the bad requests
    const noName = res();
    await ctl.postScraperResults({ get: () => '', body: { status: 'done' }, query: {} }, noName);
    expect(noName.code).toBe(400);
  });

  it('is 503 while the feature is off', async () => {
    pool();
    config.customKeywords.enabled = false;
    expect((await post({ status: 'done' })).code).toBe(503);
  });
});

describe('allowedUserIds (who gets Custom Keyword)', () => {
  const { customKeywordAllowed } = require('../../../src/services/google/insertion/normalize');
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const { searchAds } = require('../../../src/services/google/controllers/adSearchController');
  const prev = { enabled: config.customKeywords.enabled };
  const prevGetMongo = dbManager.getMongo;
  afterEach(() => { config.customKeywords.enabled = prev.enabled; dbManager.getMongo = prevGetMongo; });
  const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  it('helper: off = nobody, empty list = everyone, ids = only those (compared as strings)', () => {
    expect(customKeywordAllowed({ enabled: false, allowedUserIds: [] }, 1)).toBe(false);
    expect(customKeywordAllowed({ enabled: true, allowedUserIds: [] }, 1)).toBe(true);
    expect(customKeywordAllowed({ enabled: true }, 1)).toBe(true);
    expect(customKeywordAllowed({ enabled: true, allowedUserIds: ['72479'] }, 72479)).toBe(true);
    expect(customKeywordAllowed({ enabled: true, allowedUserIds: ['72479'] }, '72479')).toBe(true);
    expect(customKeywordAllowed({ enabled: true, allowedUserIds: ['72479'] }, 1)).toBe(false);
    expect(customKeywordAllowed({ enabled: true, allowedUserIds: ['72479'] }, undefined)).toBe(false);
  });

  it('user routes: 503 when off, 404 for a user outside the list, next() for an allowed user', () => {
    const run = (user) => { const r = res(); const next = vi.fn(); ctl.requireAccess({ user }, r, next); return { r, next }; };
    config.customKeywords.enabled = false;
    expect(run({ user_id: 72479 }).r.code).toBe(503);
    config.customKeywords.enabled = true;
    config.customKeywords.allowedUserIds = ['72479'];
    expect(run({ user_id: 305 }).r.code).toBe(404);
    expect(run({ user_id: 305 }).next).not.toHaveBeenCalled();
    expect(run({ user_id: 72479 }).next).toHaveBeenCalled();
    config.customKeywords.allowedUserIds = [];
    expect(run({ user_id: 305 }).next).toHaveBeenCalled();
  });

  it('/access probe tells the frontend whether to show the feature', () => {
    const probe = (user) => { const r = res(); ctl.accessProbe({ user }, r); return r.body.data.enabled; };
    config.customKeywords.enabled = true;
    config.customKeywords.allowedUserIds = ['72479'];
    expect(probe({ user_id: 72479 })).toBe(true);
    expect(probe({ user_id: 305 })).toBe(false);
    config.customKeywords.enabled = false;
    expect(probe({ user_id: 72479 })).toBe(false);
  });

  it('search: only an allowed user gets their own-ads clause', async () => {
    config.customKeywords.enabled = true;
    config.customKeywords.allowedUserIds = ['281'];
    const body = async (uid) => {
      const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } }));
      await searchAds({ body: { user_id: uid, keyword: 'nike' }, query: {}, user: { user_id: uid } }, { elastic: { indexName: 'i', search } }, { info() {}, error() {}, warn() {} });
      return JSON.stringify(search.mock.calls[0][0].body);
    };
    expect(await body(281)).toContain('"custom_keyword":"281:nike"');
    expect(await body(305)).not.toContain('custom_keyword');
  });
});

describe('sample download and upload: .csv and .xlsx only', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const express = require('express');
  const request = require('supertest');
  const ExcelJS = require('exceljs');
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const prevGetMongo = dbManager.getMongo;
  const prevEnabled = config.customKeywords.enabled;
  const tmpUploads = path.join(os.tmpdir(), 'pas-custom-keywords');
  let saved;
  let existingNorms;

  const makeApp = (userId = 72479) => {
    const app = express();
    app.use((req, _res, next) => { req.user = { user_id: userId }; next(); });
    app.get('/sample', ctl.requireAccess, ctl.downloadSample);
    app.post('/upload', ctl.requireAccess, ctl.uploadMiddleware, ctl.uploadKeywords);
    return app;
  };
  const leftovers = () => (fs.existsSync(tmpUploads) ? fs.readdirSync(tmpUploads).length : 0);
  const xlsxBuffer = async (rows, header = 'keyword') => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Keywords');
    ws.addRow([header]);
    rows.forEach((r) => ws.addRow([r]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  beforeEach(() => {
    config.customKeywords.enabled = true;
    config.customKeywords.allowedUserIds = [];
    saved = [];
    existingNorms = new Set(); // keywords this user already has in the stand-in database
    const col = {
      createIndexes: async () => [],
      countDocuments: async () => existingNorms.size,
      // Like Mongo's upsert: only keywords not seen before are inserted, and upsertedIds is keyed by operation position.
      bulkWrite: async (ops) => {
        const upsertedIds = {};
        ops.forEach((o, idx) => {
          const doc = o.updateOne.update.$setOnInsert;
          if (existingNorms.has(doc.keywordNorm)) return;
          existingNorms.add(doc.keywordNorm);
          saved.push(doc);
          upsertedIds[idx] = `new${idx}`;
        });
        return { upsertedCount: Object.keys(upsertedIds).length, upsertedIds };
      },
    };
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
  });
  afterEach(() => { config.customKeywords.enabled = prevEnabled; dbManager.getMongo = prevGetMongo; });

  it('sample: xlsx by default, csv on request, anything else is a 400', async () => {
    const x = await request(makeApp()).get('/sample').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['content-disposition']).toContain('custom-keywords-sample.xlsx');
    expect(x.body.slice(0, 2).toString()).toBe('PK'); // an .xlsx is a zip

    const c = await request(makeApp()).get('/sample?format=csv');
    expect(c.status).toBe(200);
    expect(c.headers['content-type']).toContain('text/csv');
    expect(c.headers['content-disposition']).toContain('custom-keywords-sample.csv');
    expect(c.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)).toEqual(['keyword', 'nike running shoes', 'best crm software', 'gym bag']);

    const bad = await request(makeApp()).get('/sample?format=pdf');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("'xlsx' or 'csv'");
  });

  it('upload: a .csv file works (comma, BOM, any header case)', async () => {
    const before = leftovers();
    const csv = Buffer.from('\uFEFFKeyword\r\nnike shoes\r\n"best, crm"\r\n  gym bag  \r\nnike shoes\r\n');
    const r = await request(makeApp()).post('/upload').attach('file', csv, 'my-keywords.csv');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ received: 4, added: 3, duplicates: 1 });
    expect(saved.map((d) => d.keyword)).toEqual(['nike shoes', 'best, crm', 'gym bag']);
    expect(saved.every((d) => d.userId === 72479 && d.status === 'pending')).toBe(true);
    expect(leftovers()).toBe(before); // the temp file is removed
  });

  it('upload: a semicolon-separated .csv (Excel in some locales) works', async () => {
    const r = await request(makeApp()).post('/upload').attach('file', Buffer.from('keyword;note\nyoga mat;1\ngym bag;2\n'), 'k.csv');
    expect(r.status).toBe(200);
    expect(saved.map((d) => d.keyword)).toEqual(['yoga mat', 'gym bag']);
  });

  it('upload: an .xlsx file works', async () => {
    const r = await request(makeApp()).post('/upload').attach('file', await xlsxBuffer(['nike shoes', 'yoga mat']), 'k.xlsx');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ received: 2, added: 2 });
  });

  it('upload: any other file type gets a clear error and nothing is saved', async () => {
    const before = leftovers();
    for (const name of ['notes.pdf', 'notes.txt', 'keywords.json', 'keywords', 'data.csv.exe', 'sheet.xlsm']) {
      const r = await request(makeApp()).post('/upload').attach('file', Buffer.from('keyword\nnike\n'), name);
      expect(r.status, name).toBe(400);
      expect(r.body.message, name).toContain('Only .csv and .xlsx files are allowed');
    }
    const pdf = await request(makeApp()).post('/upload').attach('file', Buffer.from('x'), 'notes.pdf');
    expect(pdf.body.message).toContain('".pdf"');
    const xls = await request(makeApp()).post('/upload').attach('file', Buffer.from('x'), 'old.xls');
    expect(xls.status).toBe(400);
    expect(xls.body.message).toContain('Old Excel files (.xls) are not supported');
    expect(saved).toHaveLength(0);
    expect(leftovers()).toBe(before);
  });

  it('upload: a missing "keyword" column, an unreadable file, or no file are all clear 400s', async () => {
    const noHeader = await request(makeApp()).post('/upload').attach('file', Buffer.from('name\nnike\n'), 'k.csv');
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.message).toContain('column named "keyword"');

    const fakeXlsx = await request(makeApp()).post('/upload').attach('file', Buffer.from('this is not a spreadsheet'), 'k.xlsx');
    expect(fakeXlsx.status).toBe(400);
    expect(fakeXlsx.body.message).toContain('not a valid Excel (.xlsx) file');

    // A zip signature but a broken workbook passes the byte check and fails while reading.
    const corrupt = await request(makeApp()).post('/upload').attach('file', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage')]), 'k.xlsx');
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.message).toContain('could not read this file');

    const none = await request(makeApp()).post('/upload');
    expect(none.status).toBe(400);
    expect(none.body.message).toContain('.csv or .xlsx');
  });

  it('upload: the file must really be what its extension says (renamed files are refused)', async () => {
    const before = leftovers();
    const post = (buf, name) => request(makeApp()).post('/upload').attach('file', buf, name);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n\x00\x00binary');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.from([0, 0, 0, 0]), Buffer.from('This program cannot be run')]);
    const oldXls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(40)]);
    const utf16 = Buffer.from('\uFEFFkeyword\nnike\n', 'utf16le');
    const realXlsx = await xlsxBuffer(['nike shoes']);

    const cases = [
      ['PDF named .csv', pdf, 'a.csv', 'not a text CSV'],
      ['PDF named .xlsx', pdf, 'a.xlsx', 'not a valid Excel (.xlsx) file'],
      ['program named .csv', exe, 'a.csv', 'not a text CSV'],
      ['program named .xlsx', exe, 'a.xlsx', 'not a valid Excel (.xlsx) file'],
      ['real .xlsx named .csv', realXlsx, 'a.csv', 'Excel file saved with a .csv name'],
      ['old .xls named .csv', oldXls, 'a.csv', 'old Excel (.xls) file saved with a .csv name'],
      ['old .xls named .xlsx', oldXls, 'a.xlsx', 'old Excel (.xls) file saved with an .xlsx name'],
      ['UTF-16 text named .csv', utf16, 'a.csv', 'not a text CSV'],
      ['a PDF with a plain-text start named .csv', Buffer.from('%PDF-1.4 plain looking text only'), 'a.csv', 'not a text CSV'],
      ['a PNG named .csv', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]), 'a.csv', 'not a text CSV'],
      ['a JPEG named .csv', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('rest')]), 'a.csv', 'not a text CSV'],
      ['a gzip file named .csv', Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('rest')]), 'a.csv', 'not a text CSV'],
      ['plain text named .xlsx', Buffer.from('keyword\nnike\n'), 'a.xlsx', 'not a valid Excel (.xlsx) file'],
      ['empty .csv', Buffer.alloc(0), 'a.csv', 'The file is empty'],
      ['empty .xlsx', Buffer.alloc(0), 'a.xlsx', 'The file is empty'],
    ];
    for (const [label, buf, name, expected] of cases) {
      const r = await post(buf, name);
      expect(r.status, label).toBe(400);
      expect(r.body.message, label).toContain(expected);
    }
    expect(saved).toHaveLength(0);
    expect(leftovers()).toBe(before);

    // and the genuine files still go through
    expect((await post(Buffer.from('keyword\nnike\n'), 'ok.csv')).status).toBe(200);
    expect((await post(realXlsx, 'ok.xlsx')).status).toBe(200);
  });

  it('upload: every keyword in the sheet gets a result: added, duplicate (already saved / repeated), invalid', async () => {
    existingNorms.add('old one'); // saved by an earlier upload
    const csv = Buffer.from(['keyword', 'New One', 'Old  One', 'new one', 'x'.repeat(101), 'Another'].join('\n'));
    const r = await request(makeApp()).post('/upload').attach('file', csv, 'k.csv');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ received: 5, added: 2, duplicates: 2 });
    expect(r.body.data.items).toEqual([
      { row: 2, keyword: 'New One', result: 'added' },
      { row: 3, keyword: 'Old One', result: 'duplicate', reason: 'already in your list' },
      { row: 4, keyword: 'new one', result: 'duplicate', reason: 'repeated in your file' },
      { row: 5, keyword: `${'x'.repeat(60)}…`, result: 'invalid', reason: 'longer than 100 characters' },
      { row: 6, keyword: 'Another', result: 'added' },
    ]);
    expect(saved.map((d) => d.keyword)).toEqual(['New One', 'Another']);
  });

  it('upload: keywords beyond the per-user limit come back as not_added', async () => {
    const prevMax = config.customKeywords.maxKeywordsPerUser;
    config.customKeywords.maxKeywordsPerUser = 2;
    try {
      const r = await request(makeApp()).post('/upload').attach('file', Buffer.from('keyword\na\nb\nc\nd\n'), 'k.csv');
      expect(r.status).toBe(200);
      expect(r.body.data.items.map((i) => i.result)).toEqual(['added', 'added', 'not_added', 'not_added']);
      expect(r.body.data.items[2].reason).toBe('over your limit of 2 keywords');
      expect(r.body.data).toMatchObject({ added: 2, notAddedOverLimit: 2 });
    } finally { config.customKeywords.maxKeywordsPerUser = prevMax; }
  });

  it('upload: uploading the same sheet again marks every keyword as a duplicate', async () => {
    const csv = Buffer.from('keyword\nnike\nyoga\n');
    await request(makeApp()).post('/upload').attach('file', csv, 'k.csv');
    const again = await request(makeApp()).post('/upload').attach('file', csv, 'k.csv');
    expect(again.body.data).toMatchObject({ added: 0, duplicates: 2 });
    expect(again.body.data.items.map((i) => i.result)).toEqual(['duplicate', 'duplicate']);
  });

  it('upload and sample are 404 for a user outside allowedUserIds', async () => {
    config.customKeywords.allowedUserIds = ['72479'];
    const app = makeApp(305);
    expect((await request(app).get('/sample')).status).toBe(404);
    expect((await request(app).post('/upload').attach('file', Buffer.from('keyword\nnike\n'), 'k.csv')).status).toBe(404);
    expect(saved).toHaveLength(0);
  });
});

describe('owners are told when their keyword has been scraped (bell + push)', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const ctl = require('../../../src/services/google/controllers/customKeywordsController');
  const notifyCtl = require('../../../src/services/common/controllers/keywordAdNotificationController');
  const firebase = require('../../../src/services/FirebaseService');
  const profileRepo = require('../../../src/services/profile/repository');
  const ks = config.keywordSearch;
  const saved = {};

  beforeEach(() => {
    Object.assign(saved, {
      enabled: config.customKeywords.enabled, notifyEnabled: config.customKeywords.notifyEnabled,
      ksEnabled: ks.enabled, ksNotify: ks.notify.enabled,
      getMongo: dbManager.getMongo, getSQL: dbManager.getSQL, send: firebase.sendNotification,
      isOn: profileRepo.isNotificationEnabled, notifyFn: notifyCtl.notifyCustomKeywordScraped,
    });
    config.customKeywords.enabled = true;
    config.customKeywords.notifyEnabled = true;
    ks.enabled = true;
    ks.notify.enabled = true;
  });
  afterEach(() => {
    config.customKeywords.enabled = saved.enabled; config.customKeywords.notifyEnabled = saved.notifyEnabled;
    ks.enabled = saved.ksEnabled; ks.notify.enabled = saved.ksNotify;
    dbManager.getMongo = saved.getMongo; dbManager.getSQL = saved.getSQL; firebase.sendNotification = saved.send;
    profileRepo.isNotificationEnabled = saved.isOn; notifyCtl.notifyCustomKeywordScraped = saved.notifyFn;
  });

  // ── the helper itself: notifyCustomKeywordScraped ──
  const setup = ({ tokens = { 1: 'tok1', 2: 'tok2' }, prefs = {}, bellFails = [] } = {}) => {
    const upserts = [];
    const col = {
      createIndexes: async () => [],
      updateOne: vi.fn(async (filter, update, opts) => {
        if (bellFails.includes(filter.userId)) throw new Error('mongo write failed');
        upserts.push({ filter, update, opts });
        return { upsertedCount: 1 };
      }),
    };
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
    dbManager.getSQL = () => ({ query: async (_sql, [id]) => [tokens[id] ? [{ fcm_token: tokens[id] }] : []] });
    const sent = [];
    firebase.sendNotification = vi.fn(async (...args) => { sent.push(args); });
    profileRepo.isNotificationEnabled = vi.fn(async (id, key) => (prefs[id] === undefined ? true : prefs[id]) && key === 'keyword_search_results');
    return { col, upserts, sent };
  };
  const notify = (over = {}) => notifyCtl.notifyCustomKeywordScraped({ userIds: [1, 2], keyword: 'Gym Bag', keywordNorm: 'gym bag', ...over });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  it('bell: one document per owner in the collection the bell already reads, shaped like the existing ones', async () => {
    const { upserts } = setup();
    const r = await notify();
    expect(r).toEqual({ bell: 2, push: 2 });
    expect(upserts.map((u) => u.filter)).toEqual([
      { userId: 1, valueNorm: 'gym bag', type: 0, network: 'google', date: expect.any(String) },
      { userId: 2, valueNorm: 'gym bag', type: 0, network: 'google', date: expect.any(String) },
    ]);
    expect(upserts[0].update.$set).toMatchObject({ value: 'Gym Bag', source: 'custom_keyword' });
    expect(upserts[0].update.$setOnInsert).toMatchObject({ notified: false });
    expect(upserts[0].opts).toEqual({ upsert: true });
  });

  it('push: sent to each owner with a token, with a link that opens that Google keyword search', async () => {
    const { sent } = setup();
    await notify({ keyword: 'best crm & more' });
    expect(sent).toEqual([
      ['tok1', 'Your keyword has been scraped', 'We found ads for your keyword "best crm & more". Tap to view.', '', '/?keyword=best%20crm%20%26%20more&platform=google'],
      ['tok2', 'Your keyword has been scraped', 'We found ads for your keyword "best crm & more". Tap to view.', '', '/?keyword=best%20crm%20%26%20more&platform=google'],
    ]);
  });

  it('push: skipped for an owner with no token or with the Profile "Keyword search results" switch off; the bell is unaffected', async () => {
    const { upserts, sent } = setup({ tokens: { 1: 'tok1' }, prefs: { 1: false, 2: true } });
    const r = await notify();
    expect(r).toEqual({ bell: 2, push: 0 }); // user 1 switched push off, user 2 has no token
    expect(sent).toEqual([]);
    expect(upserts).toHaveLength(2);
  });

  it('a user appears once even if listed twice, and an empty owner list does nothing', async () => {
    const { upserts } = setup();
    await notify({ userIds: [1, 1, 2, null, undefined] });
    expect(upserts).toHaveLength(2);
    expect(await notify({ userIds: [] })).toEqual({ bell: 0, push: 0 });
    expect(await notify({ keyword: '' })).toEqual({ bell: 0, push: 0 });
  });

  it('does nothing when custom keywords or their notifications are switched off', async () => {
    const { upserts, sent } = setup();
    config.customKeywords.notifyEnabled = false;
    expect(await notify()).toEqual({ bell: 0, push: 0 });
    config.customKeywords.notifyEnabled = true;
    config.customKeywords.enabled = false;
    expect(await notify()).toEqual({ bell: 0, push: 0 });
    expect(upserts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('no bell rows when the existing bell is off, but the push still goes out', async () => {
    const { upserts, sent } = setup();
    ks.notify.enabled = false;
    expect(await notify()).toEqual({ bell: 0, push: 2 });
    expect(upserts).toHaveLength(0);
    expect(sent).toHaveLength(2);
  });

  it('never throws: one owner failing does not stop the others, and a push failure does not undo the bell', async () => {
    const { upserts } = setup({ bellFails: [1] });
    const r = await notify();
    expect(r.bell).toBe(1);
    expect(upserts.map((u) => u.filter.userId)).toEqual([2]);
    firebase.sendNotification = vi.fn(async () => { throw new Error('fcm down'); });
    await expect(notify()).resolves.toMatchObject({ push: 0 });
    dbManager.getMongo = () => { throw new Error('mongo down'); };
    await expect(notify()).resolves.toEqual({ bell: 0, push: 0 });
  });

  // ── the hook in the scraper POST ──
  const makeNotifyCollection = (docs) => makeCollection(docs);
  const post = async (col, body, scraper = 's1') => {
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
    const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; };
    await ctl.postScraperResults({ get: () => scraper, body, query: {} }, r);
    return r;
  };
  const take = async (col, query, scraper = 's1') => {
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
    const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; };
    await ctl.getScraperKeywords({ get: () => scraper, query, body: {} }, r);
    return r;
  };

  it('POST results: a keyword closed as done notifies its owners once; the answer shows no user ids', async () => {
    const col = makeNotifyCollection([{ userId: 11, keyword: 'Gym Bag' }, { userId: 12, keyword: 'gym  bag' }, { userId: 13, keyword: 'yoga mat' }]);
    notifyCtl.notifyCustomKeywordScraped = vi.fn(async () => ({ bell: 2, push: 2 }));
    await take(col, { size: '2' });
    const r = await post(col, { results: [{ keyword: 'gym bag', status: 'done' }, { keyword: 'yoga mat', status: 'done' }] });
    expect(r.body.closed).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toMatch(/userIds|"userId"|11|12|13/);
    expect(notifyCtl.notifyCustomKeywordScraped).toHaveBeenCalledTimes(2);
    expect(notifyCtl.notifyCustomKeywordScraped).toHaveBeenCalledWith({ userIds: [11, 12], keyword: 'Gym Bag', keywordNorm: 'gym bag' });
    expect(notifyCtl.notifyCustomKeywordScraped).toHaveBeenCalledWith({ userIds: [13], keyword: 'yoga mat', keywordNorm: 'yoga mat' });
  });

  it('POST results: {status:"done"} notifies for everything it closes', async () => {
    const col = makeNotifyCollection([{ userId: 11, keyword: 'gym bag' }, { userId: 12, keyword: 'yoga mat' }]);
    notifyCtl.notifyCustomKeywordScraped = vi.fn(async () => ({}));
    await take(col, { size: '2' });
    await post(col, { status: 'done' });
    expect(notifyCtl.notifyCustomKeywordScraped).toHaveBeenCalledTimes(2);
  });

  it('POST results: no notification for no_ads_found, failed, or a keyword this scraper does not hold', async () => {
    const col = makeNotifyCollection([{ userId: 11, keyword: 'gym bag' }, { userId: 12, keyword: 'yoga mat' }, { userId: 13, keyword: 'nike shoes' }]);
    notifyCtl.notifyCustomKeywordScraped = vi.fn(async () => ({}));
    await take(col, { size: '2' });
    await post(col, { results: [{ keyword: 'gym bag', status: 'no_ads_found' }, { keyword: 'yoga mat', status: 'failed' }, { keyword: 'nike shoes', status: 'done' }] });
    expect(notifyCtl.notifyCustomKeywordScraped).not.toHaveBeenCalled();
    await post(col, { results: [{ keyword: 'gym bag', status: 'done' }] }, 's2'); // another scraper cannot close it
    expect(notifyCtl.notifyCustomKeywordScraped).not.toHaveBeenCalled();
  });

  it('POST results: reporting done twice notifies once', async () => {
    const col = makeNotifyCollection([{ userId: 11, keyword: 'gym bag' }]);
    notifyCtl.notifyCustomKeywordScraped = vi.fn(async () => ({}));
    await take(col, { size: '1' });
    await post(col, { results: [{ keyword: 'gym bag', status: 'done' }] });
    await post(col, { results: [{ keyword: 'gym bag', status: 'done' }] });
    expect(notifyCtl.notifyCustomKeywordScraped).toHaveBeenCalledTimes(1);
  });

  it('POST results: a notification failure never fails or delays the scraper (even a throw or a rejection)', async () => {
    const col = makeNotifyCollection([{ userId: 11, keyword: 'gym bag' }, { userId: 12, keyword: 'yoga mat' }]);
    await take(col, { size: '2' });
    notifyCtl.notifyCustomKeywordScraped = vi.fn(() => { throw new Error('sync boom'); });
    const a = await post(col, { results: [{ keyword: 'gym bag', status: 'done' }] });
    expect(a.code).toBe(200);
    expect(a.body.closed).toHaveLength(1);
    notifyCtl.notifyCustomKeywordScraped = vi.fn(async () => { throw new Error('async boom'); });
    const b = await post(col, { results: [{ keyword: 'yoga mat', status: 'done' }] });
    expect(b.code).toBe(200);
    expect(b.body.closed).toHaveLength(1);
  });
});
