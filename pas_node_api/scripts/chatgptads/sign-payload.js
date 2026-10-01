'use strict';
/**
 * Usage: node scripts/chatgptads/sign-payload.js payload.json
 *   (or pipe JSON via stdin: cat payload.json | node scripts/chatgptads/sign-payload.js)
 *
 * Prints the exact raw body (copy as-is) + the matching x-signature header value, so you can
 * test the insertion API with curl/Postman without guessing the HMAC by hand.
 */
const fs = require('fs');
const crypto = require('crypto');
const config = require('../../src/config');

const file = process.argv[2];
const raw = file ? fs.readFileSync(file, 'utf8').trim() : fs.readFileSync(0, 'utf8').trim();

// Re-serialize through JSON.parse/stringify so formatting (spacing/newlines) can't drift
// between what you pasted and what you actually send — the signature MUST match the exact
// bytes of the body curl/Postman sends.
const compact = JSON.stringify(JSON.parse(raw));
const signature = crypto.createHmac('sha256', config.insertion.secretKey).update(Buffer.from(compact, 'utf8')).digest('hex');

console.log('=== Send this EXACT body ===');
console.log(compact);
console.log();
console.log('=== x-signature header ===');
console.log(signature);
