import { Heart, Zap, Copy, Users, Info } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';

const AudienceSection = ({ interests = [], behaviours = [], confidenceScore = null, loading = false }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const interestList = Array.isArray(interests) ? interests : (interests ? [interests] : []);
  const behaviourList = Array.isArray(behaviours) ? behaviours : (behaviours ? [behaviours] : []);

  const audience = { interests: interestList, behaviour: behaviourList };
  const hasData = interestList.length > 0 || behaviourList.length > 0;

  // confidence_score may arrive as a 0–100 percentage (get-data API) or a 0–1
  // fraction (older cached docs). Normalise both to a whole-number percentage.
  const confNum = Number(confidenceScore);
  const confidencePct = Number.isFinite(confNum) && confNum > 0
    ? Math.round(confNum <= 1 ? confNum * 100 : confNum)
    : null;

  const categories = [
    { key: 'interests', label: 'INTERESTS', icon: Heart, color: 'pink' },
    { key: 'behaviour', label: 'BEHAVIOUR', icon: Zap, color: 'indigo' },
  ];

  // Filter to only show categories that have data
  const visibleCategories = categories.filter(({ key }) => audience[key].length > 0);

  // Hide entirely only when we're done loading and there's nothing to show.
  if (!loading && !hasData) return null;

  return (
    <div className="px-6">
      <h3 className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? 'text-gray-800' : 'text-white/90'}`}>
        <Users size={16} className="opacity-60" />Target Audience
        {confidencePct != null && (
          <span className="relative group/conf inline-flex items-center">
            <Info
              size={15}
              className={`cursor-help transition-opacity opacity-70 hover:opacity-100 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}
            />
            <span
              className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-60 px-3 py-2 rounded-lg text-[11px] font-medium normal-case tracking-normal leading-snug text-center shadow-xl border opacity-0 group-hover/conf:opacity-100 pointer-events-none transition-opacity z-50 ${
                isLight ? 'bg-gray-900 text-white border-gray-700' : 'bg-[#1a1a1a] text-white/90 border-white/10'
              }`}
            >
              Based on analytics, the estimated targeting confidence score is {confidencePct}%.
            </span>
          </span>
        )}
      </h3>
      {loading ? (
        <div className={`rounded-xl border py-12 flex items-center justify-center ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/[0.02] border-white/5'}`}>
          <span className={`text-sm ${isLight ? 'text-gray-400' : 'text-white/30'}`}>Loading...</span>
        </div>
      ) : (
        <div className={`rounded-xl overflow-hidden border ${isLight ? 'bg-gray-50/50 border-gray-200 shadow-sm' : 'bg-white/[0.02] border border-white/5'}`}>
          {visibleCategories.map(({ key, label, icon: Icon, color }, idx) => (
            <div key={key} className={`flex gap-3 px-3.5 py-2.5 transition-all group ${idx < visibleCategories.length - 1 ? (isLight ? 'border-b border-gray-200' : 'border-b border-white/5') : ''} ${isLight ? 'bg-white hover:bg-gray-50' : 'hover:bg-white/[0.03]'}`}>
              <div className="flex items-center gap-1.5 shrink-0 w-28">
                 <Icon size={12} className={`text-${color}-400 ${isLight ? 'opacity-90' : 'opacity-60'} group-hover:opacity-100 transition-opacity`} />
                 <span className={`text-[10px] font-bold uppercase ${isLight ? 'text-gray-400' : `text-${color}-400/90`}`}>{label}</span>
              </div>
              <div className="flex-1 min-w-0 flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto modal-scroll pr-1">
                 {audience[key].map((item, i) => (
                   <span key={i} className={`inline-flex items-center gap-1.5 text-[13px] rounded-lg px-2.5 py-1 leading-snug ${isLight ? 'text-gray-800 bg-white border border-gray-200' : 'text-white/80 bg-white/[0.04] border border-white/5'}`}>
                     {item}
                     <button
                       onClick={() => navigator.clipboard.writeText(item)}
                       className={`p-0.5 rounded transition-colors shrink-0 ${isLight ? 'text-gray-400 hover:text-gray-500 hover:bg-gray-100' : 'text-white/20 hover:text-white/60 hover:bg-white/10'}`}
                     >
                       <Copy size={12} />
                     </button>
                   </span>
                 ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AudienceSection;
