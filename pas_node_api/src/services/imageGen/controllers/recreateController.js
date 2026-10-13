'use strict';

/**
 * POST /api/v1/imageGen/recreate — screens 3a/3b -> 3c (Generating) immediately.
 */

const repo = require('../repository');
const { validateRecreateRequest } = require('../validate');
const { resolveAdCreative } = require('../helpers/adResolver');
const adStudio = require('../helpers/adStudioClient');
const creditsLedger = require('../helpers/creditsLedger');
const imageGenConfig = require('../config');
const { accepted, rejected, noCredits, serverError } = require('../helpers/responses');

async function recreate(req, res) {
  const db = req.imageGenDb; // injected by the route (Mongo Db handle)
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const errors = validateRecreateRequest(req.body);
  if (errors.length) {
    return res.status(422).json(rejected(422, errors[0], { errors }));
  }

  const {
    network, ad_id, aspect_ratio, prompt, watermark, product_image_url,
    product_image, extra_image_urls, brand_website, source_advertiser, source_running_days,
    source_image_url,
  } = req.body;

  const resolved = await resolveAdCreative(network, ad_id, { preferredImageUrl: source_image_url });
  if (!resolved.ok) {
    return res.status(422).json(rejected(422, `Could not load this ad's creative: ${resolved.reason}.`, { field: 'ad_id' }));
  }

  const cost = imageGenConfig.creditCostPerGeneration;
  const reservation = await creditsLedger.reserve(db, userId, cost);
  if (!reservation.ok) {
    return res.status(402).json(noCredits('Not enough credits to generate this image.', { balance: reservation.balance, cost }));
  }

  // Reference ad first (style/layout), product image + any extra reference images
  // next (what to actually put in the generated creative) — Ad Studio's image_urls
  // accepts multiple images per request (adStudioClient.js), used here for real.
  const imageUrls = [resolved.imageUrl, product_image_url, ...(Array.isArray(extra_image_urls) ? extra_image_urls : [])]
    .filter(Boolean);

  let finalPrompt = prompt.trim();
  if (brand_website) finalPrompt += ` Brand website for reference: ${brand_website}.`;

  const upstream = await adStudio.generateImage({
    prompt: finalPrompt,
    imageUrls,
    aspectRatio: aspect_ratio,
    model: imageGenConfig.defaultModel || undefined,
    userId: String(userId),
    watermark: watermark !== undefined ? watermark : imageGenConfig.watermarkDefault,
  });

  if (!upstream.ok) {
    // Submission itself failed — refund immediately, nothing was ever queued upstream.
    await creditsLedger.refund(db, { userId, jobId: null, cost, bucket: reservation.bucket });
    return res.status(502).json(serverError(502, 'The image generation service could not accept this request right now. Please try again.'));
  }

  const job = await repo.insertJob(db, {
    user_id: userId,
    source: {
      network,
      ad_id: String(ad_id),
      image_url: resolved.imageUrl,
      // Display-only metadata. The paid upstream request still uses the creative
      // URL resolved server-side above; these client values are never trusted for it.
      advertiser: (resolved.advertiser || (typeof source_advertiser === 'string' ? source_advertiser : '')).slice(0, 200) || null,
      running_days: Number.isFinite(Number(resolved.runningDays ?? source_running_days)) ? Number(resolved.runningDays ?? source_running_days) : null,
    },
    request: {
      prompt: finalPrompt,
      aspect_ratio,
      model: imageGenConfig.defaultModel || null,
      watermark: watermark !== undefined ? watermark : imageGenConfig.watermarkDefault,
      product_image_url: product_image_url || null,
      product_image: product_image && typeof product_image === 'object' ? {
        name: typeof product_image.name === 'string' ? product_image.name.slice(0, 255) : null,
        size_bytes: Number.isFinite(Number(product_image.size_bytes)) ? Number(product_image.size_bytes) : null,
        width: Number.isFinite(Number(product_image.width)) ? Number(product_image.width) : null,
        height: Number.isFinite(Number(product_image.height)) ? Number(product_image.height) : null,
      } : null,
      extra_image_urls: Array.isArray(extra_image_urls) ? extra_image_urls : [],
      brand_website: brand_website || null,
    },
    upstream: { job_id: upstream.jobId, status: upstream.status, submitted_at: new Date(), last_polled_at: null },
    status: upstream.status === 'running' ? 'running' : 'queued',
    result: null,
    error: null,
    credit: { cost, bucket: reservation.bucket, reserved_at: new Date(), finalized_at: null, refunded: false },
  });

  await creditsLedger.logReserve(db, { userId, jobId: job._id, cost, balanceAfter: reservation.balance });

  return res.status(202).json(accepted('Generation started.', { job_id: String(job._id), status: job.status, balance: reservation.balance }));
}

module.exports = { recreate };
