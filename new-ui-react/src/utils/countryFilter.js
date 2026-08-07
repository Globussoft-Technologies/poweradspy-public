/**
 * Country-filter helpers.
 *
 * The SDUI Country combobox stores the DISPLAY LABEL (e.g. "Saudi Arabia"), not the
 * ISO code — see SchemaRenderer's geo `valueKey: 'label'` — because the ads-search
 * query matches on the display name. The keyword-search store, however, wants the
 * **ISO 2-letter code** (e.g. "SA"). The code lives on each option as `value`, so we
 * map the selected label(s) back to their `value` using the SDUI config's country
 * options before sending to `saveKeywordSearch`.
 */

import { COUNTRY_NAMES, NAME_TO_ISO } from "./countries";

const COUNTRY_CODE_ALIASES = {
  uk: "GB",
};

const resolveCountryIso = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const upper = raw.toUpperCase();
  if (upper === "ALL") return "ALL";

  if (upper.length === 2) {
    return COUNTRY_CODE_ALIASES[upper.toLowerCase()] || upper;
  }

  return NAME_TO_ISO[upper] || "";
};

const resolveCountryName = (value) => {
  const iso = resolveCountryIso(value);
  if (iso === "ALL") return "Global Reach";
  if (iso && COUNTRY_NAMES[iso]) return COUNTRY_NAMES[iso];

  return String(value ?? "").trim();
};

/**
 * Locate the `country_filter` combobox options anywhere in the SDUI config,
 * regardless of which section (sidebar/navbar/searchbar/filters) holds it.
 * @returns {Array} the options array [{ label, value }] (possibly empty)
 */
export function findCountryOptions(config) {
  if (!config || typeof config !== 'object') return [];
  const sections = ['sidebar', 'navbar', 'searchbar', 'filters'];
  for (const key of sections) {
    const groups = config[key];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const f of group?.filters || []) {
        if ((f._id === 'country_filter' || f.query_param === 'countries' || f.query_param === 'country') && Array.isArray(f.options)) {
          return f.options;
        }
      }
    }
  }
  return [];
}

export function normalizeCountrySearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[`'\u2019]/g, '')
    .replace(/[_\s-]+/g, ' ')
    .trim();
}

const REUNION_COUNTRY_LABEL = 'R\u00e9union';
const FRANCE_REUNION_COUNTRY_GROUP = ['France', REUNION_COUNTRY_LABEL];
const FRANCE_REUNION_ALIASES = new Set([
  'france',
  'reunion',
  normalizeCountrySearchValue(REUNION_COUNTRY_LABEL),
  normalizeCountrySearchValue("re'union"),
  normalizeCountrySearchValue('re`union'),
]);

export function isFranceReunionCountryValue(value) {
  return FRANCE_REUNION_ALIASES.has(normalizeCountrySearchValue(value));
}

export function matchesCountryOptionSearch(optionLabel, query) {
  const normalizedQuery = normalizeCountrySearchValue(query);
  if (!normalizedQuery) return true;

  const normalizedLabel = normalizeCountrySearchValue(optionLabel);
  if (normalizedLabel.includes(normalizedQuery)) return true;

  if (normalizedLabel === 'france') {
    return Array.from(FRANCE_REUNION_ALIASES).some((alias) =>
      alias.includes(normalizedQuery) || normalizedQuery.includes(alias)
    );
  }

  return false;
}

export function expandCountryFilterValues(values) {
  const list = Array.isArray(values)
    ? values
    : values == null || values === ''
      ? []
      : [values];

  if (!list.length) return [];

  const shouldExpandFranceReunion = list.some(isFranceReunionCountryValue);

  const out = [];
  const seen = new Set();
  const add = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const key = normalizeCountrySearchValue(raw);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(raw);
  };

  if (shouldExpandFranceReunion) {
    FRANCE_REUNION_COUNTRY_GROUP.forEach(add);
    list.filter((value) => !isFranceReunionCountryValue(value)).forEach(add);
  } else {
    list.forEach(add);
  }

  const expanded = [];
  const pushUnique = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    const key = normalizeCountrySearchValue(raw);
    if (expanded.some((entry) => normalizeCountrySearchValue(entry) === key)) return;
    expanded.push(raw);
  };

  for (const value of out) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;

    const normalized = normalizeCountrySearchValue(raw);
    if (normalized === "all" || normalized === "global reach") {
      pushUnique("ALL");
      pushUnique("Global Reach");
      continue;
    }

    pushUnique(raw);

    const iso = resolveCountryIso(raw);
    if (iso) pushUnique(iso);

    const countryName = resolveCountryName(raw);
    if (countryName) pushUnique(countryName);
  }

  return expanded;
}

/**
 * Map the Country filter's selected value(s) → ISO 2-letter code(s).
 * `selected` are the combobox labels (e.g. ["Saudi Arabia"]); `options` come from
 * findCountryOptions. Matches by label first, then by value (so an entry that is
 * already a code still resolves), preserving order and deduping case-insensitively.
 * Returns the code array, or null when nothing is selected — so the store field is
 * null (never a name) in the no-filter case. Unmapped entries fall back to their raw
 * trimmed value (unreachable in practice: the options are the same source that
 * populated the dropdown).
 */
export function labelsToCountryCodes(selected, options) {
  if (!Array.isArray(selected) || selected.length === 0) return null;
  const byLabel = new Map();
  const byValue = new Map();
  for (const o of options || []) {
    if (!o) continue;
    const code = String(o.value ?? o.label ?? '').trim();
    if (o.label != null) byLabel.set(String(o.label).trim().toLowerCase(), code);
    if (o.value != null) byValue.set(String(o.value).trim().toLowerCase(), code);
  }
  const out = [];
  const seen = new Set();
  for (const sel of selected) {
    const key = String(sel ?? '').trim().toLowerCase();
    if (!key) continue;
    const code = byLabel.get(key) || byValue.get(key) || String(sel).trim();
    if (!code) continue;
    const dedupeKey = code.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(code);
  }
  return out.length ? out : null;
}
