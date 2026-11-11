#!/usr/bin/env node
'use strict';

/**
 * Delete ads that have NO displayable media — the ads the search API never shows (e.g. 17.8 lakh
 * Instagram STORIES whose ES doc has no new_nas_image_url and whose SQL image_url is a dead legacy
 * pasimages/... path). ES + MySQL, every network except tiktok, chatgptads and admob:
 *   facebook, instagram, youtube, linkedin, reddit, gdn, quora, google, pinterest, native
 *
 * Same engine as delete-placeholder-media.js (--mode=no-media): resumable, load-governed ES / SQL,
 * supervisor restarts, binlog guard, live progress table. See docs/DELETE_NO_MEDIA_ADS_SCRIPT.md.
 *
 *   node scripts/delete-no-media-ads.js                 # dry run (read-only): counts, sizes, time
 *   node scripts/delete-no-media-ads.js --apply         # delete from ES + SQL
 *   node scripts/delete-no-media-ads.js --apply --networks=instagram,facebook
 *
 * What is deleted, per network: an ES doc of a media type (NO_MEDIA in the engine) that fails the
 * network's displayable-media gate — the SAME gate the search uses
 * (src/services/common/helpers/displayableMediaFilters.js). Never touched: types the search hides
 * on purpose (Google organic search / text, YouTube BANNER / TEXT …), YouTube DISPLAY ads shown
 * under GDN, and every ad the search shows.
 * Fail-safes:
 *   - an ad whose SQL media column holds a NAS path (PowerAdspy / pas-prod) is KEPT in ES + SQL
 *     (listed in data/placeholder-media/no-media/<network>.kept-sql-media.jsonl);
 *   - a SQL ad is KEPT while another ES doc of it is shown by the search;
 *   - refuses to run against the old (pre 2026-11-11) gate.
 *
 * Speed: each network's ES and SQL lanes keep several batches in flight (ordered, resumable
 * cursors); all networks run at once. The defaults below are the CEILING — the engine starts low and
 * only grows while ES heap / CPU / queues and MySQL Threads_running / CPU have headroom.
 */

const engine = require('./delete-placeholder-media');

const FAST_DEFAULTS = {
  '--es-parallel': '8', // bulk deletes in flight per ES cluster (all networks together)
  '--es-max-batch': '5000', // docs per bulk at most
  '--scan-slices': '8', // sliced scrolls per big network for the ID scan
  '--scan-parallel': '12', // scroll requests in flight per ES cluster
  '--sql-parallel': '12', // delete batches in flight per SQL host
  '--sql-max-batch': '3000', // ads per SQL delete batch at most
};

function buildArgv(argv) {
  if (argv.some((a) => /^--mode(=|$)/.test(a))) {
    throw new Error('delete-no-media-ads.js always runs --mode=no-media; use delete-placeholder-media.js for the other modes.');
  }
  const given = new Set(argv.map((a) => a.split('=')[0]));
  const out = ['--mode=no-media'];
  for (const [flag, value] of Object.entries(FAST_DEFAULTS)) if (!given.has(flag)) out.push(`${flag}=${value}`);
  return [...out, ...argv];
}

if (require.main === module) {
  let argv;
  try {
    argv = buildArgv(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  engine.main(argv).then(
    (code) => { process.exit(code); },
    (e) => { console.error(e); process.exit(1); },
  );
}

module.exports = { buildArgv, FAST_DEFAULTS };
