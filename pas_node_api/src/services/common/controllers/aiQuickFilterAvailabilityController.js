'use strict';

const { searchAllNetworks } = require('./commonSearchController');
const logger = require('../../../logger').createChild('ai-quick-filter-availability');

function createCaptureResponse() {
  let statusCode = 200;
  let payload = null;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return data;
    },
    send(data) {
      payload = data;
      return data;
    },
    getPayload() {
      return payload;
    },
    getStatusCode() {
      return statusCode;
    },
  };
}

function normalizePresetList(rawPresets) {
  if (!Array.isArray(rawPresets)) return [];

  return rawPresets
    .map((preset) => {
      if (!preset || typeof preset !== 'object') return null;
      const id = typeof preset.id === 'string' ? preset.id.trim() : '';
      const payload = preset.payload && typeof preset.payload === 'object' && !Array.isArray(preset.payload)
        ? preset.payload
        : null;
      const filters = preset.filters && typeof preset.filters === 'object' && !Array.isArray(preset.filters)
        ? preset.filters
        : null;
      if (!id || (!payload && !filters)) return null;
      return { id, payload, filters };
    })
    .filter(Boolean);
}

async function probePresetAvailability(req, preset) {
  const incomingBody = req.body || {};
  const presetPayload = preset.payload && typeof preset.payload === 'object'
    ? preset.payload
    : {};

  // Keep the authenticated user context intact so the probe behaves like the
  // real search request. Preset payloads are generated client-side and may not
  // carry auth-only fields such as `user_id`.
  // `presets` belongs to the batch endpoint only. Do not forward the complete
  // batch back into the normal search pipeline for every individual probe.
  const { presets: _presets, ...searchContext } = incomingBody;
  const body = {
    ...searchContext,
    ...presetPayload,
    ...(preset.filters || {}),
    user_id: incomingBody.user_id ?? req.user?.user_id ?? req.user?.id ?? presetPayload.user_id,
    take: 1,
    page_size: 1,
    skip: 0,
  };

  if (!body.network && incomingBody.network) {
    body.network = incomingBody.network;
  }

  // Express request properties are not all own enumerable properties. A spread
  // clone turns it into a plain object and can lose middleware context that the
  // regular search path relies on. Keep the original request as the prototype
  // and override only the request data specific to this availability probe.
  const probeReq = Object.create(req);
  probeReq.query = {};
  probeReq.body = body;

  const captureRes = createCaptureResponse();
  await searchAllNetworks(probeReq, captureRes);

  const payload = captureRes.getPayload() || {};
  const data = Array.isArray(payload.data) ? payload.data : [];
  const metaTotal = payload.meta && typeof payload.meta === 'object'
    ? payload.meta.total
    : null;

  return {
    id: preset.id,
    hasAds: data.length > 0 || (typeof metaTotal === 'number' && metaTotal > 0),
  };
}

async function getAiQuickFilterAvailability(req, res) {
  const rawBody = req.body || {};
  const presets = normalizePresetList(rawBody.presets);

  if (presets.length === 0) {
    return res.status(400).json({
      code: 400,
      message: 'presets must contain at least one valid quick-filter definition',
      availability: {},
      visiblePresetIds: [],
    });
  }

  const results = await Promise.all(
    presets.map(async (preset) => {
      try {
        return await probePresetAvailability(req, preset);
      } catch (error) {
        // Fail closed: a preset is only safe to show after the live search path
        // confirms it can surface an ad. Keep the error in server logs rather
        // than returning internal details to the browser.
        logger.warn('AI quick-filter availability probe failed', {
          presetId: preset.id,
          error: error?.message || String(error),
        });
        return { id: preset.id, hasAds: false };
      }
    }),
  );

  const availability = {};
  const visiblePresetIds = [];
  for (const result of results) {
    const { id, hasAds } = result || {};
    if (!id) continue;
    availability[id] = !!hasAds;
    if (hasAds) visiblePresetIds.push(id);
  }

  return res.status(200).json({
    code: 200,
    message: 'AI quick filter availability fetched successfully',
    availability,
    visiblePresetIds,
    totalPresets: presets.length,
  });
}

module.exports = { getAiQuickFilterAvailability };
