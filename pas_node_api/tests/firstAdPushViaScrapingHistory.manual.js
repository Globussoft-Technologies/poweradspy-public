'use strict';
/* Manual integration test: confirms addScrapingHistory() ('/keyword-search/scraping-history')
 * ALSO spawns a first-ad-push watcher, same as scraperWork() ('/keyword-search/work') does —
 * some scrapers report exclusively through this endpoint, and the watcher previously only
 * fired for the /work path. Unlike scraperWork(), this endpoint matches by {type, valueNorm}
 * on a doc this test creates itself (storeKeywordSearch), NOT a shared claim pool — safe to
 * drive through the real controller with no risk to unrelated real data.
 * Uses REAL timers (the watcher's fixed 1-minute initial delay + a short overridden
 * recheck interval), so this takes a bit over a minute to run.
 * Run: node tests/firstAdPushViaScrapingHistory.manual.js
 */
const { MongoClient } = require('mongodb');
const config = require('../src/config');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const firebaseService = require('../src/services/FirebaseService');

const URI = config.databases.mongo.uri;
const DB = config.keywordSearch.database || config.databases.mongo.database;
const COLL = config.keywordSearch.collection;

const ok = (c, m) => console.log(`${c ? '✅' : '❌'} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockReq(body = {}) {
  return { body, user: {}, get: () => undefined, query: {} };
}
function mockRes() {
  let statusCode = 200, jsonBody = null;
  const res = {
    status: (c) => { statusCode = c; return res; },
    json: (b) => { jsonBody = b; return Promise.resolve(); },
  };
  res._status = () => statusCode;
  res._json = () => jsonBody;
  return res;
}

(async () => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const sentPushes = [];
  let realGetElastic, realGetSQL, realSendNotification, realCheckInterval;
  try {
    await client.connect();
    const col = client.db(DB).collection(COLL);
    await databaseManager.connectAll(networksConfig);
    const { storeKeywordSearch, addScrapingHistory } = require('../src/services/common/controllers/keywordSearchController');

    const network = 'facebook';
    const testUserId = 999996;
    const testEmail = 'scraping-history-test@example.com';
    const testValue = `__test_scrapehist_push_${Date.now()}`;
    const valueNorm = testValue.toLowerCase();

    realCheckInterval = config.keywordSearch.notify.firstAdPushCheckIntervalSec;
    config.keywordSearch.notify.firstAdPushCheckIntervalSec = 2;

    realGetElastic = databaseManager.getElastic.bind(databaseManager);
    let fakeAdsCount = 0;
    databaseManager.getElastic = (net) => {
      const real = realGetElastic(net);
      if (net !== network || !real) return real;
      return {
        ...real,
        count: async (params) => {
          const q = JSON.stringify(params?.body?.query || '');
          if (q.includes(testValue)) return { count: fakeAdsCount };
          return real.count(params);
        },
      };
    };

    realGetSQL = databaseManager.getSQL.bind(databaseManager);
    databaseManager.getSQL = (net) => {
      const real = realGetSQL(net);
      return {
        ...real,
        query: async (sql, params) => {
          if (sql.includes('fcm_token') && params?.[0] === testUserId) return [{ fcm_token: 'FAKE_SCRAPEHIST_TEST_TOKEN' }];
          return real ? real.query(sql, params) : [];
        },
      };
    };

    realSendNotification = firebaseService.sendNotification.bind(firebaseService);
    firebaseService.sendNotification = async (token, header, text, image, actionUrl) => {
      if (token === 'FAKE_SCRAPEHIST_TEST_TOKEN') { sentPushes.push({ token, header, text }); return { fakeSend: true }; }
      return realSendNotification(token, header, text, image, actionUrl);
    };

    await col.deleteOne({ type: 2, valueNorm });

    // 1) Store the term via the real controller (own, isolated doc — type 2 = advertiser)
    const storeRes = mockRes();
    await storeKeywordSearch(
      mockReq({ value: testValue, type: 2, network, email: testEmail }),
      storeRes
    );
    ok(storeRes._status() === 200, `stored test term '${testValue}'`);

    // Real storeKeywordSearch uses whatever caller identity it resolves from req.user/body;
    // make sure our test user is actually attached to the doc's searcher list — patch it in
    // directly so the watcher has someone real (with our fake token) to push to.
    await col.updateOne(
      { type: 2, valueNorm },
      { $set: { userInfos: [{ id: testUserId, username: 'scrapehist-tester', email: testEmail }], users: [testEmail] } }
    );

    // 2) Scraper reports 'processing' (non-terminal, no ads_count yet) via THIS endpoint —
    // NOT via scraperWork()'s /work claim. This is the exact path that was silently never
    // spawning a watcher before this fix.
    console.log(`\n--- Reporting via addScrapingHistory (status: processing) for '${testValue}' ---`);
    const histRes = mockRes();
    await addScrapingHistory(
      mockReq({
        keyword: testValue, type: 2, network,
        owner: 'scrapehist-test-scraper', mode: 'daily', status: 'processing',
      }),
      histRes
    );
    const histJson = histRes._json();
    ok(histRes._status() === 200 && histJson?.code === 200, `addScrapingHistory returned 200 (updated=${histJson?.data?.updated})`);
    ok(histJson?.data?.updated === false, 'this was a genuinely new session (updated:false), so a watcher should have spawned');

    await sleep(61000); // past the fixed 1-minute initial check — still 0 ads
    ok(sentPushes.length === 0, 'no push yet — 0 ads at the first check');

    fakeAdsCount = 2; // ads land now
    await sleep(2500); // past the (shortened, 2s) recheck
    ok(sentPushes.length === 1, `exactly one push sent once ads appeared (got ${sentPushes.length})`);
    const docAfter = await col.findOne({ type: 2, valueNorm });
    const pushed = docAfter.adFoundPushed || [];
    ok(pushed.length === 1 && pushed[0]?.userId === testUserId, 'dedup marker correctly written for our test user');

    // ═══ Scenario 2: ads_count reported DIRECTLY (e.g. Google Transparency) — must send ═══
    // ═══ immediately, with NO watcher/poll delay at all.                               ═══
    const testValue2 = `__test_scrapehist_known_${Date.now()}`;
    const valueNorm2 = testValue2.toLowerCase();
    await col.deleteOne({ type: 2, valueNorm: valueNorm2 });
    const storeRes2 = mockRes();
    await storeKeywordSearch(mockReq({ value: testValue2, type: 2, network, email: testEmail }), storeRes2);
    ok(storeRes2._status() === 200, `stored second test term '${testValue2}'`);
    await col.updateOne(
      { type: 2, valueNorm: valueNorm2 },
      { $set: { userInfos: [{ id: testUserId, username: 'scrapehist-tester', email: testEmail }], users: [testEmail] } }
    );

    console.log(`\n--- Reporting via addScrapingHistory WITH ads_count=3 directly (e.g. Google Transparency) for '${testValue2}' ---`);
    const pushCountBefore2 = sentPushes.length;
    const histRes2 = mockRes();
    await addScrapingHistory(
      mockReq({
        keyword: testValue2, type: 2, network,
        owner: 'scrapehist-test-scraper', mode: 'daily', status: 'completed', ads_count: 3,
      }),
      histRes2
    );
    ok(histRes2._status() === 200, 'addScrapingHistory (known count) returned 200');

    // sendFirstAdPushForKnownCount is fire-and-forget (not awaited by addScrapingHistory,
    // same as startFirstAdPushWatcher), so its own async Mongo/Firebase calls finish a
    // moment after the HTTP response — a brief wait, NOT the watcher's 60s+ delay, is
    // enough to prove this path skips the poll entirely.
    await sleep(300);
    ok(sentPushes.length === pushCountBefore2 + 1, `push sent almost immediately, no watcher delay (got ${sentPushes.length - pushCountBefore2} new push(es))`);
    const docAfter2 = await col.findOne({ type: 2, valueNorm: valueNorm2 });
    const pushed2 = docAfter2.adFoundPushed || [];
    ok(pushed2.length === 1 && pushed2[0]?.userId === testUserId, 'dedup marker correctly written immediately');

    console.log('\n✅ All checks passed — addScrapingHistory now spawns the watcher too.');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    if (realGetElastic) databaseManager.getElastic = realGetElastic;
    if (realGetSQL) databaseManager.getSQL = realGetSQL;
    if (realSendNotification) firebaseService.sendNotification = realSendNotification;
    if (realCheckInterval !== undefined) config.keywordSearch.notify.firstAdPushCheckIntervalSec = realCheckInterval;

    try {
      const col = client.db(DB).collection(COLL);
      const r = await col.deleteMany({ value: { $regex: '^__test_scrapehist_' } });
      console.log(`Cleanup: removed ${r.deletedCount} test doc(s).`);
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr.message);
    }
    await client.close();
    process.exit(process.exitCode || 0);
  }
})();
