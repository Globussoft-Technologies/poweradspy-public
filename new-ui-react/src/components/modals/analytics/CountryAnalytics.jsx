import { useState, useLayoutEffect, useRef, useId, useMemo, useEffect } from 'react';
import { Search, Circle, Globe } from 'lucide-react';
import * as am5 from '@amcharts/amcharts5';
import * as am5map from '@amcharts/amcharts5/map';
import am5geodata_worldLow from '@amcharts/amcharts5-geodata/worldLow';
import am5themes_Dark from '@amcharts/amcharts5/themes/Dark';
import { useTheme } from '../../../hooks/useTheme';
import DateRangePicker from './DateRangePicker';
import { getAdvertiserInsightsByDateRange } from '../../../services/api';
import { COUNTRY_NAMES, NAME_TO_ISO } from '../../../utils/countries';

// Named regions that have no single ISO — expand to constituent country ISOs for map highlighting
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

/**
 * Transform ad-level country data: [{ country, iso }]
 * For ad-level we show ad_count = number of times country appears (or 1 each).
 */
function transformAdCountry(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const results = [];
  const map = {};
  let hasAll = false;
  for (const item of raw) {
    const nameUpper = (item.country || '').toUpperCase();
    let iso = (item.iso || NAME_TO_ISO[nameUpper] || '').toUpperCase();
    const name = item.country || '';

    if (!iso && nameUpper === 'ALL') {
      if (!hasAll) {
        results.push({ id: 'ALL', name: 'Worldwide', count: item.ad_count || 1 });
        hasAll = true;
      }
      continue;
    }

    // If we found an ISO code, use it as the id (deduplicates SG vs Singapore, etc)
    if (iso) {
      if (!map[iso]) {
        map[iso] = { id: iso, name: COUNTRY_NAMES[iso] || name || iso, count: 0 };
        results.push(map[iso]);
      }
      map[iso].count += 1;
    } else if (nameUpper) {
      // Unknown region with no ISO (e.g. DACH) — use name as id
      if (!map[nameUpper]) {
        map[nameUpper] = { id: nameUpper, name, count: 0 };
        results.push(map[nameUpper]);
      }
      map[nameUpper].count += 1;
    }
  }
  return results.length > 0 ? results : null;
}

/**
 * Transform advertiser-level country data: [{ country, iso, ad_ids, ad_count }]
 */
function transformAdvertiserCountry(raw, adData) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

  const results = [];

  for (const item of raw) {
    const countryUpper = (item.country || '').toUpperCase();
    const iso = (item.iso || NAME_TO_ISO[countryUpper] || '').toUpperCase() || null;

    const count = item.ad_count || (item.ad_ids ? item.ad_ids.length : 0);

    if (!iso && countryUpper === 'ALL') {
      results.push({ id: 'ALL', name: 'Worldwide', count });
    } else if (iso) {
      results.push({ id: iso, name: item.country || COUNTRY_NAMES[iso] || iso, count });
    } else {
      // Unknown region with no ISO (e.g. DACH) — use name as id, won't highlight on map but shows in list
      results.push({ id: countryUpper, name: item.country, count });
    }
  }
  return results.length > 0 ? results : null;
}


const CountryAnalytics = ({ adId, adCountry, advertiserCountry, platform, network = 'facebook', tiktokAnalytics, postOwnerId, availableYears }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isTikTok = (platform || '').toLowerCase() === 'tiktok';
  const hideToggle = false;
  const [level, setLevel] = useState('advertiser');
  const [filteredCountryData, setFilteredCountryData] = useState(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [viewMode, setViewMode] = useState('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [deselectedAd, setDeselectedAd] = useState(new Set());
  const [deselectedAdvertiser, setDeselectedAdvertiser] = useState(new Set());
  const deselected = level === 'ad' ? deselectedAd : deselectedAdvertiser;
  const setDeselected = level === 'ad' ? setDeselectedAd : setDeselectedAdvertiser;

  // Reset state when navigating to a different ad
  useEffect(() => {
    setLevel('advertiser');
    setFilteredCountryData(null);
    setIsFiltering(false);
    setViewMode('map');
    setSearchQuery('');
    setDeselectedAd(new Set());
    setDeselectedAdvertiser(new Set());
  }, [adId]);
  const mapRootRef = useRef(null);
  const uniqueId = useId();
  const mapId = `country-map-${uniqueId.replace(/:/g, "")}`;

  // TikTok: derive ad-level country data from analytics payload countries array
  const tiktokCountryData = useMemo(() => {
    if (!isTikTok || !tiktokAnalytics?.countries) return null;
    const countries = tiktokAnalytics.countries;
    if (!Array.isArray(countries) || countries.length === 0) return null;
    const map = {};
    for (const rawIso of countries) {
      const iso = String(rawIso).toUpperCase();
      if (!map[iso])
        map[iso] = { id: iso, name: COUNTRY_NAMES[iso] || iso, count: 0 };
      map[iso].count += 1;
    }
    return Object.values(map);
  }, [isTikTok, tiktokAnalytics]);

  const adData = useMemo(() => isTikTok ? tiktokCountryData : transformAdCountry(adCountry), [adCountry, isTikTok, tiktokCountryData]);
  const advertiserData = useMemo(() => transformAdvertiserCountry(filteredCountryData || advertiserCountry, adData), [advertiserCountry, filteredCountryData, adData]);

  const countryData = useMemo(() => (level === 'ad' ? adData : advertiserData) || [], [level, adData, advertiserData]);

  const handleDateRangeApply = async (range) => {
    if (!range) {
      setFilteredCountryData(null);
      return;
    }
    
    setIsFiltering(true);
    try {
      const res = await getAdvertiserInsightsByDateRange({
        post_owner_id: postOwnerId || (advertiserCountry?.[0]?.post_owner_id),
        from_date: range.fromDate,
        to_date: range.toDate,
        type: 'country',
        network,
      });
      if (res.code === 200) {
        setFilteredCountryData(res.data);
      } else {
        setFilteredCountryData([]); // Clear to show "No data found"
      }
    } catch (err) {
      console.error('Country Date Range Fetch Error:', err);
    } finally {
      setIsFiltering(false);
    }
  };
  const noData = countryData.length === 0;

  // Whether the Worldwide (ALL) entry is present and not deselected
  const hasWorldwide = useMemo(() => countryData.some((c) => c.id === 'ALL'), [countryData]);

  const selectedCountries = useMemo(() => {
    const ids = countryData.map((c) => c.id).filter((id) => !deselected.has(id));
    if (ids.includes('ALL')) return [...ids, '__all_highlighted__'];
    // Expand region IDs to their constituent ISOs so the map can highlight them
    const expanded = [...ids];
    for (const id of ids) {
      const isos = REGION_ISO_MAP[id.toUpperCase()];
      if (isos) expanded.push(...isos);
    }
    return expanded;
  }, [countryData, deselected]);

  const maxCount =
    countryData.length > 0 ? Math.max(...countryData.map((c) => c.count)) : 1;

  // Build map: ISO → entry. For region entries (e.g. DACH), also map each constituent ISO to that entry.
  const countryMap = useMemo(() => {
    const map = {};
    for (const c of countryData) {
      map[c.id] = c;
      const isos = REGION_ISO_MAP[c.id.toUpperCase()];
      if (isos) {
        for (const iso of isos) map[iso] = c;
      }
    }
    return map;
  }, [countryData]);

  const handleToggleCountry = (id) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredCountries = searchQuery
    ? countryData.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : countryData;

  const getHeatColor = (count) => {
    const t = maxCount > 0 ? count / maxCount : 0;
    // Low: soft amber (180,120,60) → High: vivid orange (249,115,22)
    const r = Math.round(180 + t * (249 - 180));
    const g = Math.round(120 + t * (115 - 120));
    const b = Math.round(60 + t * (22 - 60));
    return {
      r,
      g,
      b,
      hex: (r << 16) | (g << 8) | b,
      css: `rgb(${r},${g},${b})`,
    };
  };

  // amCharts Map
  useLayoutEffect(() => {
    if (mapRootRef.current) mapRootRef.current.dispose();

    const root = am5.Root.new(mapId);
    mapRootRef.current = root;

    if (!isLight) root.setThemes([am5themes_Dark.new(root)]);
    root._logo.dispose();

    const isGlobe = viewMode === "globe";

    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        projection: isGlobe
          ? am5map.geoOrthographic()
          : am5map.geoNaturalEarth1(),
        panX: isGlobe ? "rotateX" : "translateX",
        panY: isGlobe ? "rotateY" : "none",
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
      }),
    );

    const graticuleSeries = chart.series.push(
      am5map.GraticuleSeries.new(root, {}),
    );
    graticuleSeries.mapLines.template.setAll({
      stroke: am5.color(isLight ? 0x000000 : 0xffffff),
      strokeOpacity: isLight ? 0.06 : 0.04,
      strokeWidth: 0.5,
    });

    if (isGlobe) {
      const bg = chart.set("background", am5.Rectangle.new(root, {}));
      // Globe outer bg: matches the surrounding page (slate-100 in light,
      // near-black in dark) so the sphere sits cleanly on the surface.
      bg.setAll({ fill: am5.color(isLight ? 0xf1f5f9 : 0x0e0e0e), fillOpacity: 1 });
      chart.seriesContainer.set(
        "background",
        // Globe sphere fill: one step darker than the page bg in light mode
        // so the sphere boundary is visible against the page.
        am5.Circle.new(root, { fill: am5.color(isLight ? 0xe2e8f0 : 0x111114), fillOpacity: 1 }),
      );
    }

    const polygonSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, {
        geoJSON: am5geodata_worldLow,
        exclude: ["AQ"],
      }),
    );

    polygonSeries.mapPolygons.template.setAll({
      // Country fill: slate-300 reads as a soft cool-grey landmass on a
      // slate-100 page (was 0x1a1a2e — basically black, the bug). Heat-
      // coloured countries override this via the per-country fill adapter
      // below, so non-selected countries get the soft tone while selected
      // countries keep the orange/heatmap colour.
      fill: am5.color(isLight ? 0xcbd5e1 : 0x2a2a32),
      // White separators between landmasses for a clean light-theme look.
      stroke: am5.color(isLight ? 0xffffff : 0x3a3a42),
      strokeWidth: isLight ? 0.6 : 0.4,
      interactive: true,
      cursorOverStyle: "pointer",
    });

    polygonSeries.mapPolygons.template.states.create("hover", {
      // Hover: bump one shade darker (slate-400 in light, soft navy in dark).
      fill: am5.color(isLight ? 0x94a3b8 : 0x444b6e),
    });

    const isAllHighlighted = selectedCountries.includes('__all_highlighted__');
    const worldwideEntry = countryData.find(c => c.id === 'ALL');

    polygonSeries.mapPolygons.template.adapters.add("fill", (fill, target) => {
      const id = target.dataItem?.dataContext?.id;
      if (!id) return fill;
      if (isAllHighlighted && !deselected.has('ALL')) {
        // Use worldwide count for heat color on all countries
        const entry = countryMap[id] || worldwideEntry;
        if (entry) return am5.color(getHeatColor(entry.count).hex);
      }
      if (id && selectedCountries.includes(id) && countryMap[id])
        return am5.color(getHeatColor(countryMap[id].count).hex);
      return fill;
    });
    polygonSeries.mapPolygons.template.adapters.add(
      "fillOpacity",
      (opacity, target) => {
        const id = target.dataItem?.dataContext?.id;
        if (isAllHighlighted && !deselected.has('ALL')) return 0.7;
        if (id && selectedCountries.includes(id) && countryMap[id]) {
          const t = countryMap[id].count / maxCount;
          return 0.4 + t * 0.55;
        }
        return 1;
      },
    );
    polygonSeries.mapPolygons.template.adapters.add(
      "stroke",
      (stroke, target) => {
        const id = target.dataItem?.dataContext?.id;
        if (!id) return stroke;
        if (isAllHighlighted && !deselected.has('ALL')) {
          const entry = countryMap[id] || worldwideEntry;
          if (entry) return am5.color(getHeatColor(entry.count).hex);
        }
        if (id && selectedCountries.includes(id) && countryMap[id])
          return am5.color(getHeatColor(countryMap[id].count).hex);
        return stroke;
      },
    );
    polygonSeries.mapPolygons.template.adapters.add(
      "strokeOpacity",
      (opacity, target) => {
        const id = target.dataItem?.dataContext?.id;
        if (isAllHighlighted && !deselected.has('ALL')) return 0.6;
        if (id && selectedCountries.includes(id)) return 0.6;
        return 0.3;
      },
    );

    polygonSeries.mapPolygons.template.events.on("pointerover", (ev) => {
      const id = ev.target.dataItem?.dataContext?.id;
      if (id && selectedCountries.includes(id)) {
        ev.target.set("fillOpacity", 1);
        ev.target.set("strokeWidth", 1.2);
      }
    });
    polygonSeries.mapPolygons.template.events.on("pointerout", (ev) => {
      const id = ev.target.dataItem?.dataContext?.id;
      if (id && selectedCountries.includes(id) && countryMap[id]) {
        const t = countryMap[id].count / maxCount;
        ev.target.set("fillOpacity", 0.4 + t * 0.55);
        ev.target.set("strokeWidth", 0.4);
      }
    });

    const tooltip = am5.Tooltip.new(root, {
      getFillFromSprite: false,
      getStrokeFromSprite: false,
      autoTextColor: false,
      pointerOrientation: "vertical",
    });
    tooltip.get("background").setAll({
      fill: am5.color(0x000000),
      fillOpacity: 0.95,
      stroke: am5.color(0xffffff),
      strokeOpacity: 0.15,
      strokeWidth: 1,
      cornerRadius: 6,
      shadowColor: am5.color(0x000000),
      shadowBlur: 16,
      shadowOffsetY: 4,
      shadowOpacity: 0.5,
    });
    tooltip.label.setAll({
      fill: am5.color(0xffffff),
      fontSize: 12,
      fontFamily: "inherit",
      paddingTop: 2,
      paddingBottom: 2,
      paddingLeft: 4,
      paddingRight: 4,
    });

    polygonSeries.mapPolygons.template.set("tooltip", tooltip);
    polygonSeries.mapPolygons.template.adapters.add(
      "tooltipText",
      (text, target) => {
        const dataContext = target.dataItem?.dataContext;
        if (!dataContext) return "";
        const cData = countryMap[dataContext.id] || (isAllHighlighted && worldwideEntry ? { ...worldwideEntry, name: dataContext.name || dataContext.id } : null);
        if (!cData) return `[bold fontSize:11px #ffffff]{name}[/]`;
        return (
          `[bold fontSize:12px #ffffff]${cData.name}[/]\n` +
          `[fontSize:11px #a0a0a0]Ads Count[/] [bold fontSize:12px #ffffff]${cData.count.toLocaleString()}[/]`
        );
      },
    );

    // Push explicit fill data per ISO so amCharts applies colors natively after geodata loads
    const mapData = [];
    for (const [iso, entry] of Object.entries(countryMap)) {
      // Only push real ISO codes (2 letters), not region IDs like DACH
      if (iso.length !== 2) continue;
      if (deselected.has(entry.id)) continue;
      mapData.push({
        id: iso,
        fill: am5.color(getHeatColor(entry.count).hex),
        fillOpacity: 0.4 + (entry.count / maxCount) * 0.55,
      });
    }
    if (isAllHighlighted && worldwideEntry && !deselected.has('ALL')) {
      // Color every country with worldwide heat
      polygonSeries.mapPolygons.template.set("fill", am5.color(getHeatColor(worldwideEntry.count).hex));
    }
    polygonSeries.data.setAll(mapData);

    chart.set("zoomControl", am5map.ZoomControl.new(root, {}));
    const zoomControl = chart.get("zoomControl");
    zoomControl.minusButton.set("scale", 0.7);
    zoomControl.plusButton.set("scale", 0.7);
    [zoomControl.plusButton, zoomControl.minusButton].forEach((btn) => {
      btn.get("background").setAll({
        fill: am5.color(isLight ? 0xf0f1f5 : 0x1a1a1e),
        stroke: am5.color(isLight ? 0xd0d5dd : 0xffffff),
        strokeOpacity: isLight ? 0.5 : 0.1,
        cornerRadius: 4,
      });
      btn.get("background").states.create("hover", {
        fill: am5.color(isLight ? 0xe0e2e8 : 0x2a2a30),
      });
      // The +/- glyph defaults to a light stroke that's invisible on the
      // light button in light mode. Set it to slate-600 in light, white in
      // dark, so the marker is always readable.
      const icon = btn.get("icon");
      if (icon) {
        icon.setAll({
          stroke: am5.color(isLight ? 0x475569 : 0xffffff),
          strokeOpacity: 1,
        });
      }
    });

    if (isGlobe) {
      chart.animate({ key: "rotationX", from: 0, to: -80, duration: 1500 });
      chart.animate({ key: "rotationY", from: 0, to: -20, duration: 1500 });
    }

    return () => root.dispose();
  }, [level, viewMode, selectedCountries, countryMap, maxCount, mapId, theme, noData, countryData, deselected]);

  return (
    <div className="px-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-wider text-white/90">
          <Globe size={16} className="opacity-60" />
          Country Reach
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`text-[14px] font-bold tracking-wider ${viewMode === "map" ? (isLight ? "text-gray-800" : "text-white/90") : isLight ? "text-gray-400" : "text-white/25"}`}
            >
              Map
            </span>
            <button
              onClick={() =>
                setViewMode((v) => (v === "map" ? "globe" : "map"))
              }
              className={`relative w-9 h-5 rounded-full transition-colors ${viewMode === "globe" ? "bg-[#3762c1]/40" : isLight ? "bg-gray-300" : "bg-white/10"}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${viewMode === "globe" ? "left-[16px]" : "left-0.5"}`}
              />
            </button>
            <span
              className={`text-[14px] font-bold tracking-wider ${viewMode === "globe" ? (isLight ? "text-gray-800" : "text-white/90") : isLight ? "text-gray-400" : "text-white/25"}`}
            >
              Globe
            </span>
          </div>

          <div className={level === 'advertiser' ? 'block' : 'hidden'}>
            <DateRangePicker
              key={level}
              availableYears={availableYears || []}
              onApply={handleDateRangeApply}
              isLight={isLight}
            />
          </div>

          {!hideToggle && (
            <div
              className={`flex p-0.5 rounded-lg ${isLight ? "bg-gray-100 border border-gray-200" : "bg-black/40 border border-white/5"}`}
            >
              <button
                onClick={() => { setLevel("ad"); setFilteredCountryData(null); }}
                className={`px-3 py-1 rounded-md text-[12px] font-bold tracking-wider transition-all ${level === "ad" ? "bg-[#3762c1]/15 text-white/90 border border-[#3759a3]/20" : "text-[#9f9f9f] hover:text-white/70 border border-transparent"}`}
              >
                AD LEVEL
              </button>
              <button
                onClick={() => { setLevel("advertiser"); setFilteredCountryData(null); }}
                className={`px-3 py-1 rounded-md text-[12px] font-bold tracking-wider transition-all ${level === "advertiser" ? "bg-[#3762c1]/15 text-white/90 border border-[#3759a3]/20" : "text-[#9f9f9f] hover:text-white/70 border border-transparent"}`}
              >
                ADVERTISER LEVEL
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,280px] gap-4">
          <div
            className={`rounded-xl overflow-hidden relative ${isLight ? "bg-white shadow-sm border border-gray-200" : "bg-white/[0.02] border border-white/5"}`}
          >
            <div id={mapId} className="w-full" style={{ aspectRatio: "4/3" }} />
            <div className="absolute left-3 top-3 bottom-3 flex flex-col items-center gap-1">
              <span className="text-[8px] font-bold text-orange-400/70 uppercase">
                High
              </span>
              <div
                className="flex-1 w-1.5 rounded-full overflow-hidden"
                style={{
                  background:
                    "linear-gradient(to bottom, #f97316, #c2410c, #7c2d12, #1e1e22)",
                }}
              />
              <span
                className={`text-[8px] font-bold uppercase ${isLight ? "text-gray-400" : "text-white/20"}`}
              >
                Low
              </span>
            </div>
          </div>

          {/* relative wrapper has no intrinsic height (its content is absolutely
              positioned on lg), so the grid row height is driven by the map's
              aspect ratio. The list then fills that height and scrolls when the
              country list is longer than the map. */}
          <div className="relative lg:h-auto">
          <div
            className={`rounded-xl overflow-hidden flex flex-col lg:absolute lg:inset-0 ${isLight ? "bg-white shadow-sm border border-gray-200" : "bg-white/[0.02] border border-white/5"}`}
          >
            <div
              className={`px-3 py-2 border-b flex items-center gap-2 group focus-within:text-[#6b99ff] transition-colors ${isLight ? "border-gray-200 text-gray-400" : "border-white/5 text-white/30"}`}
            >
              <Search size={13} />
              <input
                placeholder="Search countries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`bg-transparent border-none outline-none text-[14px] w-full ${isLight ? "text-gray-600 placeholder:text-gray-400" : "text-white/60 placeholder:text-white/20"}`}
              />
            </div>

            <div
              className={`flex-1 overflow-y-auto scrollbar-hide divide-y ${isLight ? "divide-gray-200/50" : "divide-white/5"}`}
            >
              {noData || filteredCountries.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className={`text-xs ${isLight ? "text-gray-400" : "text-white/30"}`}>
                    {isFiltering ? 'Fetching reach data...' : noData ? 'No data found for this range' : 'No data found'}
                  </span>
                </div>
              ) : (
                filteredCountries.map((c) => {
                  const isSelected = !deselected.has(c.id);
                  const heatCss = getHeatColor(c.count).css;
                  return (
                    <div
                      key={c.id}
                      onClick={() => handleToggleCountry(c.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all ${isLight ? "hover:bg-gray-50" : "hover:bg-white/[0.03]"}`}
                    >
                      {isSelected ? (
                        <div
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: heatCss }}
                        />
                      ) : (
                        <Circle
                          size={12}
                          className={`shrink-0 ${isLight ? "text-gray-400" : "text-white/30"}`}
                        />
                      )}
                      <span
                        title={c.name}
                        className={`text-[14px] font-medium flex-1 min-w-0 truncate ${isSelected ? (isLight ? "text-gray-700" : "text-white/90") : isLight ? "text-gray-400" : "text-white/90"}`}
                      >
                        {c.name}
                      </span>
                      {level === "advertiser" && (
                        <div className="flex items-center gap-2 shrink-0">
                          <div
                            className={`w-16 h-1 rounded-full overflow-hidden ${isLight ? "bg-gray-200" : "bg-white/[0.04]"}`}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${(c.count / maxCount) * 100}%`,
                                backgroundColor: isSelected
                                  ? heatCss
                                  : isLight
                                    ? "rgba(0,0,0,0.1)"
                                    : "rgba(255,255,255,0.1)",
                              }}
                            />
                          </div>
                          <span
                            className="text-[14px] font-bold tabular-nums"
                            style={{
                              color: isSelected
                                ? heatCss
                                : isLight
                                  ? "rgba(0,0,0,0.2)"
                                  : "rgba(255,255,255,0.2)",
                            }}
                          >
                            {c.count}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div
              className={`px-3 py-2 border-t flex items-center justify-between ${isLight ? "border-gray-200" : "border-white/5"}`}
            >
              <span
                className={`text-[14px] ${isLight ? "text-gray-400" : "text-white/30"}`}
              >
                {selectedCountries.length} regions selected
              </span>
              <span className="text-[14px] font-bold text-[#6b99ff]">
                {countryData.length} total
              </span>
            </div>
          </div>
          </div>
        </div>
    </div>
  );
};

export default CountryAnalytics;
