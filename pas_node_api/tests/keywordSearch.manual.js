'use strict';
/* Manual integration test for the keyword-search Mongo logic (per-network).
 * Uses a throwaway collection so real data is untouched. Run:
 *   node tests/keywordSearch.manual.js
 */
const { MongoClient, ObjectId } = require('mongodb');
const config = require('../src/config');

const URI = config.databases.mongo.uri;
const DB = config.keywordSearch.database || config.databases.mongo.database;
const COLL = 'keyword_searches__test';
const CAP = config.keywordSearch.searchDatesCap;
const ALL = config.keywordSearch.networks;

const ok = (c, m) => console.log(`${c ? '✅' : '❌'} ${m}`);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.notifications?.timezone || 'Asia/Kolkata' }).format(new Date());

function resolveNetworks(raw) {
  if (!raw) return [];
  let list = Array.isArray(raw) ? raw : String(raw).split(',');
  list = list.map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.includes('all')) return [...ALL];
  const set = new Set(ALL);
  return list.filter(n => set.has(n));
}

async function upsert(col, { type, value, email, network }) {
  const valueNorm = value.trim().toLowerCase();
  const now = new Date();
  const netList = resolveNetworks(network);
  const netActive = {};
  for (const net of netList) netActive[`networkState.${net}.isActive`] = true;
  return col.updateOne(
    { type, valueNorm },
    [
      { $set: {
        type, value, valueNorm,
        createdAt: { $ifNull: ['$createdAt', now] },
        updatedAt: now, lastSearchedAt: now,
        searchCount: { $add: [{ $ifNull: ['$searchCount', 0] }, 1] },
        users: { $setUnion: [{ $ifNull: ['$users', []] }, email ? [email] : []] },
        searchDates: { $slice: [{ $concatArrays: [{ $ifNull: ['$searchDates', []] }, [now]] }, -CAP] },
        networks: { $setUnion: [{ $ifNull: ['$networks', []] }, netList] },
        ...netActive,
      } },
      { $set: { userCount: { $size: '$users' } } },
    ],
    { upsert: true }
  );
}

async function claim(col, { type, priority, network: net, owner = 'scraper-1' }) {
  const scrapeId = new ObjectId();
  const t = today();
  const now = new Date();
  const mode = priority ? 'priority' : 'daily';
  const activePath = `networkState.${net}.isActive`;
  const dailyPath = `networkState.${net}.dailyClaimDate`;
  const lastPath = `networkState.${net}.lastScrape`;
  const filter = priority
    ? { type, networks: net, [activePath]: true }
    : { type, networks: net, [dailyPath]: { $ne: t } };
  const setOut = priority ? { [activePath]: false } : { [dailyPath]: t };
  const doc = await col.findOneAndUpdate(
    filter,
    { $set: { ...setOut, [lastPath]: { date: t, status: 'scrapping', owner } },
      $push: { scrapping_status: { _id: scrapeId, network: net, type, mode, owner, date: t, startTime: now, status: 'scrapping' } } },
    { sort: { updatedAt: -1 }, returnDocument: 'after' }
  );
  return doc ? { docId: doc._id, value: doc.value, scrapeId, network: net } : null;
}

// auto-close owner's open session(s) for type+network by NAME (no ids, no adsCount)
async function autoClose(col, { owner, network: net, type, status }) {
  const finalStatus = ['completed', 'no_ads_found', 'failed'].includes(status) ? status : 'completed';
  const set = {
    'scrapping_status.$[s].endTime': new Date(),
    'scrapping_status.$[s].status': finalStatus,
    [`networkState.${net}.lastScrape`]: { date: today(), status: finalStatus, owner },
  };
  const r = await col.updateMany(
    { scrapping_status: { $elemMatch: { owner, network: net, type, status: 'scrapping' } } },
    { $set: set },
    { arrayFilters: [{ 's.owner': owner, 's.network': net, 's.type': type, 's.status': 'scrapping' }] }
  );
  return r.modifiedCount;
}

async function complete(col, { docId, scrapeId, network: net, status, adsCount, owner = 'scraper-1' }) {
  const set = {
    'scrapping_status.$[s].endTime': new Date(),
    'scrapping_status.$[s].status': status,
  };
  if (adsCount != null) set['scrapping_status.$[s].adsCount'] = adsCount;
  if (net) set[`networkState.${net}.lastScrape`] = { date: today(), status, adsCount, owner };
  const sessionMatch = { _id: scrapeId };
  if (owner) sessionMatch.owner = owner;
  const query = { _id: docId, scrapping_status: { $elemMatch: sessionMatch } };
  return col.updateOne(query, { $set: set }, { arrayFilters: [{ 's._id': scrapeId }] });
}

async function fresh(col) {
  await col.drop().catch(() => {});
  await col.createIndex({ type: 1, valueNorm: 1 }, { unique: true });
}

(async () => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 6000 });
  try {
    await client.connect();
    const col = client.db(DB).collection(COLL);
    await fresh(col);

    // 1) DEDUPE + network union
    await upsert(col, { type: 1, value: 'Nike', email: 'a@x.com', network: 'facebook' });
    await upsert(col, { type: 1, value: ' nike ', email: 'b@x.com', network: 'instagram' });
    const nike = await col.findOne({ type: 1, valueNorm: 'nike' });
    ok(await col.countDocuments({ valueNorm: 'nike' }) === 1, 'dedupe: one document for Nike/nike');
    ok(nike.searchCount === 2 && nike.userCount === 2, `searchCount=2 & userCount=2 (got ${nike.searchCount}/${nike.userCount})`);
    ok(JSON.stringify([...nike.networks].sort()) === JSON.stringify(['facebook', 'instagram']), `networks unioned (got ${nike.networks})`);
    ok(nike.networkState.facebook.isActive === true && nike.networkState.instagram.isActive === true, 'both networks active');

    // 2) ALL expands to full configured list
    await fresh(col);
    await upsert(col, { type: 1, value: 'shoes', email: 'a@x.com', network: 'all' });
    const shoes = await col.findOne({ valueNorm: 'shoes' });
    ok(shoes.networks.length === ALL.length, `'all' expands to ${ALL.length} networks (got ${shoes.networks.length})`);

    // 3) PER-NETWORK INDEPENDENCE — the core requirement
    await fresh(col);
    await upsert(col, { type: 1, value: 'kw', email: 'a@x.com', network: 'all' });
    // daily scrape it for facebook
    const fb = await claim(col, { type: 1, priority: false, network: 'facebook' });
    ok(fb && fb.value === 'kw', 'daily: facebook claims kw');
    const fbAgain = await claim(col, { type: 1, priority: false, network: 'facebook' });
    ok(fbAgain === null, 'daily: facebook same-day repeat blocked');
    // instagram must STILL be able to claim kw the same day
    const ig = await claim(col, { type: 1, priority: false, network: 'instagram' });
    ok(ig && ig.value === 'kw', 'daily: instagram STILL claims kw (not skipped) ✦ per-network independence');

    // 4) PRIORITY per-network: facebook claim deactivates facebook only
    await fresh(col);
    await upsert(col, { type: 2, value: 'adv', email: 'a@x.com', network: 'facebook,instagram' });
    const pfb = await claim(col, { type: 2, priority: true, network: 'facebook' });
    ok(pfb && pfb.value === 'adv', 'priority: facebook claims adv');
    ok(await claim(col, { type: 2, priority: true, network: 'facebook' }) === null, 'priority: facebook inactive after claim');
    const pig = await claim(col, { type: 2, priority: true, network: 'instagram' });
    ok(pig && pig.value === 'adv', 'priority: instagram still active for adv (independent)');
    // a network NOT in the term is never handed out
    await upsert(col, { type: 2, value: 'adv', email: 'a@x.com', network: 'facebook' }); // reactivate facebook only
    const pgoo = await claim(col, { type: 2, priority: true, network: 'google' });
    ok(pgoo === null, 'priority: google never gets a term not searched for it');

    // 5) CONCURRENCY per network: 6 active docs, 6 concurrent facebook claims → distinct
    await fresh(col);
    for (let i = 0; i < 6; i++) await upsert(col, { type: 1, value: `c${i}`, email: `u${i}@x.com`, network: 'facebook' });
    const got = (await Promise.all(Array.from({ length: 6 }, () => claim(col, { type: 1, priority: true, network: 'facebook' })))).filter(Boolean);
    const distinct = new Set(got.map(c => String(c.docId)));
    ok(got.length === 6 && distinct.size === 6, `concurrency: 6 facebook claims all distinct (got ${got.length}, distinct ${distinct.size})`);

    // 6) scrapeId-targeted completion — "scraper2 acted in between" scenario
    await fresh(col);
    await upsert(col, { type: 1, value: 'A', email: 'a@x.com', network: 'facebook' });
    await upsert(col, { type: 1, value: 'B', email: 'b@x.com', network: 'facebook' });
    const c1 = await claim(col, { type: 1, priority: true, network: 'facebook' });
    const c2 = await claim(col, { type: 1, priority: true, network: 'facebook' });
    const cA = [c1, c2].find(c => c.value === 'A');
    const cB = [c1, c2].find(c => c.value === 'B');
    await complete(col, { ...cB, status: 'completed', adsCount: 99 });   // B first
    await complete(col, { ...cA, status: 'completed', adsCount: 312 });  // then A
    const docA = await col.findOne({ _id: cA.docId });
    const docB = await col.findOne({ _id: cB.docId });
    const sA = docA.scrapping_status.find(s => String(s._id) === String(cA.scrapeId));
    const sB = docB.scrapping_status.find(s => String(s._id) === String(cB.scrapeId));
    ok(sA.endTime && sA.adsCount === 312, `A end-time on A's own session, adsCount 312 (got ${sA.adsCount})`);
    ok(sB.endTime && sB.adsCount === 99, `B end-time on B's own session, adsCount 99 (got ${sB.adsCount})`);

    // 7) OWNER isolation — only the claiming scraper can close its own session
    await fresh(col);
    await upsert(col, { type: 1, value: 'W', email: 'a@x.com', network: 'facebook' });
    const owned = await claim(col, { type: 1, priority: true, network: 'facebook', owner: 'scraper-1' });
    const wrong = await complete(col, { ...owned, owner: 'scraper-2', status: 'completed', adsCount: 5 });
    ok(wrong.modifiedCount === 0, 'owner: scraper-2 CANNOT close scraper-1 session');
    const right = await complete(col, { ...owned, owner: 'scraper-1', status: 'completed', adsCount: 5 });
    ok(right.modifiedCount === 1, 'owner: scraper-1 closes its own session');

    // 8) AUTO-CLOSE-BY-NAME loop — scraper sends NO ids, NO adsCount, just hits again
    await fresh(col);
    for (let i = 0; i < 3; i++) await upsert(col, { type: 1, value: `auto${i}`, email: 'a@x.com', network: 'facebook' });
    const NAME = 'fb-auto-plugin';
    // hit 1: claim only (nothing to close yet)
    const closed0 = await autoClose(col, { owner: NAME, network: 'facebook', type: 1 });
    const h1 = await claim(col, { type: 1, priority: true, network: 'facebook', owner: NAME });
    ok(closed0 === 0 && h1, 'auto: first hit closes nothing, claims a term');
    // hit 2: auto-close previous by NAME (no ids), claim next
    const closed1 = await autoClose(col, { owner: NAME, network: 'facebook', type: 1 });
    const h2 = await claim(col, { type: 1, priority: true, network: 'facebook', owner: NAME });
    ok(closed1 === 1 && h2 && h2.docId.toString() !== h1.docId.toString(), 'auto: 2nd hit closes prev by name + gives a NEW term');
    const prev = await col.findOne({ _id: h1.docId });
    const prevSess = prev.scrapping_status.find(s => s.owner === NAME);
    ok(prevSess.endTime && prevSess.status === 'completed', 'auto: previous term got endTime + status=completed (no adsCount)');
    ok(prevSess.adsCount === undefined, 'auto: no adsCount stored');

    await col.drop().catch(() => {});
    console.log('\nDone.');
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
