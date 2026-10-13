import React, { useState } from 'react';
import { Bell, X, Check } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';

/**
 * NotificationPermissionPrompt — Banner requesting browser notification permission.
 * Shows once per session (stored in component state).
 */
// `suppress`: App passes true in the installed phone app while onboarding is
// open, so the two popups never stack on top of each other.
const NotificationPermissionPrompt = ({ suppress = false }) => {
  const { isSupported, permission, requestPermissionAndRegister, error } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  // Don't show if:
  // - Browser doesn't support notifications
  // - User already granted/denied permission
  // - User dismissed the prompt this session
  // - Onboarding is open in the installed app (see `suppress`)
  if (!isSupported || permission !== 'default' || dismissed || suppress) {
    return null;
  }

  const handleEnable = async () => {
    setIsRequesting(true);
    const success = await requestPermissionAndRegister();
    setIsRequesting(false);

    if (success) {
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    // pwa: installed phone app — one slim row (bell · title · Enable · ✕)
    // instead of the big glowing card; ✕ does what "Later" does.
    <div className="fixed bottom-4 right-4 z-50 w-[450px] pwa:left-3 pwa:right-3 pwa:w-auto pwa:bottom-[calc(68px+env(safe-area-inset-bottom))] animate-[slideUp_0.4s_ease-out]">
      <div className="bg-[#eef4fb] border-2 border-[#185FA5] rounded-xl shadow-[0_0_0_2px_rgba(24,95,165,0.12),0_0_10px_1px_rgba(24,95,165,0.4),0_4px_16px_rgba(0,0,0,0.1)] p-4 relative overflow-hidden pwa:border pwa:border-theme-border pwa:bg-theme-card pwa:rounded-2xl pwa:px-3 pwa:py-2.5 pwa:shadow-[0_8px_24px_rgba(15,23,42,0.18)]">
        {/* Decorative blur background */}
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#185FA5]/5 rounded-full blur-3xl pwa:hidden"></div>
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-[#185FA5]/5 rounded-full blur-3xl pwa:hidden"></div>

        {/* Content wrapper */}
        <div className="relative z-10 pwa:flex pwa:flex-wrap pwa:items-center pwa:gap-2.5">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            aria-label="Close"
            className="absolute top-2 right-2 text-[#185FA5]/50 hover:bg-[#185FA5]/10 hover:text-[#185FA5] p-1 rounded-lg transition-all pwa:static pwa:order-last pwa:flex pwa:h-8 pwa:w-8 pwa:items-center pwa:justify-center pwa:rounded-full pwa:text-theme-text-muted"
            disabled={isRequesting}
          >
            <X size={16} />
          </button>

          {/* Icon and Header */}
          <div className="flex items-start gap-2 mb-2 pr-6 pwa:mb-0 pwa:min-w-0 pwa:flex-1 pwa:items-center pwa:pr-0">
            <div className="w-8 h-8 rounded-lg bg-[#185FA5]/10 flex items-center justify-center shrink-0 mt-0.5 pwa:mt-0 pwa:rounded-full">
              <Bell size={18} className="text-[#185FA5]" />
            </div>
            <h3 className="text-base font-bold text-[#185FA5] pwa:text-[14px] pwa:font-semibold pwa:leading-tight pwa:text-theme-text">
              Get Instant Notifications
            </h3>
          </div>

          {/* Description */}
          <p className="text-slate-600 text-xs leading-tight mb-3 font-medium ml-10 pwa:hidden">
            Enable browser notifications to receive instant alerts when new ads are found for your keywords.
          </p>

          {/* Error message */}
          {error && (
            <p className="text-xs text-red-700 mb-3 bg-red-100 px-2 py-1 rounded pwa:order-last pwa:mb-0 pwa:basis-full">
              ⚠️ {error}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 w-full pwa:w-auto pwa:shrink-0">
            <button
              onClick={handleEnable}
              disabled={isRequesting}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-[#185FA5] text-white hover:bg-[#134a80] disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold text-xs transition-all shadow-lg pwa:flex-none pwa:h-9 pwa:rounded-full pwa:px-4 pwa:text-[13px] pwa:shadow-none"
            >
              {isRequesting ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Enable
                </>
              )}
            </button>
            <button
              onClick={handleDismiss}
              disabled={isRequesting}
              className="flex-1 px-3 py-2 bg-white text-[#185FA5] border border-[#185FA5]/30 font-bold hover:bg-[#185FA5]/5 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs pwa:hidden"
            >
              Later
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default NotificationPermissionPrompt;
