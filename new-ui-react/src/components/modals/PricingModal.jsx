import React from "react";
import { X, Check } from "lucide-react";

import fbIcon from "../../assets/fb.png";
import igIcon from "../../assets/ig.png";
import ytIcon from "../../assets/yt.png";
import gIcon from "../../assets/g.png";
import gdnIcon from "../../assets/gdn.png";
import linkedinIcon from "../../assets/linkedin.png";
import nativeIcon from "../../assets/native.png";
import rdIcon from "../../assets/rd.png";
import quoraIcon from "../../assets/quora.png";
import pinterestIcon from "../../assets/pinterest.png";
import tiktokIcon from "../../assets/tiktoklogo.jpg";
import pasLogo from "../../assets/poweradspy-logo.webp";

const SIGNUP_URL = "https://app.poweradspy.com/amember/signup/monthly-plans";

const FEATURES = [
  "Networks",
  "Keyword search",
  "Advertiser search",
  "Domain search",
  "Estimated Ad Budget",
  "Project",
  "Ad Category",
  "Call to action",
  "Country",
  "Ad Type",
  "Gender Wise",
  "Engagement",
  "Audience Age",
  "Advanced Ad Analytics",
  "Ad Position",
  "Ad Running Days",
  "Traffic Source",
  "Popularity and Impressions Sort",
  "Affiliate Network",
  "E-commerce platform",
  "Marketing Platform",
  "Funnel",
  "Data interval search",
  "Favourite and Hidden"
];

const PLANS = [
  {
    name: "Basic",
    price: "$69/Month",
    platforms: ["Facebook", "Instagram", "Google", "YouTube"],
    //         KW     Adv    Dom    Budget Proj   AdCat  CTA   Country AdType Gender Engage AudAge AdvAna AdPos  RunDay Traffic PopSort Affil  Ecom   Mktg   Funnel DateInt Fav
    features: [true,  true,  true,  false, false, true,  true, true,  false, false, true,  false, false, false, false, false,  true,   false, false, false, false, true,  true],
  },
  {
    name: "Standard",
    price: "$129/Month",
    platforms: ["Facebook", "Instagram", "Pinterest", "LinkedIn"],
    //         KW     Adv    Dom    Budget Proj   AdCat  CTA   Country AdType Gender Engage AudAge AdvAna AdPos  RunDay Traffic PopSort Affil  Ecom   Mktg   Funnel DateInt Fav
    features: [true,  true,  true,  false, false, true,  true, true,  true,  true,  true,  true,  true,  true,  true,  false,  true,   false, false, false, false, true,  true],
  },
  {
    name: "Premium",
    price: "$179/Month",
    platforms: ["Facebook", "Instagram", "YouTube", "Pinterest", "LinkedIn", "TikTok"],
    //         KW     Adv    Dom    Budget Proj   AdCat  CTA   Country AdType Gender Engage AudAge AdvAna AdPos  RunDay Traffic PopSort Affil  Ecom   Mktg   Funnel DateInt Fav
    features: [true,  true,  true,  false, false, true,  true, true,  true,  true,  true,  true,  true,  true,  true,  true,   true,   true,  true,  true,  true,  true,  true],
  },
  {
    name: "Platinum",
    price: "$279/Month",
    platforms: ["Facebook", "Instagram", "Google", "YouTube", "Pinterest", "LinkedIn", "TikTok"],
    features: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    name: "Titanium",
    price: "$349/Month",
    platforms: ["Facebook", "Instagram", "Google", "YouTube", "Native", "Pinterest", "LinkedIn", "TikTok"],
    features: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    name: "Palladium",
    price: "$399/Month",
    platforms: ["Facebook", "Instagram", "Google", "YouTube", "Reddit", "Native", "GDN", "Pinterest", "LinkedIn", "Quora", "TikTok"],
    features: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
  },
];

// Ordered lowest → highest so indexOf() gives the correct comparison baseline.
// Must stay in sync with the PLANS array order above.
const PLAN_ORDER = ['Basic', 'Standard', 'Premium', 'Platinum', 'Titanium', 'Palladium'];

const PLATFORM_COLORS = {
  Facebook: "#1877f2",
  Instagram: "#e1306c",
  YouTube: "#ff0000",
  Google: "#4285f4",
  Pinterest: "#e60023",
  LinkedIn: "#0077b5",
  Native: "#6c757d",
  GDN: "#fbbc04",
  Reddit: "#ff4500",
  Quora: "#b92b27",
  TikTok: "#010101",
};

const PLATFORM_ICONS = {
  Facebook: fbIcon,
  Instagram: igIcon,
  YouTube: ytIcon,
  Google: gIcon,
  Pinterest: pinterestIcon,
  LinkedIn: linkedinIcon,
  Native: nativeIcon,
  GDN: gdnIcon,
  Reddit: rdIcon,
  Quora: quoraIcon,
  TikTok: tiktokIcon,
};

const PricingModal = ({ isOpen, onClose, currentPlanTier }) => {
  if (!isOpen) return null;

  // currentIndex is -1 when tier is null/unknown → all plans shown (safe fallback).
  const currentIndex = currentPlanTier ? PLAN_ORDER.indexOf(currentPlanTier) : -1;
  const visiblePlans = currentIndex >= 0 ? PLANS.filter((_, i) => i > currentIndex) : PLANS;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl lg:scale-75 2xl:scale-100 bg-theme-surface border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[95vh]">
        {/* Header */}
        <div className="relative z-50 flex justify-between items-center px-6 py-4 border-b border-white/10 bg-theme-surface">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-[#6b99ff] to-[#3762c1] bg-clip-text text-transparent">
            Choose Your Plan
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-theme-text-muted hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body — scrollable table */}
        <div className="overflow-x-auto overflow-y-auto pr-6 pb-4 custom-scrollbar">
          <div className="flex min-w-[900px] mb-4">
            {/* Left column — feature labels */}
            <div className="w-[180px] shrink-0 sticky left-0 bg-theme-surface z-40 border-r border-white/10 flex flex-col pb-14">
              {/* Sticky Top-Left Corner (Logo + Networks label) */}
              <div className="sticky -top-[1px] z-40 bg-theme-surface pt-[20px]">
                <div className="flex items-start px-4 mb-[34px] w-full justify-center">
                  <img
                    src={pasLogo}
                    alt="PowerAdSpy Logo"
                    className="h-30 w-30 mt-5 object-contain opacity-90"
                  />
                </div>
                <div className="h-10 mb-[21px] flex items-center text-theme-text-secondary text-[12px] font-medium px-2 pl-8">
                  Networks
                </div>
              </div>

              {/* Feature labels */}
              {FEATURES.slice(1).map((f) => (
                <div
                  key={f}
                  className="flex items-center text-theme-text-secondary text-[12px] font-medium px-2 pl-8 h-8"
                >
                  {f}
                </div>
              ))}
            </div>

            {/* Plan columns */}
            <div className="flex flex-1 pb-4">
              {visiblePlans.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-theme-text-secondary text-sm py-10">
                  You are already on the highest plan.
                </div>
              ) : visiblePlans.map((plan, index) => (
                <div
                  key={plan.name}
                  className={`w-[160px] shrink-0 flex flex-col items-center ${index !== visiblePlans.length - 1 ? "border-r border-theme-border" : ""}`}
                >
                  {/* Sticky Header Row (Name, Price, Networks) */}
                  <div className="sticky -top-[1px] z-30 bg-theme-surface w-full pt-[20px]">
                    {/* Plan name */}
                    <div className="h-10 flex items-end justify-center font-bold text-white text-[13px] tracking-wide uppercase">
                      {plan.name}
                    </div>

                    {/* Price — amount on one line, /Month smaller below */}
                    <div className="flex flex-col items-center justify-center mb-4 mt-1">
                      <span className="text-[#6b99ff] font-bold text-[20px] leading-tight">
                        {plan.price.split("/")[0]}
                      </span>
                      <span className="text-[#6b99ff] text-[11px] font-medium opacity-80">
                        /Month
                      </span>
                    </div>

                    {/* Networks — min-h handles multi-row wrapping */}
                    <div className="min-h-[48px] mb-2 flex items-center justify-center gap-1.5 flex-wrap px-2">
                      {plan.platforms.map((p) => (
                        <img
                          key={p}
                          title={p}
                          src={PLATFORM_ICONS[p]}
                          alt={p}
                          className={`w-4 h-4 object-contain rounded-sm ${p === "TikTok" ? "bg-white p-[1px]" : ""}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Feature status */}
                  {FEATURES.slice(1).map((f, idx) => {
                    const enabled = plan.features[idx];
                    return (
                      <div
                        key={f}
                        className="h-8 flex items-center justify-center w-full hover:bg-white/[0.02] transition-colors"
                      >
                        {enabled ? (
                          <Check
                            size={16}
                            className="text-emerald-400 drop-shadow-md"
                            strokeWidth={3}
                          />
                        ) : (
                          <X
                            size={14}
                            className="text-rose-500/70"
                            strokeWidth={2.5}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* Upgrade button */}
                  <div className="h-14 mt-2 flex items-center justify-center">
                    <a
                      href={SIGNUP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <button className="bg-gradient-to-r from-[#3762c1] to-[#335296] hover:from-[#4374e0] hover:to-[#3e64b8] text-white rounded-full text-[12px] px-6 py-2 font-semibold shadow-lg shadow-blue-900/20 transition-all active:scale-95 border border-[#4a7eff]/30">
                        Upgrade
                      </button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PricingModal;
