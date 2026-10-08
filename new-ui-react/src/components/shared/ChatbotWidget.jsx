import { useEffect } from 'react';
import { isInstalledMobileNow } from '../../hooks/useInstalledMobile';

const CHAT_TOKEN = import.meta.env.VITE_FRESH_CHAT_TOKEN;
const CHAT_HOST_URL = import.meta.env.VITE_FRESH_CHAT_HOST_URL;
const CHAT_UUID = import.meta.env.VITE_FRESH_CHAT_WIDGET_UUID;

const ChatbotWidget = () => {
  const initFreshChat = () => {
    // Installed phone app: the floating launcher covered sheet buttons and
    // cards, so it's hidden there and chat opens from BottomNav's "More" menu
    // (window.fcWidget.open()).
    const hideLauncher = isInstalledMobileNow();
    window?.fcWidget?.init({
      token: CHAT_TOKEN,
      host: CHAT_HOST_URL,
      widgetUuid: CHAT_UUID,
      ...(hideLauncher ? { config: { headerProperty: { hideChatButton: true } } } : {}),
    });
  };

  const loadFreshChatScript = () => {
    if (document.getElementById('Freshchat-js-sdk')) {
      initFreshChat();
    } else {
      const script = document.createElement('script');
      script.id = 'Freshchat-js-sdk';
      script.src = 'https://socioboard.freshchat.com/js/widget.js';
      script.async = true;
      script.onload = initFreshChat;
      document.head.appendChild(script);
    }
  };

  useEffect(() => {
    loadFreshChatScript();

    // Cleanup: destroy widget on unmount
    return () => {
      if (window?.fcWidget?.destroy) {
        try { window.fcWidget.destroy(); } catch (e) { /* ignore */ }
      }
    };
  }, []);

  // Freshchat SDK automatically injects the fc_frame div with fc_widget iframe
  // and handles its own button, positioning (bottom-right), and chat functionality.
  return null;
};

export default ChatbotWidget;
