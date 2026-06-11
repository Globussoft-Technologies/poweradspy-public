'use strict';

const https = require('https');
const config = require('../config');
const logger = require('../logger').createChild('telegram');

/**
 * Sends a message via Telegram Bot API using native HTTPS (no extra packages required).
 * @param {string} message - The text to send
 */
function sendTelegramAlert(message) {
  if (config.isDev) {
    // console.log('Telegram alert skipped — development mode');
    return;
  }

  if (!config.admin || !config.admin.telegramBotToken || !config.admin.telegramChatId) {
    logger.warn('Telegram alert skipped — missing config', {
      hasAdmin: !!config.admin,
      hasBotToken: !!(config.admin && config.admin.telegramBotToken),
      hasChatId: !!(config.admin && config.admin.telegramChatId),
    });
    return;
  }

  const { telegramBotToken, telegramChatId } = config.admin;
  
  const payload = JSON.stringify({
    chat_id: telegramChatId,
    text: message,
    parse_mode: 'HTML',
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${telegramBotToken}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 5000,
  };

  const req = https.request(options, (res) => {
    res.on('data', () => {}); // Consume data to free memory
    if (res.statusCode !== 200) {
      logger.warn(`Telegram API error: status ${res.statusCode}`);
    }
  });

  req.on('error', (err) => {
    logger.error(`Failed to send Telegram alert: ${err.message}`);
  });

  req.on('timeout', () => {
    req.destroy();
    logger.warn('Telegram request timed out');
  });

  req.write(payload);
  req.end();
}

module.exports = {
  sendTelegramAlert,
};
