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
