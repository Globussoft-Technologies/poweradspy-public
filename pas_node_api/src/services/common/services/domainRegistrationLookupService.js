'use strict';

/**
 * Unified cross-network `get-domain-registration` lookup.
 *
 * Consolidates the four per-network endpoints
 * (/api/v1/{instagram,google,youtube,facebook}/get-domain-registration) into one and
 * extends coverage to all 10 networks. Looks a domain up in each network's domains table
 * and reports every network it was found in, together with that network's
 * `domain_registered_date` and `status` (0 pending / 1 resolved / 2 unresolvable).
 *
 * A domain can live in several networks' tables with DIFFERENT registration dates — all
 * matches are returned, each tagged with its network (see `matches`).
 *
 * `network` param:
 *   - omitted / empty / 'all' → search every network
 *   - a single network or a comma-separated list (e.g. 'facebook,google') → search those
 *   - any unknown name → 400
 */

const serviceRegistry = require('../../ServiceRegistry');
const { DOMAIN_TABLES, DOMAIN_NETWORKS } = require('../helpers/domainTables');

const AVAILABLE_NETWORKS = DOMAIN_NETWORKS.join(', ');

/**
 * Resolve the `network` param into a concrete list of networks to search.
 * @returns {{ networks: string[] } | { error: string }}
 */
function resolveNetworks(raw) {
  const value = raw == null ? '' : String(raw).toLowerCase().trim();
  if (value === '' || value === 'all') return { networks: [...DOMAIN_NETWORKS] };

  const requested = value.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = requested.filter((n) => !DOMAIN_TABLES[n]);
  if (unknown.length) {
    return { error: `Unsupported network(s): ${unknown.join(', ')}. Available: ${AVAILABLE_NETWORKS}` };
  }
  // de-dupe while preserving order
  return { networks: [...new Set(requested)] };
}

async function lookupOneNetwork(network, domain) {
  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return { network, error: 'SQL connection not available', matches: [] };
  }
  const { table } = DOMAIN_TABLES[network];
  // NO `LIMIT 1`: these tables have no unique index on `domain`, so a domain can span
  // several rows with DIFFERENT registration dates (e.g. one dated + one still NULL).
  // Return each DISTINCT (date, status) within the network so callers see the real picture.
  const rows = await service.db.sql.query(
    `SELECT domain, domain_registered_date, status FROM ${table} WHERE domain = ?`,
    [domain]
  );
  if (!Array.isArray(rows) || rows.length === 0) return { network, found: false, matches: [] };

  const seen = new Set();
  const matches = [];
  for (const row of rows) {
    const date = row.domain_registered_date ?? null;
    const status = row.status ?? null;
    const key = `${date === null ? 'NULL' : String(date)}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ network, domain: row.domain, domain_registered_date: date, status });
  }
  return { network, found: true, matches };
}

/**
 * @param {object} params  { domain, network? }
 * @param {object} [log]   logger
 * @returns {{ code, message, data?, meta? }}
 */
async function lookupDomainRegistration(params, log) {
  const domain = params && params.domain != null ? String(params.domain).trim() : '';
  if (domain === '') {
    return { code: 400, message: 'Please provide proper domain' };
  }

  const resolved = resolveNetworks(params.network);
  if (resolved.error) {
    return { code: 400, message: resolved.error };
  }

  const matches = [];
  const errors = {};

  await Promise.all(
    resolved.networks.map(async (network) => {
      try {
        const r = await lookupOneNetwork(network, domain);
        if (r.error) errors[network] = r.error;
        else if (r.found) matches.push(...r.matches);
      } catch (err) {
        errors[network] = err.message;
        if (log && log.error) log.error('domain registration lookup error', { network, domain, error: err.message });
      }
    })
  );

  // Keep a stable network order in the output (config order, not Promise resolution order).
  matches.sort((a, b) => DOMAIN_NETWORKS.indexOf(a.network) - DOMAIN_NETWORKS.indexOf(b.network));

  const meta = {
    networks_searched: resolved.networks,
    found_count: matches.length,
  };
  if (Object.keys(errors).length) meta.errors = errors;

  if (matches.length === 0) {
    return { code: 404, message: 'Domain not found', data: { domain, matches: [], found_in: [] }, meta };
  }

  const foundIn = matches.map((m) => m.network);
  const distinctDates = [...new Set(matches.map((m) => m.domain_registered_date))];

  return {
    code: 200,
    message: 'Domain found successfully',
    data: {
      domain,
      matches,
      found_in: foundIn,
      distinct_registered_dates: distinctDates,
    },
    meta,
  };
}

module.exports = { lookupDomainRegistration, resolveNetworks };
