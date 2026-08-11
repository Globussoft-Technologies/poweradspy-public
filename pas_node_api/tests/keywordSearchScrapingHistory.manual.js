'use strict';
/* Manual integration test for POST /api/v1/common/keyword-search/scraping-history.
 * Uses the real controller against the real MongoDB collection, then deletes the test doc.
 * Run: node tests/keywordSearchScrapingHistory.manual.js
 */
const { MongoClient } = require('mongodb');
const config = require('../src/config');
const { storeKeywordSearch, addScrapingHistory } = require('../src/services/common/controllers/keywordSearchController');

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
    const doc = await col.findOne({ type: testType, valueNorm });
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

    // 4) Cleanup
    await col.deleteOne({ _id: doc._id });
    const after = await col.findOne({ type: testType, valueNorm });
    ok(!after, 'test document cleaned up');

    console.log('\nDone.');
  } catch (e) {
    console.error('TEST ERROR:', e);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
