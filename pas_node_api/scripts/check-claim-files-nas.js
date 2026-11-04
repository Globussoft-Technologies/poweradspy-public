#!/usr/bin/env node
'use strict';

/**
 * Checks the PRIVATE NAS bucket for copyright evidence files (src/compliance/claims/attachments.js) with ONE made-up test file.
 *
 *   node scripts/check-claim-files-nas.js          dry run: shows the settings (never the token) and what it would do. Touches nothing.
 *   node scripts/check-claim-files-nas.js --run    uploads one made-up PDF, then checks, in this order:
 *       1. the upload is accepted
 *       2. read WITHOUT a token, with a WRONG token, and with a cache-busting query: all must be refused. (Done BEFORE any authorized read: a CDN
 *          in front of the NAS can cache an authorized answer and then hand it to anybody.)
 *       3. read WITH the token (through the same code the application uses): the same bytes
 *       4. read WITHOUT a token again, on the plain address, AFTER step 3: must STILL be refused (our reads must not leave a public copy in a cache)
 *       5. delete: must really remove the file (a 404 is only a warning: the delete address may be wrong and nothing was removed)
 *       6. after the delete the file is gone, with the token and without
 *     WRITES to the NAS: run it on purpose.
 *
 * Settings come from compliance.claims.attachments (config.json); --base-url=... and --bucket=... override them for this run.
 * The token is read ONLY from the environment (COPYRIGHT_CLAIMS_NAS_TOKEN, or the .env next to config.json): it is never printed.
 *
 * It refuses to run against the public ad-media bucket (insertion.nas.bucket): a test file must never go there.
 * The test file is a few bytes of text with a random marker, stored under copyrightdoc/<MMYYYY>/nascheck-<uuid>/<timestamp> and removed at the end
 * (also when a step fails).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../src/config');
const A = require('../src/compliance/claims/attachments');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const RUN = args.includes('--run');

const s = {
  ...config.compliance.claims.attachments,
  ...(flag('base-url') ? { baseUrl: flag('base-url').replace(/\/+$/, '') } : {}),
  ...(flag('bucket') ? { bucket: flag('bucket') } : {}),
};
const mediaBucket = config.insertion?.nas?.bucket || (config.env === 'production' ? 'pas-prod' : 'pas-dev');

const results = [];
const note = (state, name, detail = '') => { results.push({ state, name }); console.log(`${state.padEnd(4)}  ${name}${detail ? `\n        ${detail}` : ''}`); };

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

/** A read made OUTSIDE the application's code (no token, or a wrong one): it must not give the file. */
async function outsideRead(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, gaveFile: res.status === 200 && body.length > 0 };
  } catch (err) {
    return { error: err.code || err.message };
  }
}

async function main() {
  console.log('Private bucket check for copyright evidence files');
  console.log(`  address : ${s.baseUrl || '(not set)'}`);
  console.log(`  bucket  : ${s.bucket || '(not set)'}`);
  console.log(`  paths   : upload ${s.uploadPath}   read ${s.readPath}   delete ${s.deletePath}`);
  console.log(`  token   : ${s.token ? 'set (not shown)' : 'NOT SET (COPYRIGHT_CLAIMS_NAS_TOKEN)'}`);
  console.log(`  tls     : certificate ${s.verifyTls === false ? 'NOT checked' : 'checked'}`);

  const problems = [];
  if (!s.baseUrl) problems.push('the address is not set (compliance.claims.attachments.baseUrl, or --base-url=...)');
  if (!s.bucket) problems.push('the bucket is not set (compliance.claims.attachments.bucket, or --bucket=...)');
  if (!s.token) problems.push('the token is not in the environment (COPYRIGHT_CLAIMS_NAS_TOKEN)');
  if (s.bucket && s.bucket === mediaBucket) problems.push(`"${s.bucket}" is the PUBLIC ad-media bucket: a test file must never go there`);
  if (problems.length) {
    console.log('\nCannot run:');
    problems.forEach((p) => console.log(`  - ${p}`));
    process.exit(2);
  }

  const transport = A.createHttpTransport(s);
  const key = A.keyFor(`nascheck-${crypto.randomUUID()}`);
  const addressOf = (k) => `${s.baseUrl}${s.readPath.replace('{bucket}', s.bucket).replace('{key}', `${k}.pdf`)}`;
  const plain = addressOf(key);
  const cacheBust = () => `${plain}${plain.includes('?') ? '&' : '?'}cb=${crypto.randomBytes(6).toString('hex')}`;
  console.log(`  test key: ${key}.pdf`);

  if (!RUN) {
    console.log('\nDry run. Nothing was sent. With --run it would upload one made-up PDF and check, in order: it is refused without a token and with a wrong one;');
    console.log('read with the token gives the same bytes; it is STILL refused without a token afterwards (no public copy in a cache); delete really removes it.');
    process.exit(0);
  }

  const tmp = path.join(os.tmpdir(), `claim-nas-check-${Date.now()}.pdf`);
  const bytes = Buffer.from(['%PDF-1.4', `made-up test file for the private bucket check ${crypto.randomUUID()}`, ''].join(String.fromCharCode(10)));
  fs.writeFileSync(tmp, bytes);
  let stored = false;
  let deleted = false;
  const refused = (r) => !r.error && !r.gaveFile;
  const report = (label, r, hint) => {
    if (r.error) note('WARN', `${label}: could not be checked`, `${r.error}`);
    else if (r.gaveFile) note('FAIL', `${label}: THE FILE WAS GIVEN (status 200)`, hint);
    else note('PASS', `${label}: refused (status ${r.status})`);
  };
  try {
    const put = await transport.put(tmp, key, 'pdf');
    stored = Boolean(put.ok);
    note(put.ok ? 'PASS' : 'FAIL', '1  upload of a made-up PDF', put.ok ? `the NAS confirmed (status ${put.status}); it says the file is at ${put.path}` : `status ${put.status ?? '-'} ${put.error || ''}  (the token, the bucket or the upload path may be wrong, or a PDF is not accepted)`);

    if (stored) {
      report('2a read WITHOUT a token', await outsideRead(plain), 'the bucket is not private at this address');
      report('2b read with a WRONG token', await outsideRead(cacheBust(), { Authorization: 'Bearer not-the-token' }), 'any token is enough: the bucket is not private');
      report('2c read WITHOUT a token, cache-busting address', await outsideRead(cacheBust()), 'the origin gives the file to anyone');

      const got = await transport.get(key, 'pdf');
      if (got.ok) {
        const back = await readAll(got.stream);
        note(back.equals(bytes) ? 'PASS' : 'FAIL', '3  read WITH the token (the application\'s own read): the same bytes', `${back.length} bytes${back.equals(bytes) ? '' : ' (different from what was sent)'}`);
      } else {
        note('FAIL', '3  read WITH the token', `status ${got.status ?? '-'} ${got.error || ''}  (the read path "${s.readPath}" may be wrong)`);
      }

      report('4  read WITHOUT a token on the plain address, AFTER the application read it', await outsideRead(plain), 'a cache in front of the NAS now holds a public copy of what the application read');

      const del = await transport.del(key, 'pdf');
      deleted = Boolean(del.ok);
      if (del.ok && del.status === 404) note('WARN', '5  delete: the NAS answered 404', 'nothing may have been removed: the delete path may be wrong (the file is probably still there)');
      else note(del.ok ? 'PASS' : 'FAIL', '5  delete the test file', `status ${del.status ?? '-'} ${del.error || ''}`);
      if (del.ok) {
        const after = await transport.get(key, 'pdf');
        note(after.ok ? 'FAIL' : 'PASS', '6a after the delete the file is gone (with the token)', after.ok ? 'it can still be read: the delete did not remove it' : `status ${after.status ?? '-'}`);
        const anon = await outsideRead(plain);
        report('6b after the delete, WITHOUT a token', anon, 'a cache still serves the deleted file');
        if (!refused(anon)) deleted = false; // so the cleanup below tries again
      }
    }
  } finally {
    if (stored && !deleted) {
      const del = await transport.del(key, 'pdf');
      console.log(del.ok ? '\n(cleanup: the test file was deleted)' : `\nCLEANUP FAILED: please delete ${s.bucket}/stream/${key}.pdf by hand`);
    }
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }

  const fail = results.filter((r) => r.state === 'FAIL').length;
  const warn = results.filter((r) => r.state === 'WARN').length;
  console.log(`\n${results.length - fail - warn} passed, ${fail} failed, ${warn} warnings`);
  console.log(fail ? 'RESULT: NOT READY. Fix the failed steps first.' : (warn ? 'RESULT: works, but look at the WARN lines before relying on it.' : 'RESULT: the private bucket works, is not readable without the token, and a delete is final.'));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error('The check stopped:', err.message); process.exit(2); });
