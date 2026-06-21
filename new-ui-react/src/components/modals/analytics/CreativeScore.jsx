import { Sparkles, MousePointerClick, Zap, TrendingUp } from "lucide-react";
import { useTheme } from "../../../hooks/useTheme";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// AI creative-quality scores (predicted CTR / hook / hold / total, 0-100), written onto
// the ad's ES doc by the hourly Sonnet scorer and surfaced by the ad-detail API.
const CreativeScore = ({ adDetails }) => {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const total = num(adDetails?.creative_total_score);
  if (total === null || Number.isNaN(total)) return null; // unscored ads render nothing

  const ctr = num(adDetails?.creative_predicted_ctr);
  const hook = num(adDetails?.creative_hook_total);
  const hold = num(adDetails?.creative_hold_total);
  const rationale = (adDetails?.creative_score_rationale || "").trim();
  const scoredBy = adDetails?.creative_scored_by || "";
  const scoredAt = adDetails?.creative_scored_at || "";

  const tone = (v) => {
    if (v === null || Number.isNaN(v))
      return { text: isLight ? "text-gray-400" : "text-white/40", bar: isLight ? "bg-gray-300" : "bg-white/20" };
    if (v >= 70) return { text: "text-emerald-400", bar: "bg-emerald-400" };
    if (v >= 45) return { text: "text-amber-400", bar: "bg-amber-400" };
    return { text: "text-rose-400", bar: "bg-rose-400" };
  };

  const Metric = ({ label, value, Icon }) => {
    const t = tone(value);
    const pct = value === null || Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
    return (
      <div className={`rounded-lg p-3 ${isLight ? "bg-white border border-gray-200" : "bg-white/[0.03] border border-white/5"}`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          {Icon && <Icon size={13} className="text-[#9f9f9f] opacity-70 shrink-0" />}
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#9f9f9f]">{label}</span>
        </div>
        <div className={`text-[22px] font-bold leading-none ${t.text}`}>
          {value === null || Number.isNaN(value) ? "—" : value}
          <span className={`text-[12px] font-medium ml-0.5 ${isLight ? "text-gray-400" : "text-white/30"}`}>/100</span>
        </div>
        <div className={`mt-2.5 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-gray-200" : "bg-white/10"}`}>
          <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="px-6">
      <h3
        className={`flex items-center gap-2 text-[18px] font-bold tracking-[0.1em] mb-4 ${isLight ? "text-gray-800" : "text-white/90"}`}
      >
        <Sparkles size={16} className="opacity-60" />
        AI Creative Score
      </h3>
      <div
        className={`rounded-xl border border-l-2 border-l-[#3759a3]/40 p-5 ${isLight ? "bg-gray-50/50 border-gray-200" : "bg-white/[0.02] border-white/5"}`}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Total" value={total} Icon={Sparkles} />
          <Metric label="Pred. CTR" value={ctr} Icon={MousePointerClick} />
          <Metric label="Hook" value={hook} Icon={Zap} />
          <Metric label="Hold" value={hold} Icon={TrendingUp} />
        </div>
        {rationale && (
          <p className={`mt-4 text-[13px] leading-relaxed ${isLight ? "text-gray-600" : "text-white/60"}`}>
            {rationale}
          </p>
        )}
        {(scoredBy || scoredAt) && (
          <div className={`mt-3 text-[11px] ${isLight ? "text-gray-400" : "text-white/30"}`}>
            Scored by {scoredBy || "AI"}
            {scoredAt ? ` · ${new Date(scoredAt).toLocaleDateString()}` : ""}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreativeScore;
