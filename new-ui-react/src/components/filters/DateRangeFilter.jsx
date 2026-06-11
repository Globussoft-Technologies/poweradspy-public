import { useState } from "react";
import { Calendar } from "lucide-react";

const DateRangeFilter = ({ label, options, value, onChange }) => {
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const handleCustomDateSelect = () => {
    if (customStartDate && customEndDate) {
      onChange(`${customStartDate} to ${customEndDate}`);
      setShowCustomPicker(false);
    }
  };

  return (
    <div className="px-3 py-2">
      <div>
        <div className="space-y-1">
          {options.map((opt) => {
            const isSelected = value === opt;
            return (
              <button
                key={opt}
                onClick={() => {
                  if (opt === "Custom Date Range") {
                    setShowCustomPicker(true);
                  } else {
                    onChange(opt);
                    setShowCustomPicker(false);
                  }
                }}
                className="w-full flex items-center gap-2.5 py-1 text-[11px] group"
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "border-[#335296]" : "border-theme-text-secondary group-hover:border-theme-text"}`}
                >
                  {isSelected && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#335296]" />
                  )}
                </div>
                <span
                  className={`transition-colors text-left ${isSelected ? "text-[#7899e0] font-medium" : "text-theme-text-muted group-hover:text-theme-text"}`}
                >
                  {opt}
                </span>
              </button>
            );
          })}
        </div>

        {showCustomPicker && (
          <div className="mt-3 p-3 bg-theme-card border border-theme-border rounded-md">
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={12} className="text-theme-text-muted" />
              <span className="text-[10px] text-theme-text-secondary uppercase">
                Custom Range
              </span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[9px] text-theme-text-muted block mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full bg-theme-bg border border-[#333] rounded px-2 py-1 text-[11px] text-theme-text focus:outline-none focus:border-[#3759a3]"
                />
              </div>
              <div>
                <label className="text-[9px] text-theme-text-muted block mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full bg-theme-bg border border-[#333] rounded px-2 py-1 text-[11px] text-theme-text focus:outline-none focus:border-[#3759a3]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCustomDateSelect}
                  className="flex-1 bg-[#335296] text-white text-[10px] py-1 rounded hover:bg-indigo-700 transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={() => setShowCustomPicker(false)}
                  className="flex-1 bg-[#333] text-theme-text-secondary text-[10px] py-1 rounded hover:bg-[#444] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DateRangeFilter;
