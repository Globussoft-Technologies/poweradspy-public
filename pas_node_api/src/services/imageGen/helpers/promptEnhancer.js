'use strict';

/**
 * "Enhance" (POST /recreate/enhance) — rewrites the user's short draft prompt
 * into a fuller, more specific AI-image-generation prompt via a real Claude call
 * (Anthropic Messages API, called directly over axios — same pattern as every
 * other external-API client in this codebase, e.g. adStudioClient.js — no SDK
 * dependency needed for one call shape).
 *
 * Config-gated (config/index.js's imageGen.promptEnhancer): without an API key
 * this returns {ok:false, reason:'not_configured'} and the controller 503s —
 * it never fabricates a "rewritten" prompt locally under an AI label.
 */

const axios = require('axios');
const imageGenConfig = require('../config');

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = [
  'You are an expert prompt writer for an AI ad-creative image generator.',
  "Rewrite the user's short draft instruction into a single vivid, specific, well-structured prompt (2-4 sentences).",
  'Preserve their intent and any explicit details (colors, tone, text/headline requests, products mentioned).',
  'Return ONLY the rewritten prompt text — no preamble, no quotes, no markdown, no explanation.',
].join(' ');

/**
 * @param {string} draftPrompt
 * @returns {Promise<{ok:true, enhancedPrompt:string} | {ok:false, reason:string, status?:number, error?:string}>}
 */
async function enhancePrompt(draftPrompt) {
  const cfg = imageGenConfig.promptEnhancer;
  if (!cfg.enabled || !cfg.apiKey) {
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const res = await axios.post(
      ANTHROPIC_MESSAGES_URL,
      {
        model: cfg.model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: draftPrompt }],
      },
      {
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        timeout: cfg.timeoutMs,
        validateStatus: () => true,
      },
    );

    const text = res.data?.content?.find((block) => block?.type === 'text')?.text;
    if (res.status !== 200 || !text) {
      return { ok: false, reason: 'upstream_error', status: res.status };
    }
    return { ok: true, enhancedPrompt: text.trim() };
  } catch (err) {
    return { ok: false, reason: 'request_failed', error: err.message };
  }
}

module.exports = { enhancePrompt };
