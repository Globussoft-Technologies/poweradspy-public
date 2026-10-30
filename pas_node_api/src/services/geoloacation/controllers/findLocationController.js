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
const { getClientIp } = require('../../../utils/geoip');

const DEFAULT_IP = '110.227.200.178';

// getClientIp prefers cf-connecting-ip and skips Cloudflare ranges, so behind
// Cloudflare this is the visitor's IP rather than the edge server's.
// Strip the IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) Node adds on dual-stack sockets.
// Loopback (local development) returns '' so ip-api.com resolves the machine's public IP itself.
function clientIp(req) {
  const ip = String(getClientIp(req) || req.ip || '').replace(/^::ffff:/, '');
  return /^(127\.|::1$)/.test(ip) ? '' : ip;
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
