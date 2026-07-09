import { useState } from "react";

const TRUNC = 6;

export default function PlatformBadgesRow({ allLogos }) {
  const [expanded, setExpanded] = useState(false);

  if (!allLogos || allLogos.length === 0) return null;

  const toggle = (e) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const isSingle = allLogos.length === 1;

  if (isSingle) {
    const logo = allLogos[0];
    return (
      <div className="flex items-center min-w-0">
        <div className="relative inline-flex items-center gap-1.5 shrink-0 pl-0.5 pr-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/10">
          <span className="inline-flex items-center justify-center h-5 w-5 rounded-md bg-white/95 shrink-0 overflow-hidden">
            <img
              src={logo.src}
              alt={logo.title}
              className="h-4 w-4 object-contain"
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          </span>
          <span className="text-[11px] font-medium text-zinc-200 leading-none whitespace-nowrap">
            {logo.title}
          </span>
        </div>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden scrollbar-hide w-full max-w-full -mx-1 px-1">
        {allLogos.map((logo) => (
          <button
            key={logo.key}
            type="button"
            onClick={toggle}
            className="relative inline-flex items-center gap-1.5 shrink-0 pl-0.5 pr-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-colors"
          >
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-md bg-white/95 shrink-0 overflow-hidden">
              <img
                src={logo.src}
                alt={logo.title}
                className="h-4 w-4 object-contain"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            </span>
            <span className="text-[11px] font-medium text-zinc-200 leading-none whitespace-nowrap">
              {logo.title}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center min-w-0">
      {allLogos.map((logo, i) => {
        const displayName =
          logo.title.length <= TRUNC
            ? logo.title
            : `${logo.title.substring(0, TRUNC)}…`;
        return (
          <button
            key={logo.key}
            type="button"
            onClick={toggle}
            className="relative inline-flex items-center gap-1.5 shrink-0 pl-0.5 pr-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-colors"
            style={{
              marginLeft: i === 0 ? 0 : -10,
              zIndex: allLogos.length - i,
            }}
          >
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-md bg-white/95 shrink-0 overflow-hidden">
              <img
                src={logo.src}
                alt={logo.title}
                className="h-4 w-4 object-contain"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            </span>
            <span className="text-[11px] font-medium text-zinc-200 leading-none whitespace-nowrap">
              {displayName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
