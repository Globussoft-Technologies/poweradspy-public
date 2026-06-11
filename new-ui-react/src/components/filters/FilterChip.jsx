import React from "react";
import { X } from "lucide-react";

const FilterChip = ({ label, onRemove }) => (
  <span className="flex items-center gap-1 whitespace-nowrap px-2 py-0.5 bg-[#3762c1]/10 border border-[#3759a3]/20 rounded-full text-[10px] 2xl:text-xs font-semibold text-[#6b99ff]">
    {label}
    <button
      onClick={onRemove}
      className="hover:text-red-400 transition-colors ml-0.5"
    >
      <X size={9} />
    </button>
  </span>
);

export default FilterChip;
