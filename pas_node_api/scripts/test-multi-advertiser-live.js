'use strict';

const { Client } = require('@elastic/elasticsearch');
const networks = require('../src/config/networks');

const VALUES = ['nykaa', 'myntra', 'dell', 'samsung', 'nextdoor'];

const SPECS = [
  ['facebook', require('../src/services/facebook/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['instagram', require('../src/services/instagram/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['youtube', require('../src/services/youtube/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['gdn', require('../src/services/gdn/builders/SearchMixQueryBuilder'), 'setPostOwnerName'],
  ['linkedin', require('../src/services/linkedin/builders/LinkedinSearchQueryBuilder'), 'setPostOwnerName'],
  ['native', require('../src/services/native/builders/NativeSearchQueryBuilder'), 'setPostOwnerName'],
  ['reddit', require('../src/services/reddit/builders/RedditSearchQueryBuilder'), 'setPostOwnerName'],
  ['quora', require('../src/services/quora/builders/QuoraSearchQueryBuilder'), 'setPostOwnerName'],
  ['pinterest', require('../src/services/pinterest/builders/PinterestSearchQueryBuilder'), 'setPostOwnerName'],
  ['google', require('../src/services/google/builders/GoogleSearchQueryBuilder'), 'setPostOwnerName'],
  ['tiktok', require('../src/services/tiktok/builders/TiktokSearchQueryBuilder'), 'setAdvertiser'],
  ['chatgptads', require('../src/services/chatgptads/builders/ChatgptSearchQueryBuilder'), 'setPostOwnerName'],
];

function elasticConfig(slug) {
  const database = networks[slug]?.database || {};
  return slug === 'tiktok' ? database.elastic_tiktok : database.elastic;
}

function buildParams(slug, Builder, setter, exactOwnerIds = []) {
  const cfg = elasticConfig(slug);
  const builder = new Builder(cfg?.index).setSize(5);
  if (slug === 'chatgptads') builder[setter](VALUES, true);
  else {
    if (typeof builder.setExactSearch === 'function') builder.setExactSearch(true);
    if (exactOwnerIds.length && typeof builder.setExactPostOwnerIds === 'function') {
      builder.setExactPostOwnerIds(exactOwnerIds);
    }
    builder[setter](VALUES);
  }
  return builder.build();
}

async function resolveExactOwnerIds(slug) {
  if (slug !== 'youtube' && slug !== 'linkedin') return { ids: [], resolved: false };
  const cfg = networks[slug]?.database?.sql;
  if (!cfg?.enabled || !cfg?.host) return { ids: [], resolved: false };
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectTimeout: 10000,
  });
  try {
    const table = slug === 'youtube' ? 'youtube_ad_post_owners' : 'linkedin_ad_post_owners';
    const placeholders = VALUES.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT id FROM ${table} WHERE LOWER(post_owner_name) IN (${placeholders})`,
      VALUES
    );
    return {
      ids: rows.map((row) => Number(row.id)).filter(Number.isFinite),
      resolved: true,
    };
  } finally {
    await connection.end();
  }
}

function admobParams() {
  const cfg = elasticConfig('admob');
  return {
    index: cfg?.index,
    body: {
      size: 5,
      track_total_hits: true,
      query: {
        bool: {
          filter: [
            { term: { status: 1 } },
            { terms: { 'post_owner.keyword': VALUES } },
          ],
        },
      },
      sort: [{ last_seen: { order: 'desc', missing: '_last' } }, { id: 'desc' }],
    },
  };
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((entry) => walk(entry, visit));
    else walk(child, visit);
  }
}

function queryShape(query) {
  let termsOr = false;
  let shouldOr = false;
  let andAcrossValues = false;
  walk(query, (node) => {
    if (node.terms) {
      for (const list of Object.values(node.terms)) {
        const normalized = Array.isArray(list) ? list.map((v) => String(v).toLowerCase()) : [];
        if (VALUES.every((value) => normalized.includes(value))) termsOr = true;
      }
    }
    const should = node.bool?.should;
    if (Array.isArray(should)) {
      const text = JSON.stringify(should).toLowerCase();
      if (VALUES.every((value) => text.includes(value)) && node.bool.minimum_should_match === 1) shouldOr = true;
    }
    const must = node.bool?.must;
    if (Array.isArray(must) && must.length > 1) {
      const matchingChildren = must.filter((child) => {
        const text = JSON.stringify(child).toLowerCase();
        return VALUES.some((value) => text.includes(value));
      });
      if (matchingChildren.length > 1) andAcrossValues = true;
    }
  });
  return {
    type: termsOr ? 'terms_or' : shouldOr ? 'should_or' : 'unknown',
    is_or: termsOr || shouldOr,
    and_across_values: andAcrossValues,
  };
}

function ownerFromSource(slug, source) {
  const fields = {
    facebook: 'facebook_ad_post_owners.post_owner_name',
    instagram: 'instagram_ad_post_owners.post_owner_name',
    gdn: 'gdn_ad_post_owners.post_owner_name',
    native: 'native_ad_post_owners.post_owner_name',
    reddit: 'reddit_ad_post_owners.post_owner_name',
    quora: 'quora_ad_post_owners.post_owner_name',
    pinterest: 'pinterest_ad_post_owners.post_owner_name',
    youtube: 'post_owner',
    linkedin: 'post_owner',
    google: 'post_owner_name',
    tiktok: 'post_owner',
    chatgptads: 'post_owner_name',
    admob: 'post_owner',
  };
  return source?.[fields[slug]] ?? source?.post_owner_name ?? source?.post_owner ?? null;
}

function totalValue(total) {
  return Number(typeof total === 'object' && total !== null ? total.value : total) || 0;
}

async function main() {
  const paramsByNetwork = new Map();
  const exactIdLookups = new Map();
  for (const [slug, Builder, setter] of SPECS) {
    let lookup = { ids: [], resolved: false };
    try { lookup = await resolveExactOwnerIds(slug); } catch { /* report ES result if SQL is unavailable */ }
    exactIdLookups.set(slug, lookup);
    paramsByNetwork.set(slug, buildParams(slug, Builder, setter, lookup.ids));
  }
  paramsByNetwork.set('admob', admobParams());

  const clients = new Map();
  const results = [];
  for (const [slug, params] of paramsByNetwork) {
    const cfg = elasticConfig(slug);
    const shape = queryShape(params.body.query);
    const exactIdLookup = exactIdLookups.get(slug);
    if ((slug === 'youtube' || slug === 'linkedin') && exactIdLookup?.resolved && exactIdLookup.ids.length === 0) {
      results.push({
        network: slug,
        index: params.index,
        query: shape,
        live: 'ok',
        total: 0,
        returned: 0,
        sample_advertisers: [],
        strict_exact_returned: 0,
        samples_are_exact: true,
        short_circuited_no_exact_owner_ids: true,
        exact_owner_ids_applied: 0,
      });
      continue;
    }
    if (!cfg?.enabled || !cfg?.node || !params.index) {
      results.push({ network: slug, index: params.index || null, query: shape, live: 'not_configured' });
      continue;
    }
    const key = `${Array.isArray(cfg.node) ? cfg.node.join(',') : cfg.node}|${cfg.auth?.username || ''}`;
    let client = clients.get(key);
    if (!client) {
      const nodes = Array.isArray(cfg.node)
        ? cfg.node
        : String(cfg.node).split(/[,\s]+/).filter(Boolean);
      client = new Client({
        ...(nodes.length > 1 ? { nodes } : { node: nodes[0] }),
        requestTimeout: 20000,
        maxRetries: 1,
        ...(cfg.auth?.username ? { auth: { username: cfg.auth.username, password: cfg.auth.password || '' } } : {}),
      });
      clients.set(key, client);
    }
    try {
      const response = await client.search(params);
      const payload = response.body || response;
      const hits = payload.hits?.hits || [];
      const owners = hits.map((hit) => ownerFromSource(slug, hit._source)).filter(Boolean);
      const strictOwners = owners.filter((owner) => VALUES.includes(String(owner).trim().toLowerCase()));
      results.push({
        network: slug,
        index: params.index,
        query: shape,
        live: 'ok',
        total: totalValue(payload.hits?.total),
        returned: hits.length,
        sample_advertisers: [...new Set(owners)].slice(0, 5),
        strict_exact_returned: strictOwners.length,
        samples_are_exact: strictOwners.length === owners.length,
        took_ms: payload.took ?? null,
        timed_out: payload.timed_out === true,
        ...(slug === 'youtube' || slug === 'linkedin'
          ? { exact_owner_ids_applied: exactIdLookup?.ids.length || 0 }
          : {}),
      });
    } catch (error) {
      results.push({
        network: slug,
        index: params.index,
        query: shape,
        live: 'error',
        error: error.message,
      });
    }
  }

  await Promise.allSettled([...clients.values()].map((client) => client.close()));
  process.stdout.write(`${JSON.stringify({ advertisers: VALUES, exact_search: true, results }, null, 2)}\n`);
  if (results.some((result) => !result.query.is_or || result.query.and_across_values)) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
