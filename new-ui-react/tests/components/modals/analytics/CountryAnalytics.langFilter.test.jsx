import { describe, expect, it } from "vitest";
import { normalizeCountryIdentity } from "../../../../src/components/modals/analytics/CountryAnalytics.jsx";

// REGION_ISO_MAP and the two transform functions below are copied verbatim
// from src/components/modals/analytics/CountryAnalytics.jsx (post-fix) —
// they aren't exported by the component, so this mirrors the exact logic
// to verify the language-filtering fix end-to-end with the real
// normalizeCountryIdentity (which IS imported live from the source).
const REGION_ISO_MAP = {
  DACH: ['DE', 'AT', 'CH'],
  BENELUX: ['BE', 'NL', 'LU'],
  NORDICS: ['SE', 'NO', 'DK', 'FI', 'IS'],
  CEE: ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL'],
  GCC: ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'],
  MENA: ['SA', 'AE', 'EG', 'MA', 'DZ', 'TN', 'LY', 'IQ', 'SY', 'JO', 'LB', 'YE', 'OM', 'QA', 'KW', 'BH'],
  SEA: ['SG', 'MY', 'TH', 'PH', 'ID', 'VN', 'MM', 'KH', 'LA', 'BN'],
  APAC: ['AU', 'NZ', 'JP', 'KR', 'CN', 'IN', 'SG', 'MY', 'TH', 'PH', 'ID', 'VN', 'TW', 'HK'],
  LATAM: ['BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY'],
};

function transformAdvertiserCountry(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const results = [];
  for (const item of raw) {
    const countryUpper = (item.country || '').toUpperCase();
    const { iso, name } = normalizeCountryIdentity(item.country, item.iso);
    const count = (() => {
      const candidates = [item.ad_count, item.count, Array.isArray(item.ad_ids) ? item.ad_ids.length : null];
      for (const candidate of candidates) {
        const num = Number(candidate);
        if (Number.isFinite(num) && num > 0) return num;
      }
      return 1;
    })();
    if (!iso && countryUpper === 'ALL') {
      results.push({ id: 'ALL', name: 'Worldwide', count });
    } else if (iso) {
      results.push({ id: iso, name, count });
    } else if (countryUpper && REGION_ISO_MAP[countryUpper]) {
      results.push({ id: countryUpper, name: item.country, count });
    }
  }
  return results.length > 0 ? results : null;
}

function transformAdCountry(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const results = [];
  const map = {};
  let hasAll = false;
  for (const item of raw) {
    const nameUpper = (item.country || '').toUpperCase();
    const { iso, name } = normalizeCountryIdentity(item.country, item.iso);
    if (!iso && nameUpper === 'ALL') {
      if (!hasAll) { results.push({ id: 'ALL', name: 'Worldwide', count: item.ad_count || 1 }); hasAll = true; }
      continue;
    }
    if (iso) {
      if (!map[iso]) { map[iso] = { id: iso, name, count: 0 }; results.push(map[iso]); }
      map[iso].count += 1;
    } else if (nameUpper && REGION_ISO_MAP[nameUpper]) {
      if (!map[nameUpper]) { map[nameUpper] = { id: nameUpper, name, count: 0 }; results.push(map[nameUpper]); }
      map[nameUpper].count += 1;
    }
  }
  return results.length > 0 ? results : null;
}

describe("CountryAnalytics — non-English country names are hidden (production Reddit Country Reach bug)", () => {
  // Exact rows from the reported screenshot: India, United States, 美国,
  // China, France, Romania, Sweden, Switzerland, EUA, États Unis, 中国,
  // США, Netherlands.
  const raw = [
    { country: "India", ad_count: 100 },
    { country: "United States", ad_count: 114 },
    { country: "美国", ad_count: 4 },        // Chinese for "United States"
    { country: "China", ad_count: 3 },
    { country: "France", ad_count: 2 },
    { country: "Romania", ad_count: 2 },
    { country: "Sweden", ad_count: 2 },
    { country: "Switzerland", ad_count: 2 },
    { country: "EUA", ad_count: 1 },         // Portuguese abbrev. for "United States"
    { country: "États Unis", ad_count: 1 },  // French for "United States"
    { country: "中国", ad_count: 1 },        // Chinese for "China"
    { country: "США", ad_count: 1 },         // Russian for "United States"
    { country: "Netherlands", ad_count: 1 },
  ];

  it("advertiser-level: drops every non-English duplicate, keeps every resolvable country", () => {
    const result = transformAdvertiserCountry(raw);
    const names = result.map((c) => c.name);
    const ids = result.map((c) => c.id);

    for (const foreign of ["美国", "中国", "США", "EUA", "États Unis"]) {
      expect(names).not.toContain(foreign);
      expect(ids).not.toContain(foreign.toUpperCase());
    }
    expect(names).toEqual(
      expect.arrayContaining(["India", "United States", "China", "France", "Romania", "Sweden", "Switzerland", "Netherlands"]),
    );
    expect(result).toHaveLength(8); // 13 raw rows − 5 unresolved foreign-language rows
  });

  it("ad-level: same filtering applies", () => {
    const result = transformAdCountry(raw);
    const names = result.map((c) => c.name);
    for (const foreign of ["美国", "中国", "США", "EUA", "États Unis"]) {
      expect(names).not.toContain(foreign);
    }
    expect(names).toEqual(
      expect.arrayContaining(["India", "United States", "China", "France", "Romania", "Sweden", "Switzerland", "Netherlands"]),
    );
  });

  it("still shows known named regions with no single ISO (e.g. DACH) — not swept up by the filter", () => {
    const result = transformAdvertiserCountry([...raw, { country: "DACH", ad_count: 5 }]);
    expect(result.map((c) => c.id)).toContain("DACH");
  });

  it("still shows the Worldwide (ALL) entry", () => {
    const result = transformAdvertiserCountry([...raw, { country: "ALL", ad_count: 50 }]);
    expect(result.find((c) => c.id === "ALL")).toEqual({ id: "ALL", name: "Worldwide", count: 50 });
  });
});
