import { Heart, Zap, Copy, Users } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';

const AudienceSection = ({ adDetails }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const interests = adDetails?.interests
    ? (Array.isArray(adDetails.interests) ? adDetails.interests : [adDetails.interests])
    : [];
  const behaviour = adDetails?.behaviours
    ? (Array.isArray(adDetails.behaviours) ? adDetails.behaviours : [adDetails.behaviours])
    : [];

  const audience = { interests, behaviour };
  const hasData = interests.length > 0 || behaviour.length > 0;

  const categories = [
    { key: 'interests', label: 'INTERESTS', icon: Heart, color: 'pink' },
    { key: 'behaviour', label: 'BEHAVIOUR', icon: Zap, color: 'indigo' },
  ];

  // Filter to only show categories that have data
  const visibleCategories = categories.filter(({ key }) => audience[key].length > 0);

  if (adDetails !== null && !hasData) return null;

  return (
    <div className="px-6">
      <h3 className="flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 text-white/90">
        <Users size={16} className="opacity-60" />Target Audience
      </h3>
      {adDetails === null ? (
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
              <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
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
