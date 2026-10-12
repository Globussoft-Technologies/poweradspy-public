import React from "react";
import { X } from "lucide-react";

// pwa: installed phone app — a compact 28px chip with a 20px round remove
// button (the 9px ✕ was too small to tap); the website chip is unchanged.
const FilterChip = ({ label, onRemove }) => (
  <span className="flex items-center gap-1 whitespace-nowrap px-2 py-0.5 bg-[#3762c1]/10 border border-[#3759a3]/20 rounded-full text-[10px] 2xl:text-xs font-semibold text-[#6b99ff] pwa:h-7 pwa:gap-1 pwa:py-0 pwa:pl-2.5 pwa:pr-1 pwa:text-[11px]">
    {label}
    <button
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="hover:text-red-400 transition-colors ml-0.5 pwa:ml-0 pwa:flex pwa:h-5 pwa:w-5 pwa:items-center pwa:justify-center pwa:rounded-full pwa:bg-[#3762c1]/15 pwa:active:scale-90 pwa:[&>svg]:h-2.5 pwa:[&>svg]:w-2.5"
    >
      <X size={9} />
    </button>
  </span>
);

export default FilterChip;
