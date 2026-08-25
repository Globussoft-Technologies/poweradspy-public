'use strict';

/**
 * LinkedIn ad/advertiser country-name → ISO normalization helpers.
 * Used by adInsightsController.js's getLinkedinAdCountry (single ad) and
 * aggregateCountryData (advertiser-level, date-range) — both need the same
 * alias table, the same non-Latin-script guard, and the same title-casing.
 */

// LinkedIn's targeting names vs. this DB's `country_data.nicename` spellings —
// verified against the actual dev table (2026-08-25): each of these legitimately
// has no exact-match row under the name LinkedIn uses. Table lookup keyed on the
// lower-cased name (multiple keys may point at the same ISO, e.g. two spellings
// of the same country) — see resolveKnownCountryAlias() below for how it's used.
const LINKEDIN_COUNTRY_ISO_ALIASES = {
  'congo - brazzaville': 'CG', 'republic of the congo': 'CG', 'republic of congo': 'CG',
  'congo republic': 'CG', 'congo': 'CG',
  'congo - kinshasa': 'CD', 'dr congo': 'CD', 'democratic republic of the congo': 'CD',
  'democratic republic of congo': 'CD',
  'eswatini': 'SZ',                                  // DB only has "Swaziland"
  'hong kong sar': 'HK', 'hong kong sar china': 'HK', // DB has "Hong Kong"
  'libya': 'LY',                                      // DB has "Libyan Arab Jamahiriya"
  'palestinian territories': 'PS',                    // DB has "Palestinian Territory, Occupied"
  'tanzania': 'TZ',                                   // DB has "Tanzania, United Republic of"
  'trinidad & tobago': 'TT',                          // DB has "Trinidad and Tobago"
  'türkiye': 'TR', 'turkiye': 'TR',                   // DB has no native-spelling row, only "Turkey"
  'south sudan': 'SS',                                // DB predates 2011 — no row at all, even under an alias
  'south korea': 'KR',                                // DB has "Korea, Republic of"
  'taiwan': 'TW',                                     // DB has "Taiwan, Province of China"
  'vietnam': 'VN',                                    // DB has "Viet Nam" (two words)
  'bosnia & herzegovina': 'BA', 'bosnia and herzegovina': 'BA',
  // Montenegro/Serbia split from the old "Serbia and Montenegro" (CS, obsolete) in
  // 2006 — the DB was never updated with their own rows, so there is no correct row
  // to alias to; hardcode their real modern ISO codes instead of reusing CS.
  'montenegro': 'ME',
  'serbia': 'RS',
  // DB has "Cote D'Ivoire" — no accent on the o, straight apostrophe — while
  // LinkedIn sends "Côte d'Ivoire" (accented, curly apostrophe): two mismatches
  // at once, so not even case-insensitive matching bridges it.
  'côte d’ivoire': 'CI', "côte d'ivoire": 'CI', 'cote d’ivoire': 'CI', "cote d'ivoire": 'CI',
};

// Looks up a lower-cased country name in LINKEDIN_COUNTRY_ISO_ALIASES — null when
// there's no known alias for it.
function resolveKnownCountryAlias(lowerCaseName) {
  return LINKEDIN_COUNTRY_ISO_ALIASES[lowerCaseName] || null;
}

/**
 * Best-effort override for a country name → ISO when the DB lookup came back
 * empty. `country` is the raw (pre-titleCase) source name; `iso` is whatever
 * country_data already resolved (or null/'null').
 */
function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  // Only override when the incoming iso is missing so DB values still win.
  if (!iso || iso === 'null') {
    return resolveKnownCountryAlias(name) || iso;
  }
  return iso;
}

// Unicode-aware title case — capitalizes only after the string start or a
// separator (space/apostrophe/hyphen), using \p{L} so it doesn't treat an
// accented letter (é, ü, …) as a non-word char. `country.replace(/\b\w/g, ...)`
// (the old approach) mis-titled "türkiye" as "TüRkiye": JS's \w excludes
// accented letters, so \b sees a false boundary right after "ü" and
// capitalizes the following letter too.
function titleCase(str) {
  const s = String(str || '');
  // Only fix names that came through ALL lowercase (the actual problem this exists
  // for — a non-English LinkedIn UI locale, e.g. "türkiye"). A name that already has
  // any uppercase letter is trusted as-is: blindly re-titling a properly-cased name
  // can make it WORSE — e.g. "Côte d'Ivoire" (correct) became "Côte D'Ivoire" (wrong)
  // because the space before the elided "d'" reads as a new word to capitalize.
  if (/\p{Lu}/u.test(s)) return s;
  return s.replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// `country_data.nicename` is a latin1_swedish_ci column — it can never contain
// (or match) a non-Latin script name, so binding one into a SQL IN(...) doesn't
// just fail to match, it throws ("Conversion from collation utf8mb4_unicode_ci
// into latin1_swedish_ci impossible for parameter") and takes the whole request
// down. Also allows curly quotes/dashes (typographic apostrophe/quotes, en-dash,
// em-dash) — LinkedIn's real data uses these (e.g. "Côte d’Ivoire" with a curly
// apostrophe, U+2019, not a straight one). Used to drop non-Latin names before
// they ever reach a DB query or the response — the scraped `countries` array
// sometimes carries the SAME country twice, once per LinkedIn UI locale (e.g.
// "Armenia" AND "Армения"), so dropping the non-Latin duplicate loses nothing.
function isLatinCountryName(s) {
  return /^[\x00-\x7FÀ-ɏ‘’“”–—]+$/.test(s || '');
}

module.exports = {
  fixCountryIso,
  titleCase,
  isLatinCountryName,
  resolveKnownCountryAlias,
  LINKEDIN_COUNTRY_ISO_ALIASES,
};
