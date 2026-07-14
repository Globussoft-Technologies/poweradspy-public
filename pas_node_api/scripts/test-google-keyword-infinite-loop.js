'use strict';

/**
 * Tester script for the Google keyword-search "infinite loop" feature.
 *
 * Feature under test (see docs/KEYWORD_SEARCH_API.md, "Google priority ordering
 * + implicit loop"): a normal daily claim (POST /keyword-search/work, no
 * `priority` flag) for network "google" must NEVER return an empty pool
 * (count: 0) as long as at least one google keyword exists anywhere in the
 * priority / user-searched / synthetic tiers. Once all three tiers are
 * exhausted for the day, the server resets networkState.google.dailyClaimDate
 * and keeps serving from the top — i.e. terms repeat instead of drying up.
 *
 * This script repeatedly calls the work API for google (daily mode) and
 * checks two things:
 *   1. No response ever comes back with count: 0 / data: [] (a hard failure —
 *      the whole point of the feature is that a non-empty pool never empties out).
 *   2. A previously-seen docId eventually reappears, proving the pool actually
 *      looped back to the start rather than us just happening not to hit the
 *      end yet.
 *
 * Usage:
 *   node scripts/test-google-keyword-infinite-loop.js
 *   node scripts/test-google-keyword-infinite-loop.js --base http://localhost:4000 --iterations 500
 *   node scripts/test-google-keyword-infinite-loop.js --scraper my-google-tester --delay 100
 *
 * Flags (all optional):
 *   --base        Base URL of the API. Default: https://stagingtest-api.poweradspy.com
 *   --scraper     x-scraper-name header value. Default: google-loop-tester
 *   --type        keyword | advertiser | domain. Default: keyword
 *   --iterations  Max number of work-API calls before giving up. Default: 500
 *   --delay       Milliseconds to wait between calls. Default: 50
 *
 * Exit code: 0 on PASS, 1 on FAIL or INCONCLUSIVE (see printed verdict).
 */

const axios = require('axios');

function parseArgs(argv) {
  const args = { base: 'http://localhost:3000', scraper: 'google-loop-tester', type: 'keyword', iterations: 1000, delay: 50 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--base') args.base = argv[++i];
    else if (flag === '--scraper') args.scraper = argv[++i];
    else if (flag === '--type') args.type = argv[++i];
    else if (flag === '--iterations') args.iterations = parseInt(argv[++i], 10);
    else if (flag === '--delay') args.delay = parseInt(argv[++i], 10);
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callWork(base, scraper, type) {
  const res = await axios.post(
    `${base}/api/v1/common/keyword-search/work`,
    { type, network: 'google' }, // no `priority` flag -> daily mode, the branch the loop feature applies to
    { headers: { 'x-scraper-name': scraper, 'Content-Type': 'application/json' }, validateStatus: () => true }
  );
  return res;
}

async function main() {
  const { base, scraper, type, iterations, delay } = parseArgs(process.argv.slice(2));

  console.log('== Google keyword-search infinite-loop test ==');
  console.log(`base=${base} scraper=${scraper} type=${type} iterations=${iterations} delay=${delay}ms\n`);

  const seenDocIds = new Map(); // docId -> first iteration index it was seen at
  let emptyCount = 0;
  let firstEmptyAt = null;
  let repeatAt = null;
  let repeatDocId = null;
  let totalClaimed = 0;
  let iterationsRun = 0;

  for (let i = 1; i <= iterations; i += 1) {
    iterationsRun = i;
    let res;
    try {
      res = await callWork(base, scraper, type);
    } catch (err) {
      console.error(`[iter ${i}] request failed: ${err.message}`);
      process.exit(1);
    }

    if (res.status !== 200) {
      console.error(`[iter ${i}] unexpected HTTP status ${res.status}:`, res.data);
      process.exit(1);
    }

    const body = res.data;
    const count = body.count ?? (body.data ? body.data.length : 0);

    if (count === 0) {
      emptyCount += 1;
      if (firstEmptyAt === null) firstEmptyAt = i;
      console.log(`[iter ${i}] EMPTY response (count: 0)`);
      // If the very first call is already empty, there's simply no google
      // keyword data to loop over yet - that's a setup problem, not a bug.
      if (i === 1) {
        console.log('\nVerdict: INCONCLUSIVE - no google keywords available at all.');
        console.log('Seed at least one via API 1 (store) or API 3 (synthetic) for network=google, then re-run.');
        process.exit(1);
      }
      // Any empty response AFTER we've already seen non-empty data is the bug
      // this feature exists to prevent.
      console.log('\nVerdict: FAIL - pool returned empty after previously serving terms.');
      console.log('Expected: server should have reset dailyClaimDate and kept serving instead of returning count: 0.');
      process.exit(1);
    }

    totalClaimed += count;
    for (const item of body.data) {
      const docId = item.docId;
      if (seenDocIds.has(docId)) {
        repeatAt = i;
        repeatDocId = docId;
        console.log(`[iter ${i}] repeat: docId=${docId} value="${item.value}" first seen at iter ${seenDocIds.get(docId)}`);
        break;
      }
      seenDocIds.set(docId, i);
    }

    if (i % 25 === 0 || i === 1) {
      console.log(`[iter ${i}] claimed="${body.data[0]?.value}" distinctSoFar=${seenDocIds.size} totalClaimed=${totalClaimed}`);
    }

    if (repeatAt) break;
    await sleep(delay);
  }

  console.log('\n---- Summary ----');
  console.log(`Iterations run: ${iterationsRun}`);
  console.log(`Distinct terms seen: ${seenDocIds.size}`);
  console.log(`Total items claimed: ${totalClaimed}`);
  console.log(`Empty responses: ${emptyCount}${firstEmptyAt ? ` (first at iter ${firstEmptyAt})` : ''}`);

  if (repeatAt) {
    console.log(`\nVerdict: PASS - pool looped back (docId ${repeatDocId} reappeared at iter ${repeatAt}) with zero empty responses in between.`);
    process.exit(0);
  }

  console.log('\nVerdict: INCONCLUSIVE - no repeat observed within the iteration budget and no empty responses either.');
  console.log(`This likely means the google pool has more than ${iterationsRun} distinct terms.`);
  console.log('Re-run with a higher --iterations, or seed a small, known set of synthetic keywords first');
  console.log('(via API 3) so the pool is small enough to observe a full loop.');
  process.exit(1);
}

main();
