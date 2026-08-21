// debug-top-movers.js — run from inside pas_node_api/ on the production box:
//   node debug-top-movers.js
//   node debug-top-movers.js --advertiser=teramind
//
// Calls the REAL, LIVE `getTop` handler from src/services/marketTrends.js
// directly (in-process, fake req/res) — the exact same function the Top
// Movers panel hits via GET /trends/top. No reimplementation, no guessing:
// whatever this prints is 100% what production computes, including the
// per-network breakdown (`byNet`) the UI itself never shows.
'use strict';
const marketTrends = require('./src/services/marketTrends');

if (typeof marketTrends.getTop !== 'function') {
  console.error('marketTrends.getTop is not exported on this box yet — redeploy src/services/marketTrends.js first.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
);

const req = {
  query: {
    type: args.type || 'advertiser',
    days: args.days || '30',
    network: args.network || 'all',
    size: args.size || '12',
    country: args.country || '',
    advertiser: args.advertiser || '',
  },
  body: {},
};

const res = {
  statusCode: 200,
  status(c) { this.statusCode = c; return this; },
  json(body) {
    console.log(`HTTP ${this.statusCode}\n`);
    const items = body?.data?.items || [];
    if (!items.length) { console.log('No items in response.', JSON.stringify(body, null, 2)); return; }
    items.forEach((it, i) => {
      console.log(`${i + 1}. "${it.label}"  (key="${it.id}")`);
      console.log(`   count=${it.count}  growthPct=${it.growthPct}  dominant net=${it.net}`);
      console.log(`   byNet=${JSON.stringify(it.byNet)}`);
      console.log('');
    });
  },
};

marketTrends.getTop(req, res).catch((e) => { console.error('ERROR:', e); process.exit(1); });
