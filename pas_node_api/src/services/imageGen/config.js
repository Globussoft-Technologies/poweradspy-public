'use strict';

/**
 * AI Recreate + MySpace (image generation) feature config.
 *
 * The actual config.json-wins/env-fallback resolution happens in src/config/index.js
 * (the `imageGen` section there), matching CONFIG_RULES.md's rule that only that
 * module reads config.json directly — this file is just this service's single,
 * consistent import point for it.
 */

module.exports = require('../../config').imageGen;
