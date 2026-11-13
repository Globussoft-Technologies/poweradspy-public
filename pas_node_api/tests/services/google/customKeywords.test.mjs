import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const config = require('../../../src/config');
const repo = require('../../../src/services/google/insertion/repository');
const api = require('../../../src/insertion/helpers/apiClients');
const { normCustomKeyword, customKeywordToken } = require('../../../src/services/google/insertion/normalize');
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

  it('/next: with an allow-list only allowed owners are claimed and counted; without one, no owner filter', async () => {
    config.customKeywords.enabled = true;
    const col = {
      createIndexes: vi.fn(async () => []), findOne: vi.fn(async () => null), updateOne: vi.fn(async () => ({ modifiedCount: 0 })),
      findOneAndUpdate: vi.fn(async () => null), countDocuments: vi.fn(async () => 0), estimatedDocumentCount: vi.fn(async () => 0),
    };
    dbManager.getMongo = () => ({ db: { collection: () => col }, client: { db: () => ({ collection: () => col }) } });
    const call = async () => { const r = res(); await ctl.nextKeyword({ get: () => 's1', body: {}, query: {} }, r); };

    config.customKeywords.allowedUserIds = ['72479', 'abc', '281'];
    await call();
    expect(col.findOneAndUpdate.mock.calls.at(-1)[0].userId).toEqual({ $in: [72479, 281] });
    expect(col.countDocuments.mock.calls.at(-1)[0]).toEqual({ status: 'pending', userId: { $in: [72479, 281] } });

    config.customKeywords.allowedUserIds = [];
    await call();
    expect('userId' in col.findOneAndUpdate.mock.calls.at(-1)[0]).toBe(false);
    expect(col.countDocuments.mock.calls.at(-1)[0]).toEqual({ status: 'pending' });
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
    const col = {
      createIndexes: async () => [],
      countDocuments: async () => 0,
      bulkWrite: async (ops) => { ops.forEach((o) => saved.push(o.updateOne.update.$setOnInsert)); return { upsertedCount: ops.length }; },
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

  it('upload and sample are 404 for a user outside allowedUserIds', async () => {
    config.customKeywords.allowedUserIds = ['72479'];
    const app = makeApp(305);
    expect((await request(app).get('/sample')).status).toBe(404);
    expect((await request(app).post('/upload').attach('file', Buffer.from('keyword\nnike\n'), 'k.csv')).status).toBe(404);
    expect(saved).toHaveLength(0);
  });
});
