'use strict';

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

// The secret salt to verify the key. This MUST match the server's config.admin.sessionSecret
const SECRET = 'pas-admin-session-secret-change-me';

function generateKey() {
  const userInfo = os.userInfo();
  const sysInfo = {
    username: userInfo.username,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    timestamp: Date.now(),
  };

  const payload = JSON.stringify(sysInfo);
  
  // Create an HMAC hash of the system info using the secret
  const hash = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  
  // Final key format: base64(payload) + '.' + hash
  const base64Payload = Buffer.from(payload).toString('base64');
  const finalKey = `${base64Payload}.${hash}`;

  console.log('\n========================================================');
  console.log('                 PAS EDIT ACCESS KEY                    ');
  console.log('========================================================\n');
  console.log('System Profile:');
  console.log(`  - Username : ${sysInfo.username}`);
  console.log(`  - Hostname : ${sysInfo.hostname}`);
  console.log(`  - OS       : ${sysInfo.platform} (${sysInfo.arch})\n`);
  
  console.log('Your Edit Access Key is:\n');
  console.log(finalKey);
  console.log('\n========================================================');
  console.log('Copy the key above entirely and paste it into the admin UI.');
  console.log('Press Enter to exit...');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

generateKey();

rl.on('line', () => {
  process.exit(0);
});
