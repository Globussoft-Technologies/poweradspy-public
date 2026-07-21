import React, { useEffect, useState } from "react";
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
import { fetchPlansCatalog } from "../../services/api";

const SIGNUP_URL = import.meta.env.VITE_AMEMBER_PLANS_SIGNUP_URL || "https://app-dev.poweradspy.com/amember/signup/monthly-plans";

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

// currentPlanTier is a string from planAccess.planTier (e.g. "Basic", "Standard (2026)").
// The plans/features shown are fetched from the backend (GET /api/v1/auth/plans-catalog),
// controlled by config.pricing.activePlanGeneration — see docs/PLAN_ACCESS.md § 2026
// Pricing Restructure. This modal no longer hardcodes any plan/price/feature data.
const PricingModal = ({ isOpen, onClose, currentPlanTier }) => {
  const [catalog, setCatalog] = useState(null); // { features, plans } | null while loading
  const [loadFailed, setLoadFailed] = useState(false);
  // Display only — PRD FR-18. priceAnnual is computed server-side from
  // config.pricing.annualPriceMultiplier (docs/PLAN_ACCESS.md § 2026 Pricing
  // Restructure); there is no billing/checkout engine here to actually charge
  // either period — both link to the same aMember signup page below.
  const [billingPeriod, setBillingPeriod] = useState('monthly');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCatalog(null);
    setLoadFailed(false);
    fetchPlansCatalog().then((data) => {
      if (cancelled) return;
      if (data && Array.isArray(data.plans)) setCatalog(data);
      else setLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const plans = catalog?.plans || [];
  const features = catalog?.features || [];

  // Ordered exactly as the active catalog returns them (lowest → highest tier).
  const planOrder = plans.map((p) => p.tier);
  const currentIndex = currentPlanTier ? planOrder.indexOf(currentPlanTier) : -1;
  // currentIndex === -1 covers two real cases: no tier known yet, OR (post-2026-restructure)
  // an existing subscriber on a legacy tier that isn't part of the currently-active catalog
  // generation — either way, show every available option rather than guessing a ranking.
  const isKnownTier = currentIndex >= 0;
  const visiblePlans = isKnownTier ? plans.filter((_, i) => i > currentIndex) : plans;

  // PRD FR-9: legacy-generation tiers carry grandfathered bonus networks (Basic:
  // Google+YouTube, Standard: LinkedIn+GDN) baked directly into their plan_id's
  // entitlements (docs/PLAN_ACCESS.md § FR-5–FR-9) — upgrading to any current-generation
  // plan replaces those entirely, since entitlements are always looked up fresh by
  // plan_id. There's no in-app "upgrade" confirmation step to attach this disclosure to
  // (upgrading happens on aMember's hosted page via SIGNUP_URL below), so this modal —
  // the last screen we control before that handoff — is where it's disclosed instead.
  const isOnLegacyGenerationTier = ['Basic', 'Standard', 'Premium', 'Platinum', 'Titanium', 'Palladium'].includes(currentPlanTier);
  // currentPlanTier (from resolvePlanTier()) is the raw plan_groups key, e.g. "Basic (2026)" —
  // that suffix exists only to keep the 2026 group from colliding with the identically-named
  // legacy group and is never meant to be user-facing. Show the matching catalog entry's
  // plain `label` instead; falls back to the raw value for an unknown/legacy tier not in
  // the currently-active catalog (label === tier for every legacy entry, so no suffix there).
  const currentPlanLabel = plans.find((p) => p.tier === currentPlanTier)?.label || currentPlanTier;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl lg:scale-75 2xl:scale-100 bg-theme-surface border border-theme-border rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[95vh]">
        {/* Header */}
        <div className="relative z-50 flex justify-between items-center px-6 py-4 border-b border-white/10 bg-theme-surface">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-[#6b99ff] to-[#3762c1] bg-clip-text text-transparent">
              Choose Your Plan
            </h2>
            {currentPlanTier && (
              <p className="text-theme-text-secondary text-[11px] mt-1">
                Current plan: <span className="font-semibold">{currentPlanLabel}</span>
                {isOnLegacyGenerationTier && <span className="text-amber-500"> · legacy benefits end on upgrade</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {catalog && (
              <div className="flex items-center bg-theme-bg border border-theme-border rounded-full p-0.5 text-[11px] font-semibold">
                <button
                  onClick={() => setBillingPeriod('monthly')}
                  className={`px-3 py-1 rounded-full transition-colors ${billingPeriod === 'monthly' ? 'bg-[#3762c1] text-white' : 'text-theme-text-muted hover:text-theme-text'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingPeriod('annual')}
                  className={`px-3 py-1 rounded-full transition-colors ${billingPeriod === 'annual' ? 'bg-[#3762c1] text-white' : 'text-theme-text-muted hover:text-theme-text'}`}
                >
                  Yearly
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 text-theme-text-muted hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body — scrollable table */}
        <div className="overflow-x-auto overflow-y-auto pr-6 pb-4 custom-scrollbar">
          {!catalog && !loadFailed && (
            <div className="flex items-center justify-center text-theme-text-secondary text-sm py-16">
              Loading plans…
            </div>
          )}
          {loadFailed && (
            <div className="flex items-center justify-center text-theme-text-secondary text-sm py-16">
              Couldn't load plan details right now — please try again in a moment.
            </div>
          )}
          {catalog && (
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
              {features.slice(1).map((f) => (
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
                  key={plan.tier}
                  className={`flex-1 min-w-[160px] flex flex-col items-center ${index !== visiblePlans.length - 1 ? "border-r border-theme-border" : ""}`}
                >
                  {/* Sticky Header Row (Name, Price, Networks) */}
                  <div className="sticky -top-[1px] z-30 bg-theme-surface w-full pt-[20px]">
                    {/* Plan name */}
                    <div className="h-10 flex items-end justify-center font-bold text-theme-text text-[13px] tracking-wide uppercase text-center px-1">
                      {plan.label || plan.tier}
                    </div>

                    {/* Price — amount on one line, period smaller below */}
                    <div className="flex flex-col items-center justify-center mb-4 mt-1">
                      <span className="text-[#6b99ff] font-bold text-[20px] leading-tight">
                        {(billingPeriod === 'annual' ? plan.priceAnnual : plan.price).split("/")[0]}
                      </span>
                      <span className="text-[#6b99ff] text-[11px] font-medium opacity-80">
                        {billingPeriod === 'annual' ? '/Year' : '/Month'}
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
                  {features.slice(1).map((f, idx) => {
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
          )}
        </div>
      </div>
    </div>
  );
};

export default PricingModal;
