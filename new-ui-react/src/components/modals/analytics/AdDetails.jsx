import React from "react";
import { Calendar, Activity, Globe, Monitor, MapPin, Hash } from "lucide-react";

const AdDetails = () => {
  const details = [
    {
      label: "First Seen",
      value: "Oct 12, 2023",
      icon: Calendar,
      color: "text-blue-400",
    },
    {
      label: "Last Seen",
      value: "Mar 20, 2024",
      icon: Activity,
      color: "text-emerald-400",
    },
    {
      label: "Post Date",
      value: "Oct 10, 2023",
      icon: Hash,
      color: "text-purple-400",
    },
    {
      label: "Ad Status",
      value: "Active",
      icon: Activity,
      color: "text-emerald-400",
    },
    {
      label: "Ad Language",
      value: "English",
      icon: Globe,
      color: "text-[#6b99ff]",
    },
    {
      label: "Domain Reg. Date",
      value: "Jan 15, 2018",
      icon: Calendar,
      color: "text-orange-400",
    },
    {
      label: "Ad Type",
      value: "Video / Carousel",
      icon: Monitor,
      color: "text-pink-400",
    },
    {
      label: "Ad Position",
      value: "Feed / Stories",
      icon: MapPin,
      color: "text-yellow-400",
    },
  ];

  return (
    <div className="p-6 pt-0">
      <div className="border border-theme-border rounded-2xl p-6 hover:bg-theme-surface transition-all">
        <h3 className="text-[10px] font-bold text-theme-text-muted uppercase tracking-[0.2em] mb-6">
          Ad details
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {details.map((item, i) => (
            <div key={i} className="space-y-2 group">
              <div className="flex items-center gap-2">
                <item.icon
                  size={12}
                  className={`${item.color} opacity-60 group-hover:opacity-100 transition-opacity`}
                />
                <span className="text-[10px] text-theme-text-muted uppercase tracking-wider">
                  {item.label}
                </span>
              </div>
              <div className="text-[13px] font-semibold text-theme-text/80 pl-5">
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-theme-border">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-2">
              <Globe size={12} className="text-theme-text-muted" />
              <span className="text-[10px] text-theme-text-muted uppercase tracking-wider">
                Source
              </span>
            </div>
            <div className="flex-1 bg-theme-surface border border-theme-border rounded-xl px-4 py-2.5">
              <span className="text-[11px] text-[#6b99ff] font-medium tracking-wide">
                Facebook Ad Library / Meta Marketing API
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdDetails;
