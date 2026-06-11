import React, { useState } from 'react';
import { Bell, X, Check } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';

/**
 * NotificationPermissionPrompt — Banner requesting browser notification permission.
 * Shows once per session (stored in component state).
 */
const NotificationPermissionPrompt = () => {
  const { isSupported, permission, requestPermissionAndRegister, error } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  // Don't show if:
  // - Browser doesn't support notifications
  // - User already granted/denied permission
  // - User dismissed the prompt this session
  if (!isSupported || permission !== 'default' || dismissed) {
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
    <div className="fixed bottom-4 right-4 z-50 w-[450px] animate-[slideUp_0.4s_ease-out]">
      <div className="bg-gradient-to-br from-[#4f46e5] via-[#7c3aed] to-[#ec4899] border-2 border-white rounded-xl shadow-2xl p-4 relative overflow-hidden">
        {/* Decorative blur background */}
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-white/10 rounded-full blur-3xl"></div>

        {/* Content wrapper */}
        <div className="relative z-10">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 bg-white/20 hover:bg-white/30 text-white p-1 rounded-lg transition-all"
            disabled={isRequesting}
          >
            <X size={16} />
          </button>

          {/* Icon and Header */}
          <div className="flex items-start gap-2 mb-2 pr-6">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center shrink-0 mt-0.5">
              <Bell size={18} className="text-white" />
            </div>
            <h3 className="text-base font-bold text-white">
              Get Instant Notifications
            </h3>
          </div>

          {/* Description */}
          <p className="text-white/90 text-xs leading-tight mb-3 font-medium ml-10">
            Enable browser notifications to receive instant alerts when new ads are found for your keywords.
          </p>

          {/* Error message */}
          {error && (
            <p className="text-xs text-yellow-200 mb-3 bg-red-500/20 px-2 py-1 rounded">
              ⚠️ {error}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 w-full">
            <button
              onClick={handleEnable}
              disabled={isRequesting}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-white text-[#7c3aed] hover:bg-white/95 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold text-xs transition-all shadow-lg"
            >
              {isRequesting ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
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
              className="flex-1 px-3 py-2 bg-white/20 text-white font-bold hover:bg-white/30 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs"
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
