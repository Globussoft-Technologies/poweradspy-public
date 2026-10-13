'use strict';

/**
 * POST /api/v1/imageGen/recreate/enhance — rewrites the Recreate modal's draft
 * prompt into a fuller one via promptEnhancer.js (real Claude call). Does not
 * touch credits — this is a free text-rewrite, not a generation.
 */

const NodeCache = require('node-cache');
const { enhancePrompt } = require('../helpers/promptEnhancer');
const { ok, rejected, serverError } = require('../helpers/responses');

// Per-user cooldown so a double-click/double-tap doesn't fire two paid upstream
// calls back to back — mirrors statusCache.js's "node-cache, not Redis" posture.
const cooldown = new NodeCache({ stdTTL: 3, checkperiod: 10, useClones: false });

async function enhance(req, res) {
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(422).json(rejected(422, 'A prompt is required to enhance.'));

  const cooldownKey = `enh_${userId}`;
  if (cooldown.get(cooldownKey)) {
    return res.status(429).json(rejected(429, 'Please wait a moment before enhancing again.'));
  }
  cooldown.set(cooldownKey, true);

  const result = await enhancePrompt(prompt);
  if (!result.ok) {
    if (result.reason === 'not_configured') {
      return res.status(503).json(serverError(503, 'Prompt enhancement is not configured on this server.'));
    }
    return res.status(502).json(serverError(502, 'Could not enhance this prompt right now. Please try again.'));
  }

  return res.json(ok('Enhanced.', { enhanced_prompt: result.enhancedPrompt }));
}

module.exports = { enhance };
