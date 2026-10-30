'use strict';

/**
 * Geolocation controller — port of PHP FindLocationController.
 *
 *   findLoaction      GET /        caller's IP
 *   findLoactionById  GET /get-ip  ?ip= (default DEFAULT_IP, same as PHP)
 *
 * Both look the IP up live via ip-api.com — no database read or write.
 * Matches PHP behaviour: plain JSON object on success, error message as plain text on failure.
 */

const { lookupIp } = require('../helpers/ipLookup');

const DEFAULT_IP = '110.227.200.178';

// req.ip honours trustProxy, so behind Nginx this is the real client IP.
// Strip the IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) Node adds on dual-stack sockets.
function clientIp(req) {
  return String(req.ip || '').replace(/^::ffff:/, '');
}

async function findLoaction(req, res, log) {
  res.set('Access-Control-Allow-Origin', '*');
  const ip = clientIp(req);
  try {
    res.json(await lookupIp(ip));
  } catch (err) {
    log.error('findLoaction failed', { ip, error: err.message });
    res.type('text').send(err.message);
  }
}

async function findLoactionById(req, res, log) {
  res.set('Access-Control-Allow-Origin', '*');
  const ip = req.query.ip ? String(req.query.ip).trim() : DEFAULT_IP;
  try {
    res.json(await lookupIp(ip));
  } catch (err) {
    log.error('findLoactionById failed', { ip, error: err.message });
    res.type('text').send(err.message);
  }
}

module.exports = { findLoaction, findLoactionById };
