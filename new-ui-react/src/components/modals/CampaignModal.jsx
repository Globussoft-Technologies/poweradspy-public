import React from "react";
import { BrainCircuit, X, Loader2 } from "lucide-react";

const CampaignModal = ({ isOpen, strategy, isGenerating, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-theme-card border border-theme-border w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="text-[#6b99ff]" size={16} />
            <h3 className="font-bold text-sm text-theme-text-secondary">
              Campaign Strategy Genie
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-theme-text/[0.06] rounded-lg transition-colors text-theme-text-muted hover:text-theme-text"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {isGenerating ? (
            <div className="py-16 flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-[#3759a3]" size={36} />
              <p className="font-bold text-xs text-theme-text-secondary">
                Building 30-Day Masterplan...
              </p>
            </div>
          ) : (
            <div className="text-theme-text-secondary text-sm whitespace-pre-line leading-loose">
              {strategy}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignModal;
