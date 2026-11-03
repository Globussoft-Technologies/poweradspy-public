'use strict';

// Everything the hashing job needs to find a blocked advertiser's images in a network's ad tables:
//   1. which tables to read (the table map, sourceFor)            2. the read-only queries on them
//   3. the spellings of a name to look up (nameCandidates)        4. the URL of a stored image (toFetchableUrl)
const { normalizeName } = require('../blocklist/normalize');

// ═══ 1. Table map ═══
/**
 * Where a network keeps its advertisers (post owners), ads and ad images, for the job that hashes
 * the images of one blocked advertiser. Table and column names are written into SQL, so they are
 * validated as plain identifiers here and never come from user input.
 *
 * Only networks whose tables have been checked are listed. To add one, read its insertion
 * repository (src/services/<network>/insertion/repository.js), check the indexes on the three
 * lookups below (SHOW INDEX), and add an entry here.
 *
 * Facebook, from src/services/facebook/insertion/repository.js (indexes checked on dev:
 * facebook_ad_post_owners.post_owner_lower, facebook_ad.post_owner_id, facebook_ad_variants.facebook_ad_id):
 *   owners    facebook_ad_post_owners   post_owner_lower is generated from post_owner_name; ads_count = its number of ads
 *   ads       facebook_ad               post_owner_id points at the owner; ad_id is the platform's own ad id (unique key)
 *   variants  facebook_ad_variants      image_url is the stored (NAS) path, image_url_original the platform's URL
 *   carousel  facebook_ad_image_video   more images of one ad. Its index has NOT been checked, so it is off by default
 */

const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;

const SOURCES = {
  facebook: {
    owners: { table: 'facebook_ad_post_owners', id: 'id', name: 'post_owner_name', lower: 'post_owner_lower', adsCount: 'ads_count' },
    ads: { table: 'facebook_ad', id: 'id', owner: 'post_owner_id', platformId: 'ad_id' },
    variants: { table: 'facebook_ad_variants', ad: 'facebook_ad_id', image: 'image_url', original: 'image_url_original' },
    carousel: { table: 'facebook_ad_image_video', ad: 'facebook_ad_id', image: 'ad_image_video' },
  },
};

function validate(network, source) {
  for (const [group, columns] of Object.entries(source)) {
    for (const [key, name] of Object.entries(columns)) {
      if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
        throw new Error(`invalid identifier for ${network}.${group}.${key}: ${JSON.stringify(name)}`);
      }
    }
  }
  return source;
}

/** The (validated) table map of a network; throws a clear error for a network that is not supported yet. */
function sourceFor(network, sources = SOURCES) {
  const source = typeof network === 'string' && Object.prototype.hasOwnProperty.call(sources, network) ? sources[network] : null;
  if (!source) {
    throw new Error(`network "${network}" is not supported by the image-hashing job yet (supported: ${Object.keys(sources).join(', ')}). `
      + 'Its advertiser/ad/image tables must be checked and added to src/compliance/imagematch/sources.js.');
  }
  return validate(network, source);
}

// ═══ 2. Read-only queries ═══
/**
 * The read-only queries of the image-hashing job on a network's ad tables. Every query is an index
 * lookup with a LIMIT: no scan, no OFFSET, no LIKE. Nothing here writes.
 *
 *   findOwners       owners by exact lowercase name        (post_owner_lower index)
 *   ownersByIds      owners by id                           (primary key)
 *   adIdsPage        the next page of an owner's ad ids     (post_owner_id index, keyset on id, no sort)
 *   newAdsPage       the next ads after a cursor (new-ad sweep)   (primary-key range)
 *   maxAdId          the newest ad id                       (last primary-key entry)
 *   variantImages    the images of those ads                (facebook_ad_id index)
 *   carouselImages   the extra images of those ads          (index not checked: see sources.js)
 *
 * `source` is a validated table map from sources.js.
 */

const MAX_IN = 500;     // ids or names in one IN (...)
const MAX_OWNERS = 200; // owners one name lookup can return

const q = (identifier) => `\`${identifier}\``;
const marks = (n) => Array(n).fill('?').join(', ');

function clampIn(list, max = MAX_IN) {
  return list.length > max ? list.slice(0, max) : list;
}

/** @returns {Promise<Array<{id, name, ads_count}>>} */
async function findOwners(sql, source, lowerNames) {
  const names = clampIn((lowerNames || []).filter((n) => typeof n === 'string' && n));
  if (!names.length) return [];
  const o = source.owners;
  return sql.query(
    `SELECT ${q(o.id)} AS id, ${q(o.name)} AS name, ${q(o.adsCount)} AS ads_count
       FROM ${q(o.table)}
      WHERE ${q(o.lower)} IN (${marks(names.length)})
      LIMIT ${MAX_OWNERS}`,
    names
  );
}

/** @returns {Promise<Array<{id, name, ads_count}>>} */
async function ownersByIds(sql, source, ids) {
  const list = clampIn((ids || []).filter((v) => v !== null && v !== undefined && v !== ''));
  if (!list.length) return [];
  const o = source.owners;
  return sql.query(
    `SELECT ${q(o.id)} AS id, ${q(o.name)} AS name, ${q(o.adsCount)} AS ads_count
       FROM ${q(o.table)}
      WHERE ${q(o.id)} IN (${marks(list.length)})`,
    list
  );
}

/** The next `limit` ad ids of an owner after `afterId`, in id order. @returns {Promise<Array>} ids */
async function adIdsPage(sql, source, ownerId, afterId, limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_IN);
  const a = source.ads;
  const rows = await sql.query(
    `SELECT ${q(a.id)} AS id
       FROM ${q(a.table)}
      WHERE ${q(a.owner)} = ? AND ${q(a.id)} > ?
      ORDER BY ${q(a.id)}
      LIMIT ${n}`,
    [ownerId, afterId ?? 0]
  );
  return rows.map((r) => r.id);
}

/**
 * The ads after `afterId` up to `upToId`, oldest first, for the sweep of new ads: a primary-key range with a LIMIT
 * (no sort, no OFFSET, no scan of old rows). @returns {Promise<Array<{ id, platformId }>>}
 */
async function newAdsPage(sql, source, afterId, upToId, limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), MAX_IN);
  const a = source.ads;
  const rows = await sql.query(
    `SELECT ${q(a.id)} AS id, ${q(a.platformId)} AS platform_id
       FROM ${q(a.table)}
      WHERE ${q(a.id)} > ? AND ${q(a.id)} <= ?
      ORDER BY ${q(a.id)}
      LIMIT ${n}`,
    [afterId ?? 0, upToId]
  );
  return rows.map((r) => ({ id: r.id, platformId: r.platform_id }));
}

/**
 * The platform's own ad id (the id the scraper stored, e.g. facebook_ad.ad_id) for some of our row ids, by primary key.
 * Everything that leaves this module as "the ad" (blocklist details, review queue, attempts) uses this id; our own row id is
 * only a cursor and is kept beside it as internal_ad_id.
 * @returns {Promise<Map<string, ?string>>} String(row id) -> platform id (null when the row has none)
 */
async function platformIds(sql, source, ids) {
  const list = clampIn(ids || []);
  if (!list.length) return new Map();
  const a = source.ads;
  const rows = await sql.query(
    `SELECT ${q(a.id)} AS id, ${q(a.platformId)} AS platform_id FROM ${q(a.table)} WHERE ${q(a.id)} IN (${marks(list.length)})`,
    list
  );
  return new Map(rows.map((r) => [String(r.id), r.platform_id === null || r.platform_id === undefined || r.platform_id === '' ? null : String(r.platform_id)]));
}

/** The newest ad id (0 for none): the last entry of the primary key, so it costs one index read. */
async function maxAdId(sql, source) {
  const a = source.ads;
  const rows = await sql.query(`SELECT MAX(${q(a.id)}) AS id FROM ${q(a.table)}`, []);
  const top = Number(rows[0] && rows[0].id);
  return Number.isFinite(top) ? top : 0;
}

/** @returns {Promise<Array<{ad_id, image_url, image_url_original}>>} */
async function variantImages(sql, source, adIds) {
  const ids = clampIn(adIds || []);
  if (!ids.length) return [];
  const v = source.variants;
  return sql.query(
    `SELECT ${q(v.ad)} AS ad_id, ${q(v.image)} AS image_url, ${q(v.original)} AS image_url_original
       FROM ${q(v.table)}
      WHERE ${q(v.ad)} IN (${marks(ids.length)})`,
    ids
  );
}

/** @returns {Promise<Array<{ad_id, image_url, image_url_original}>>} */
async function carouselImages(sql, source, adIds) {
  const ids = clampIn(adIds || []);
  if (!ids.length || !source.carousel) return [];
  const c = source.carousel;
  return sql.query(
    `SELECT ${q(c.ad)} AS ad_id, ${q(c.image)} AS image_url, NULL AS image_url_original
       FROM ${q(c.table)}
      WHERE ${q(c.ad)} IN (${marks(ids.length)})`,
    ids
  );
}

// ═══ 3. Spellings of a name ═══
/**
 * The spellings of an advertiser's name to look up in the owner table. The owner table is looked
 * up by exact lowercase name (an index; no scan), so the common ways one name is written are
 * generated here, from the words of the name: separated by a space, '-', '_' or '.', or run
 * together as CamelCase. Each word list is joined the usual ways:
 *
 *   "Twinkling Tree" -> "twinkling tree", "twinklingtree", "twinkling-tree", "twinkling_tree", "twinkling.tree"
 *   "twinkling-tree" and "TwinklingTree" give the same list.
 *
 * What cannot be found: "twinklingtree" typed all in lowercase has no word boundary to split, so
 * it only finds an owner stored exactly like that. A typo, a plural or another word order must be
 * given as an explicit extra name, or the owner by id.
 */

const JOINERS = ['', ' ', '-', '_', '.'];
const SEPARATORS = /[\s\-_.]+/;
const MAX_NAME_LENGTH = 255; // the owner name column is no longer than this
const MAX_CANDIDATES = 60;

// "TwinklingTree" -> "Twinkling Tree" (a lowercase letter or digit followed by a capital).
const splitCamel = (text) => text.replace(/([a-z\d])([A-Z])/g, '$1 $2');

/** @param {string|string[]} names  one name or several @returns {string[]} unique lowercase candidates */
function nameCandidates(names) {
  const list = Array.isArray(names) ? names : [names];
  const out = new Set();
  for (const raw of list) {
    if (typeof raw === 'string' && raw.length > MAX_NAME_LENGTH * 2) continue;
    for (const text of typeof raw === 'string' ? [raw, splitCamel(raw)] : [raw]) {
      const base = normalizeName(text);
      if (!base || base.length > MAX_NAME_LENGTH) continue;
      out.add(base);
      const words = base.split(SEPARATORS).filter(Boolean);
      if (words.length > 1) {
        for (const joiner of JOINERS) out.add(words.join(joiner));
      }
    }
    if (out.size >= MAX_CANDIDATES) break;
  }
  return [...out].slice(0, MAX_CANDIDATES);
}

// ═══ 4. URL of a stored image ═══
/**
 * Turns a stored image path into a URL the image-hashing service can fetch.
 *
 * Images are stored as NAS paths (`fb/adImage/202610/134193.jpeg`) and served from
 * the CDN base in config (`cdn.baseUrl`). The rules mirror withCdn() in the services'
 * paramParser files, so the same stored value gives the same URL. Exactly one `/`
 * joins the base and the path: a double slash (`host//path`) is a 404 on that CDN.
 */

// Old prefixes that are part of a stored path but not of the CDN path.
const LEGACY_PREFIX = /^\/?(PowerAdspy\/n2|PowerAdspy-Dev|PowerAdspy|pas-dev\/stream|pas-prod\/stream)\//i;
// /PowerAdspy/fb/<folder>/<optional year>/<file>.<ext> is already the CDN location: keep as is.
const KEEP_AS_IS = /^\/?PowerAdspy\/fb\/[^/]+\/(\d+\/)?[^/]+\.[^/]+$/i;

function trimBase(base) {
  return typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
}

/**
 * @param {string} stored   image_url / image_url_original as stored (may hold two URLs joined by "||")
 * @param {string} cdnBase  config cdn.baseUrl
 * @returns {string} a full http(s) URL, or '' when there is nothing usable
 */
function one(value, base) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (!base) return '';
  const path = KEEP_AS_IS.test(value) ? value : value.replace(LEGACY_PREFIX, '/');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/**
 * Is this URL a file the hashing service can take as an image? A stored path with no image extension (a video id, for example) is not:
 * the CDN answers 400 for it, so the call would be wasted (about a third of the stored paths of the dev sample were like that).
 */
function hasImageExtension(url) {
  if (typeof url !== 'string') return false;
  return /\.(jpe?g|png|webp|gif|bmp|avif|heic|tiff?)$/i.test(url.split('#')[0].split('?')[0]);
}

function toFetchableUrl(stored, cdnBase) {
  if (typeof stored !== 'string') return '';
  const base = trimBase(cdnBase);
  // Some rows pack a primary and a fallback URL into one field: the first usable one wins.
  for (const part of stored.split('||')) {
    const url = one(part.trim(), base);
    if (url) return url;
  }
  return '';
}

module.exports = {
  SOURCES, IDENTIFIER, sourceFor,
  findOwners, ownersByIds, adIdsPage, newAdsPage, maxAdId, platformIds, hasImageExtension, variantImages, carouselImages, MAX_IN, MAX_OWNERS,
  nameCandidates, MAX_CANDIDATES,
  toFetchableUrl,
};
