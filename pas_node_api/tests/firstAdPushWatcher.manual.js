'use strict';
/* Manual integration test for startFirstAdPushWatcher() (keywordAdNotificationController.js).
 * Uses real synthetic keyword_searches docs against the real MongoDB collection, then
 * deletes them. ES/SQL/Firebase are intercepted, scoped strictly to this test's own
 * value/userId/token so no unrelated real doc or user can ever be touched (see
 * firstAdPushFastScan.manual.js's history for why that scoping matters).
 *
 * Uses REAL timers (the watcher's own 1-minute initial delay, fixed/not configurable, +
 * a short overridden recheck interval) rather than faking time, so this takes a few
 * minutes to run — most of it spent waiting out that fixed 1-minute delay 3 times over.
 * Run: node tests/firstAdPushWatcher.manual.js
 */
const { MongoClient, ObjectId } = require('mongodb');
const config = require('../src/config');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const firebaseService = require('../src/services/FirebaseService');

const URI = config.databases.mongo.uri;
const DB = config.keywordSearch.database || config.databases.mongo.database;
const COLL = config.keywordSearch.collection;

const ok = (c, m) => console.log(`${c ? '✅' : '❌'} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayStr() {
  const tz = config.notifications?.timezone || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

(async () => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  const sentPushes = [];
  let realGetElastic, realGetSQL, realSendNotification, realCheckInterval;
  try {
    await client.connect();
    const col = client.db(DB).collection(COLL);
    await databaseManager.connectAll(networksConfig);
    const { startFirstAdPushWatcher } = require('../src/services/common/controllers/keywordAdNotificationController');

    const today = todayStr();
    const network = 'facebook';
    const testUserId = 999998;
    const testEmail = 'watcher-test@example.com';

    // Recheck interval overridden short (2s) for a fast test — the fixed 1-minute initial
    // delay is unaffected, that's intentionally not configurable.
    realCheckInterval = config.keywordSearch.notify.firstAdPushCheckIntervalSec;
    config.keywordSearch.notify.firstAdPushCheckIntervalSec = 2;

    // ── Scoped mocks — exactly as in firstAdPushFastScan.manual.js ──
    realGetElastic = databaseManager.getElastic.bind(databaseManager);
    let fakeAdsCount = 0;
    let testValueForEsMatch = null; // set per-scenario below
    databaseManager.getElastic = (net) => {
      const real = realGetElastic(net);
      if (net !== network || !real) return real;
      return {
        ...real,
        count: async (params) => {
          const q = JSON.stringify(params?.body?.query || '');
          if (testValueForEsMatch && q.includes(testValueForEsMatch)) return { count: fakeAdsCount };
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
          if (sql.includes('fcm_token') && params?.[0] === testUserId) {
            return [{ fcm_token: 'FAKE_WATCHER_TEST_TOKEN' }];
          }
          return real ? real.query(sql, params) : [];
        },
      };
    };

    realSendNotification = firebaseService.sendNotification.bind(firebaseService);
    firebaseService.sendNotification = async (token, header, text, image, actionUrl) => {
      if (token === 'FAKE_WATCHER_TEST_TOKEN') {
        sentPushes.push({ token, header, text, image, actionUrl });
        return { fakeSend: true };
      }
      return realSendNotification(token, header, text, image, actionUrl);
    };

    // ═══ Scenario A: ads found on the SECOND check — push sent, then no more ticks ═══
    const valueA = `__test_watcher_a_${Date.now()}`;
    testValueForEsMatch = valueA;
    fakeAdsCount = 0;
    await col.deleteOne({ type: 2, valueNorm: valueA.toLowerCase() });
    const scrapeIdA = new ObjectId();
    const docA = await col.insertOne({
      type: 2,
      value: valueA,
      valueNorm: valueA.toLowerCase(),
      users: [testEmail],
      userInfos: [{ id: testUserId, username: 'watcher-tester', email: testEmail }],
      scrapping_status: [
        { _id: scrapeIdA, network, type: 2, date: today, status: 'scrapping', startTime: new Date(), owner: 'watcher-test-scraper' },
      ],
      lastSearchedAt: new Date(),
    });

    console.log(`\n--- Scenario A: watcher starts, 0 ads → ads appear before the 2nd check → push + stop (docId=${docA.insertedId}) ---`);
    startFirstAdPushWatcher({ docId: docA.insertedId, scrapeId: scrapeIdA, type: 2, value: valueA, network });

    await sleep(61000); // past the fixed 1-minute initial check
    ok(sentPushes.length === 0, 'no push yet right after the first (0-ads) check');
    let afterFirst = await col.findOne({ _id: docA.insertedId });
    ok(!(afterFirst.adFoundPushed || []).length, 'adFoundPushed still empty after first check');

    fakeAdsCount = 4; // ads "land" now, before the second (2s-interval) check
    await sleep(2500); // past the recheck
    ok(sentPushes.length === 1, `exactly one push sent by the second check (got ${sentPushes.length})`);
    let afterSecond = await col.findOne({ _id: docA.insertedId });
    const pushedA = afterSecond.adFoundPushed || [];
    ok(pushedA.length === 1, `dedup marker written (got ${pushedA.length})`);
    ok(pushedA[0]?.userId === testUserId, 'dedup marker has correct userId');

    const pushCountAfterStop = sentPushes.length;
    await sleep(2500); // one more interval — watcher should have stopped, no 3rd push
    ok(sentPushes.length === pushCountAfterStop, 'watcher stopped ticking after the successful push (no extra sends)');

    // ═══ Scenario B: session closes before ads ever appear — watcher stops, no push ═══
    const valueB = `__test_watcher_b_${Date.now()}`;
    testValueForEsMatch = valueB;
    fakeAdsCount = 0;
    await col.deleteOne({ type: 2, valueNorm: valueB.toLowerCase() });
    const scrapeIdB = new ObjectId();
    const docB = await col.insertOne({
      type: 2,
      value: valueB,
      valueNorm: valueB.toLowerCase(),
      users: [testEmail],
      userInfos: [{ id: testUserId, username: 'watcher-tester', email: testEmail }],
      scrapping_status: [
        { _id: scrapeIdB, network, type: 2, date: today, status: 'scrapping', startTime: new Date(), owner: 'watcher-test-scraper' },
      ],
      lastSearchedAt: new Date(),
    });

    console.log(`\n--- Scenario B: session closes with 0 ads → watcher must stop, no push (docId=${docB.insertedId}) ---`);
    startFirstAdPushWatcher({ docId: docB.insertedId, scrapeId: scrapeIdB, type: 2, value: valueB, network });

    await sleep(61000); // past the first check — still 0 ads, session still open
    const pushCountBeforeClose = sentPushes.length;
    // Close the session now, still with 0 ads.
    await col.updateOne(
      { _id: docB.insertedId, 'scrapping_status._id': scrapeIdB },
      { $set: { 'scrapping_status.$.status': 'completed', 'scrapping_status.$.endTime': new Date() } }
    );
    await sleep(2500); // past what would have been the next recheck, had it kept going
    ok(sentPushes.length === pushCountBeforeClose, 'no push sent — session closed before any ads appeared');
    let afterClose = await col.findOne({ _id: docB.insertedId });
    ok(!(afterClose.adFoundPushed || []).length, 'adFoundPushed still empty — watcher correctly stopped on session close');

    // ═══ Scenario C: firstAdPushEnabled=false — watcher must no-op entirely, even ═══
    // ═══ though ads are already there right from the very first check.          ═══
    // Deliberately calls startFirstAdPushWatcher directly (as scraperWork() does),
    // NOT through a real /keyword-search/work claim — that endpoint's atomic claim
    // draws from the real, shared, populated pool and previously grabbed two real
    // production terms during testing (see git history / commit notes). Every
    // scenario in this file only ever touches a doc it inserted itself, addressed
    // purely by _id, so it can never collide with real data.
    const valueC = `__test_watcher_c_${Date.now()}`;
    testValueForEsMatch = valueC;
    fakeAdsCount = 5; // ads already present, so an enabled watcher would push almost immediately
    let realFirstAdPushEnabled;
    await col.deleteOne({ type: 2, valueNorm: valueC.toLowerCase() });
    const scrapeIdC = new ObjectId();
    const docC = await col.insertOne({
      type: 2,
      value: valueC,
      valueNorm: valueC.toLowerCase(),
      users: [testEmail],
      userInfos: [{ id: testUserId, username: 'watcher-tester', email: testEmail }],
      scrapping_status: [
        { _id: scrapeIdC, network, type: 2, date: today, status: 'scrapping', startTime: new Date(), owner: 'watcher-test-scraper' },
      ],
      lastSearchedAt: new Date(),
    });

    console.log(`\n--- Scenario C: firstAdPushEnabled=false — watcher must never check/push (docId=${docC.insertedId}) ---`);
    realFirstAdPushEnabled = config.keywordSearch.notify.firstAdPushEnabled;
    config.keywordSearch.notify.firstAdPushEnabled = false;
    const pushCountBeforeC = sentPushes.length;
    startFirstAdPushWatcher({ docId: docC.insertedId, scrapeId: scrapeIdC, type: 2, value: valueC, network });

    // Short wait is enough here — startFirstAdPushWatcher returns immediately when
    // disabled, before scheduling any timer at all, so there's nothing to "wait out."
    await sleep(4000);
    ok(sentPushes.length === pushCountBeforeC, 'no push sent while firstAdPushEnabled=false, despite ads being present');
    let afterC = await col.findOne({ _id: docC.insertedId });
    ok(!(afterC.adFoundPushed || []).length, 'adFoundPushed still empty — watcher never ran at all while disabled');
    config.keywordSearch.notify.firstAdPushEnabled = realFirstAdPushEnabled;

    console.log('\n✅ All checks passed.');
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
      const r = await col.deleteMany({ value: { $regex: '^__test_watcher_' } });
      console.log(`Cleanup: removed ${r.deletedCount} test doc(s).`);
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr.message);
    }
    await client.close();
    process.exit(process.exitCode || 0);
  }
})();
