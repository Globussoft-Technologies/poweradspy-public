import React from "react";
import { Sparkles, X, Loader2 } from "lucide-react";

const AIAnalysisModal = ({ ad, analysis, isAnalyzing, onClose }) => {
  if (!ad) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-theme-card border border-theme-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="text-[#6b99ff]" size={16} />
            <h3 className="font-bold text-sm text-theme-text-secondary">
              AI Strategy Audit
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-theme-text/[0.06] rounded-lg transition-colors text-theme-text-muted hover:text-theme-text"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {isAnalyzing ? (
            <div className="py-12 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-[#3759a3]" size={28} />
              <p className="text-xs text-theme-text-secondary">
                Decoding ad psychology...
              </p>
            </div>
          ) : (
            <div className="text-theme-text-secondary text-sm whitespace-pre-line leading-relaxed">
              {analysis}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIAnalysisModal;
