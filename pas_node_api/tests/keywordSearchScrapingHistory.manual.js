'use strict';
/* Manual integration test for POST /api/v1/common/keyword-search/scraping-history.
 * Uses the real controller against the real MongoDB collection, then deletes the test doc.
 * Run: node tests/keywordSearchScrapingHistory.manual.js
 *
 * Needs the 'facebook' network's Mongo connection enabled (FB_MONGO_ENABLED=true in
 * env/.env) since keywordSearch.mongoSlug defaults to 'facebook' — it's usually already
 * on in real dev/staging envs; only a from-scratch local .env may need it added.
 */
const { MongoClient } = require('mongodb');
const config = require('../src/config');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const { storeKeywordSearch, addScrapingHistory, recoverStaleClaims } = require('../src/services/common/controllers/keywordSearchController');

const URI = config.databases.mongo.uri;
const DB = config.keywordSearch.database || config.databases.mongo.database;
const COLL = config.keywordSearch.collection;

const ok = (c, m) => console.log(`${c ? '✅' : '❌'} ${m}`);

function mockReq(body = {}, user = {}) {
  return {
    body,
    user,
    get: () => undefined,
    query: {},
  };
}

function mockRes() {
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status: (code) => { statusCode = code; return res; },
    json: (body) => { jsonBody = body; return Promise.resolve(); },
  };
  res._status = () => statusCode;
  res._json = () => jsonBody;
  return res;
}

(async () => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const col = client.db(DB).collection(COLL);

    // The controller reads/writes through DatabaseManager's per-network pool
    // (dbManager.getMongo(keywordSearch.mongoSlug)), not a bare connection — it
    // needs the same startup wiring app.js does before addScrapingHistory() etc.
    // will find a collection instead of 503'ing.
    await databaseManager.connectAll(networksConfig);

    const testValue = `__test_scraping_history_${Date.now()}`;
    const testType = 2;
    const valueNorm = testValue.toLowerCase();

    // 1) Store the keyword via the real controller
    const storeRes = mockRes();
    await storeKeywordSearch(
      mockReq({
        value: testValue,
        type: testType,
        network: 'facebook',
        email: 'test@example.com',
      }, { id: 99999, email: 'test@example.com', login: 'tester' }),
      storeRes
    );
    ok(storeRes._status() === 200 && storeRes._json().code === 200, `stored test keyword '${testValue}' (type:${testType})`);
    console.log('store response:', storeRes._status(), JSON.stringify(storeRes._json()));

    // 2) Append scraping history via the real controller
    const historyRes = mockRes();
    await addScrapingHistory(
      mockReq({
        keyword: testValue,
        type: testType,
        network: 'facebook',
        owner: 'DS-01-meta-26',
        mode: 'daily',
        status: 'completed',
        start_time: '2026-08-10T10:00:00Z',
        end_time: '2026-08-10T11:00:00Z',
        ads_count: 20,
      }),
      historyRes
    );

    const historyJson = historyRes._json();
    ok(historyRes._status() === 200 && historyJson.code === 200, 'addScrapingHistory returned 200');
    ok(historyJson.data.value === testValue, `response echoes value '${testValue}'`);
    ok(historyJson.data.network === 'facebook', 'response echoes network facebook');
    ok(historyJson.data.mode === 'daily', 'response echoes mode daily');
    ok(historyJson.data.status === 'completed', 'response echoes status completed');
    ok(historyJson.data.scrapeId, 'response includes a scrapeId');
    ok(historyJson.data.docId, 'response includes a docId');

    // 3) Verify the document in MongoDB
    let doc = await col.findOne({ type: testType, valueNorm });
    ok(doc, 'document found in MongoDB');
    ok(doc.scrapping_status && doc.scrapping_status.length === 1, `scrapping_status has 1 entry (got ${doc?.scrapping_status?.length})`);

    const sess = doc.scrapping_status[0];
    ok(sess.network === 'facebook', 'session network = facebook');
    ok(sess.type === testType, `session type = ${testType}`);
    ok(sess.mode === 'daily', 'session mode = daily');
    ok(sess.owner === 'DS-01-meta-26', 'session owner = DS-01-meta-26');
    ok(sess.status === 'completed', 'session status = completed');
    ok(sess.date === '2026-08-10', `session date = 2026-08-10 (got ${sess.date})`);
    ok(sess.startTime && sess.startTime.toISOString() === '2026-08-10T10:00:00.000Z', 'session startTime correct');
    ok(sess.endTime && sess.endTime.toISOString() === '2026-08-10T11:00:00.000Z', 'session endTime correct');
    ok(sess.adsCount === 20, `session adsCount = 20 (got ${sess.adsCount})`);

    ok(doc.networkState.facebook.lastScrape.status === 'completed', 'networkState.facebook.lastScrape.status = completed');
    ok(doc.networkState.facebook.lastScrape.adsCount === 20, 'networkState.facebook.lastScrape.adsCount = 20');
    ok(doc.networkState.facebook.lastScrape.owner === 'DS-01-meta-26', 'networkState.facebook.lastScrape.owner = DS-01-meta-26');

    // 4) status: 'processing' must be stored as-is, NOT silently coerced to 'completed'
    // (regression test for the bug where 'processing' fell outside allowedStatuses).
    const procRes = mockRes();
    await addScrapingHistory(
      mockReq({
        keyword: testValue, type: testType, network: 'instagram',
        owner: 'DS-02-insta-tester', mode: 'daily', status: 'processing',
        start_time: '2026-08-19T09:00:00Z', end_time: '2026-08-19T09:05:00Z',
      }),
      procRes
    );
    ok(procRes._json()?.data?.status === 'processing', `'processing' echoed as-is (got '${procRes._json()?.data?.status}')`);
    doc = await col.findOne({ type: testType, valueNorm });
    const instaSession = doc.scrapping_status.find(s => s.network === 'instagram');
    ok(instaSession?.status === 'processing', `stored session status = 'processing' (got '${instaSession?.status}')`);
    ok(doc.networkState.instagram.lastScrape.status === 'processing', 'networkState.instagram.lastScrape.status = processing');

    // Same session later reports 'completed' → updates in place, does not duplicate.
    const doneRes = mockRes();
    await addScrapingHistory(
      mockReq({
        keyword: testValue, type: testType, network: 'instagram',
        owner: 'DS-02-insta-tester', mode: 'daily', status: 'completed',
        start_time: '2026-08-19T09:00:00Z', end_time: '2026-08-19T09:10:00Z', ads_count: 3,
      }),
      doneRes
    );
    ok(doneRes._json()?.data?.status === 'completed', `follow-up call transitions to 'completed' (got '${doneRes._json()?.data?.status}')`);
    doc = await col.findOne({ type: testType, valueNorm });
    const instaSessions = doc.scrapping_status.filter(s => s.network === 'instagram');
    ok(instaSessions.length === 1, `still exactly 1 instagram session, no duplicate (got ${instaSessions.length})`);
    ok(instaSessions[0].status === 'completed', `session status now 'completed' (got '${instaSessions[0].status}')`);

    // An unrecognized status still safely falls back to 'completed' (unchanged behavior).
    const garbageRes = mockRes();
    await addScrapingHistory(
      mockReq({ keyword: testValue, type: testType, network: 'youtube', owner: 'DS-03-yt-tester', mode: 'daily', status: 'not_a_real_status' }),
      garbageRes
    );
    ok(garbageRes._json()?.data?.status === 'completed', `unrecognized status falls back to 'completed' (got '${garbageRes._json()?.data?.status}')`);

    // 5) recoverStaleClaims() reaps a session stuck at 'processing' (not just 'scrapping').
    const staleStart = new Date(Date.now() - (config.keywordSearch.staleClaimMinutes + 5) * 60 * 1000);
    await addScrapingHistory(
      mockReq({
        keyword: testValue, type: testType, network: 'pinterest',
        owner: 'DS-04-stale-tester', mode: 'daily', status: 'processing',
        start_time: staleStart.toISOString(), end_time: staleStart.toISOString(),
      }),
      mockRes()
    );
    const beforeSweep = await col.findOne({ type: testType, valueNorm });
    const staleSession = beforeSweep.scrapping_status.find(s => s.network === 'pinterest');
    ok(staleSession?.status === 'processing', `stale-test session starts at 'processing' (got '${staleSession?.status}')`);

    await recoverStaleClaims();

    const afterSweep = await col.findOne({ type: testType, valueNorm });
    const reapedSession = afterSweep.scrapping_status.find(s => s.network === 'pinterest');
    ok(reapedSession?.status === 'failed', `stale 'processing' session reaped to 'failed' (got '${reapedSession?.status}')`);

    // 6) Cleanup
    doc = afterSweep;
    await col.deleteOne({ _id: doc._id });
    const after = await col.findOne({ type: testType, valueNorm });
    ok(!after, 'test document cleaned up');

    console.log('\nDone.');
  } catch (e) {
    console.error('TEST ERROR:', e);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await databaseManager.disconnectAll();
    await client.close();
  }
})();
