import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const config = require('../../../src/config');
const repo = require('../../../src/services/google/insertion/repository');
const api = require('../../../src/insertion/helpers/apiClients');
const { normCustomKeyword, customKeywordToken } = require('../../../src/services/google/insertion/normalize');
const { processMetaAd } = require('../../../src/services/google/insertion/metaAdsPipeline');

const CFG = { enabled: true, maxKeywordLength: 100 };

describe('custom keyword helpers', () => {
  it('normalizes: trim, collapse spaces, lower-case, "|" becomes a space', () => {
    expect(normCustomKeyword('  Nike   Running SHOES ')).toBe('nike running shoes');
    expect(normCustomKeyword('a|b')).toBe('a b');
    expect(normCustomKeyword(null)).toBe('');
  });

  it('builds "<userId>:<keyword>" and is null when anything is missing or invalid', () => {
    expect(customKeywordToken({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: 281 }, CFG)).toBe('281:nike shoes');
    expect(customKeywordToken({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: '281' }, CFG)).toBe('281:nike shoes');
    expect(customKeywordToken({ custom_keyword: 'x' }, CFG)).toBeNull();
    expect(customKeywordToken({ custom_keyword_user_id: 1 }, CFG)).toBeNull();
    expect(customKeywordToken({ custom_keyword: 'x', custom_keyword_user_id: 0 }, CFG)).toBeNull();
    expect(customKeywordToken({ custom_keyword: 'x', custom_keyword_user_id: 'abc' }, CFG)).toBeNull();
    expect(customKeywordToken({ custom_keyword: 'x'.repeat(101), custom_keyword_user_id: 1 }, CFG)).toBeNull();
  });

  it('is null when the feature is off', () => {
    expect(customKeywordToken({ custom_keyword: 'x', custom_keyword_user_id: 1 }, { ...CFG, enabled: false })).toBeNull();
    expect(customKeywordToken({ custom_keyword: 'x', custom_keyword_user_id: 1 }, undefined)).toBeNull();
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

  it('UPDATE: writes the SQL tag and adds it to the ES array with an atomic script', async () => {
    config.customKeywords.enabled = true;
    const r = await run(validAd({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: 281 }), true);
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).toHaveBeenCalledWith(expect.anything(), 7, '281:nike shoes');
    expect(elastic.update).toHaveBeenCalledTimes(2);
    const scripted = elastic.update.mock.calls[1][0];
    expect(scripted.retry_on_conflict).toBe(3);
    expect(scripted.body.script.params).toEqual({ t: '281:nike shoes' });
    expect(scripted.body.script.source).toContain('custom_keyword');
  });

  it('UPDATE: nothing extra happens when the feature is off', async () => {
    config.customKeywords.enabled = false;
    const r = await run(validAd({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: 281 }), true);
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect(elastic.update).toHaveBeenCalledTimes(1);
  });

  it('UPDATE: a failing SQL write never fails the ad', async () => {
    config.customKeywords.enabled = true;
    stubRepo({ existing: true });
    repo.mergeVariantCustomKeyword = vi.fn(async () => { throw new Error("Unknown column 'custom_keyword'"); });
    const r = await processMetaAd(validAd({ custom_keyword: 'a', custom_keyword_user_id: 1 }), { db: { sql: {}, elastic }, log: { warn: vi.fn(), error: vi.fn() }, network: 'google' });
    expect(r.code).toBe(200);
  });

  it('INSERT: the new ES doc gets custom_keyword as an array', async () => {
    config.customKeywords.enabled = true;
    const r = await run(validAd({ custom_keyword: 'Nike Shoes', custom_keyword_user_id: 281 }), false);
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).toHaveBeenCalledWith(expect.anything(), 10, '281:nike shoes');
    const body = elastic.index.mock.calls[0][0].body;
    expect(body.custom_keyword).toEqual(['281:nike shoes']);
  });

  it('INSERT: an ordinary ad gets no custom_keyword key and no extra SQL (unchanged)', async () => {
    config.customKeywords.enabled = true;
    const r = await run(validAd(), false);
    expect(r.code).toBe(200);
    expect(repo.mergeVariantCustomKeyword).not.toHaveBeenCalled();
    expect('custom_keyword' in elastic.index.mock.calls[0][0].body).toBe(false);
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

describe('scraper /next (the only scraper call)', () => {
  const dbManager = require('../../../src/database/DatabaseManager');
  const { nextKeyword } = require('../../../src/services/google/controllers/customKeywordsController');
  const prevEnabled = config.customKeywords.enabled;
  const prevGetMongo = dbManager.getMongo;
  afterEach(() => { config.customKeywords.enabled = prevEnabled; dbManager.getMongo = prevGetMongo; });

  const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const useCol = (col) => { dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } }); };
  const fakeCol = (over = {}) => ({
    createIndexes: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => ({ modifiedCount: 0 })),
    findOneAndUpdate: vi.fn(async () => ({ _id: 'k2', keyword: 'yoga mat', userId: 281, attempts: 1 })),
    countDocuments: vi.fn(async () => 11),
    estimatedDocumentCount: vi.fn(async () => 40),
    ...over,
  });

  it('hands out a keyword with how many are left and the total', async () => {
    config.customKeywords.enabled = true;
    useCol(fakeCol());
    const r = res();
    await nextKeyword({ get: () => 'scraper-1', body: {}, query: {} }, r);
    expect(r.body).toMatchObject({
      code: 200, message: 'claimed', scraper: 'scraper-1', left: 11, total: 40,
      data: { id: 'k2', keyword: 'yoga mat', userId: 281, attempt: 1 },
    });
  });

  it('says there is nothing left when no keyword can be claimed', async () => {
    config.customKeywords.enabled = true;
    useCol(fakeCol({ findOneAndUpdate: vi.fn(async () => null), countDocuments: vi.fn(async () => 0) }));
    const r = res();
    await nextKeyword({ get: () => 'scraper-1', body: {}, query: {} }, r);
    expect(r.body).toMatchObject({ message: 'no pending keywords', data: null, left: 0 });
  });

  it('needs a scraper name, and a valid status', async () => {
    config.customKeywords.enabled = true;
    useCol(fakeCol());
    const a = res();
    await nextKeyword({ get: () => '', body: {}, query: {} }, a);
    expect(a.code).toBe(400);
    const b = res();
    await nextKeyword({ get: () => 'scraper-1', body: { status: 'bad' }, query: {} }, b);
    expect(b.code).toBe(400);
  });

  it('is 503 while the feature is off', async () => {
    config.customKeywords.enabled = false;
    const r = res();
    await nextKeyword({ get: () => 'scraper-1', body: {}, query: {} }, r);
    expect(r.code).toBe(503);
  });
});
