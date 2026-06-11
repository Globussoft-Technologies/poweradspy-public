import { useState, useMemo, useRef } from 'react';
import { PieChart } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';
import DateRangePicker from './DateRangePicker';
import { getAdvertiserInsightsByDateRange } from '../../../services/api';

/**
 * Transform API userData (ad-level or advertiser-level) into chart-friendly format.
 *
 * NOTE: The ad-level backend (getFacebookUserData) has swapped field names:
 *   - response.ageData    → actually contains gender data (male/female)
 *   - response.genderData → actually contains age buckets (age_18_to_24, etc.)
 * The advertiser-level backend (getAdvertiserUserData) uses correct names.
 * We auto-detect by checking which field has age keys vs gender keys.
 */
function hasAgeKeys(obj) {
  return obj && Object.keys(obj).some((k) => k.startsWith("age_"));
}

function transformUserData(raw) {
  if (!raw || Array.isArray(raw) || (!raw.ageData && !raw.genderData && !raw.relationshipData)) return null;

  // Auto-detect: if raw.ageData has age keys, it's correct; otherwise it's swapped
  const isSwapped = raw.ageData && !hasAgeKeys(raw.ageData);
  const ageRaw = isSwapped ? raw.genderData || {} : raw.ageData || {};
  const genderRaw = isSwapped ? raw.ageData || {} : raw.genderData || {};

  // API values are already percentages — display directly
  const ageData = [
    { label: "18-24", value: Number(ageRaw.age_18_to_24) || 0 },
    { label: "25-34", value: Number(ageRaw.age_25_to_34) || 0 },
    { label: "35-44", value: Number(ageRaw.age_35_to_44) || 0 },
    { label: "45-54", value: Number(ageRaw.age_45_to_54) || 0 },
    { label: "55+", value: Number(ageRaw.age_55_to_64) || 0 },
  ];

  const genderData = [
    { label: "Male", value: Number(genderRaw.male) || 0, color: "#60a5fa" },
    { label: "Female", value: Number(genderRaw.female) || 0, color: "#f472b6" },
  ];

  const relRaw = raw.relationshipData || {};
  const relationshipData = [
    { label: "Single", value: Number(relRaw.single) || 0 },
    { label: "Married", value: Number(relRaw.married) || 0 },
    { label: "Other", value: Number(relRaw.others) || 0 },
  ];

  const allZero = [...ageData, ...genderData, ...relationshipData].every(d => !d.value);
  if (allZero) return null;

  return { ageData, genderData, relationshipData };
}

const Demographics = ({ adUserData, advertiserUserData, platform, network = 'facebook', postOwnerId, availableYears }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const hideToggle = ['instagram', 'youtube'].includes((platform || '').toLowerCase());
  const [level, setLevel] = useState('advertiser');
  const [filteredUserData, setFilteredUserData] = useState(null);
  const [isFiltering, setIsFiltering] = useState(false);

  const [genderTooltip, setGenderTooltip] = useState({ visible: false, x: 0, y: 0, hovered: null });
  const donutRef = useRef(null);

  const adTransformed = useMemo(() => transformUserData(adUserData), [adUserData]);
  const advertiserTransformed = useMemo(() => transformUserData(filteredUserData || advertiserUserData), [advertiserUserData, filteredUserData]);

  const handleDateRangeApply = async (range) => {
    if (!range) {
      setFilteredUserData(null);
      return;
    }
    
    setIsFiltering(true);
    try {
      const res = await getAdvertiserInsightsByDateRange({
        post_owner_id: postOwnerId || (advertiserUserData?.post_owner_id),
        from_date: range.fromDate,
        to_date: range.toDate,
        type: 'user',
        network,
      });
      if (res.code === 200) {
        setFilteredUserData(res.data);
      } else {
        setFilteredUserData({}); // Clear to show "No data found"
      }
    } catch (err) {
      console.error('Demographics Date Range Fetch Error:', err);
    } finally {
      setIsFiltering(false);
    }
  };

  const currentData = level === "ad" ? adTransformed : advertiserTransformed;
  const noData = !currentData;

  // Hide section only when BOTH sources have arrived and neither has usable data
  const adLoaded = adUserData !== null;
  const advertiserLoaded = advertiserUserData !== null;
  const bothLoaded = adLoaded && advertiserLoaded;
  if (noData && bothLoaded && !adTransformed && !advertiserTransformed && !isFiltering) return null;

  const ageData = currentData?.ageData || [];
  const genderData = currentData?.genderData || [
    { label: "Male", value: 0, color: "#60a5fa" },
    { label: "Female", value: 0, color: "#f472b6" },
  ];
  const relationshipData = currentData?.relationshipData || [];

  return (
    <div className="px-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-wider text-white/90">
          <PieChart size={16} className="opacity-60" />
          Demographics
        </h3>
        <div className="flex items-center gap-3">
          <div className={level === 'advertiser' ? 'block' : 'hidden'}>
            <DateRangePicker 
              availableYears={availableYears || advertiserUserData?.available_years || []} 
              onApply={handleDateRangeApply} 
              isLight={isLight}
            />
          </div>

          {!hideToggle && (
            <div className={`flex p-0.5 rounded-lg ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-black/40 border border-white/5'}`}>
              <button
                onClick={() => setLevel('ad')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all ${level === 'ad' ? 'bg-indigo-500/15 text-white/90 border border-indigo-500/20' : 'text-[#9f9f9f] hover:text-white/70 border border-transparent'}`}
              >
                AD LEVEL
              </button>
              <button
                onClick={() => setLevel('advertiser')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all ${level === 'advertiser' ? 'bg-indigo-500/15 text-white/90 border border-indigo-500/20' : 'text-[#9f9f9f] hover:text-white/70 border border-transparent'}`}
              >
                ADVERTISER LEVEL
              </button>
            </div>
          )}
        </div>
      </div>

      {noData ? (
        <div className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
          <span className={`text-sm ${isLight ? 'text-gray-400' : 'text-white/30'}`}>
            {isFiltering ? 'Fetching demographics...' : (level === 'ad' ? adUserData : advertiserUserData) === null ? 'Loading...' : 'No data found for this range'}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Age Breakdown */}
          <div
            className={`rounded-xl overflow-hidden ${isLight ? "bg-white shadow-sm border border-gray-200" : "bg-white/[0.02] border border-white/5"}`}
          >
            <div
              className={`px-3.5 py-2 ${isLight ? "border-b border-gray-200" : "border-b border-white/5"}`}
            >
              <span
                className={`text-xs font-semibold uppercase ${isLight ? "text-gray-900" : "text-white/35"}`}
              >
                Age Breakdown
              </span>
            </div>
            <div className="px-3.5 py-3 space-y-2.5">
              {ageData.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span
                      className={`font-medium ${isLight ? "text-gray-500" : "text-white/40"}`}
                    >
                      {item.label}
                    </span>
                    <span
                      className={`font-bold ${isLight ? "text-gray-800" : "text-white/70"}`}
                    >
                      {item.value}{level === 'ad' ? '%' : ''}
                    </span>
                  </div>
                  <div
                    className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-gray-200" : "bg-white/[0.04]"}`}
                  >
                    <div
                      className="h-full bg-[#3762c1]/70 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(item.value, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gender Split */}
          <div
            className={`rounded-xl overflow-hidden ${isLight ? "bg-white shadow-sm border border-gray-200" : "bg-white/[0.02] border border-white/5"}`}
          >
            <div
              className={`px-3.5 py-2 ${isLight ? "border-b border-gray-200" : "border-b border-white/5"}`}
            >
              <span
                className={`text-xs font-semibold uppercase ${isLight ? "text-gray-900" : "text-white/35"}`}
              >
                Gender Split
              </span>
            </div>
            <div className="flex flex-col items-center py-3">
              {(() => {
                const total = genderData[0].value + genderData[1].value;
                const maleRatio = total > 0 ? genderData[0].value / total : 0;
                const femaleRatio = total > 0 ? genderData[1].value / total : 0;
                const circumference = 238.76;
                const dominant = genderData[0].value >= genderData[1].value ? genderData[0] : genderData[1];
                const suffix = level === 'ad' ? '%' : '';
                return (
              <div
                ref={donutRef}
                className="relative w-28 h-28 cursor-pointer"
                onMouseMove={(e) => {
                  const rect = donutRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  // Angle from top (12 o'clock), clockwise
                  let angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) + 90;
                  if (angle < 0) angle += 360;
                  // Male arc starts at 0° and spans maleRatio * 360°
                  const maleDeg = maleRatio * 360;
                  const hovered = angle <= maleDeg ? 'male' : 'female';
                  setGenderTooltip({ visible: true, x: e.clientX, y: e.clientY, hovered });
                }}
                onMouseLeave={() => setGenderTooltip({ visible: false, x: 0, y: 0, hovered: null })}
              >
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="transparent"
                    stroke={isLight ? "#E5E7EB" : "rgba(255,255,255,0.03)"}
                    strokeWidth="10"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="transparent"
                    stroke="#60a5fa"
                    strokeWidth="10"
                    strokeDasharray={`${maleRatio * circumference} ${circumference}`}
                    strokeLinecap="round"
                    style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", transition: "all 0.7s" }}
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="transparent"
                    stroke="#f472b6"
                    strokeWidth="10"
                    strokeDasharray={`${femaleRatio * circumference} ${circumference}`}
                    strokeDashoffset={`-${maleRatio * circumference}`}
                    strokeLinecap="round"
                    style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", transition: "all 0.7s" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-[11px] font-semibold ${isLight ? "text-gray-500" : "text-white/50"}`}>
                    {dominant.label}
                  </span>
                  <span className={`text-[13px] font-bold ${isLight ? "text-gray-800" : "text-white/80"}`}>
                    {dominant.value}{suffix}
                  </span>
                </div>
              </div>
                );
              })()}
              <div className="flex items-center gap-4 mt-2.5">
                {genderData.map((g) => (
                  <div key={g.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className={`text-[11px] font-medium ${isLight ? "text-gray-500" : "text-white/50"}`}>
                      {g.label} {g.value}{level === 'ad' ? '%' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Relationship */}
          <div
            className={`rounded-xl overflow-hidden ${isLight ? "bg-white shadow-sm border border-gray-200" : "bg-white/[0.02] border border-white/5"}`}
          >
            <div
              className={`px-3.5 py-2 ${isLight ? "border-b border-gray-200" : "border-b border-white/5"}`}
            >
              <span
                className={`text-xs font-semibold uppercase ${isLight ? "text-gray-900" : "text-white/35"}`}
              >
                Relationship
              </span>
            </div>
            <div className={`flex flex-col divide-y ${isLight ? "divide-gray-100" : "divide-white/5"}`}>
              {relationshipData.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-3.5 py-2.5 transition-colors ${isLight ? "hover:bg-gray-50" : "hover:bg-white/[0.03]"}`}
                >
                  <span className={`text-[11px] uppercase font-semibold ${isLight ? "text-gray-500" : "text-white/40"}`}>
                    {item.label}
                  </span>
                  <span className={`text-[13px] font-bold ${isLight ? "text-gray-800" : "text-white/80"}`}>
                    {item.value}{level === 'ad' ? '%' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Gender tooltip — fixed so it escapes overflow-hidden parents */}
      {genderTooltip.visible && (
        <div
          className="fixed z-[9999] flex flex-col gap-1.5 px-3 py-2 rounded-lg text-[11px] whitespace-nowrap pointer-events-none"
          style={{
            left: genderTooltip.x + 14,
            top: genderTooltip.y - 14,
            backgroundColor: '#1a1a1e',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
        >
          {(() => {
            const all = [{ key: 'male', label: 'Male', color: '#60a5fa', value: genderData[0].value },
                         { key: 'female', label: 'Female', color: '#f472b6', value: genderData[1].value }];
            const active = all.find(g => g.key === genderTooltip.hovered) || all[0];
            return (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: active.color }} />
                <span className="text-white font-bold">{active.label}</span>
                <span className="ml-auto pl-4 font-bold text-white">{active.value}{level === 'ad' ? '%' : ''}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default Demographics;
