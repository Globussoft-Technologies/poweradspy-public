'use strict';

/**
 * GET /api/v1/imageGen/jobs/:id/download?format=png|jpeg|webp|svg
 *
 * Streams one of the user's own generated images back as a file
 * (Content-Disposition: attachment), converted with sharp:
 *   png  — lossless
 *   jpeg — flattened on white (JPEG has no transparency), quality 92
 *   webp — quality 92
 *   svg  — an SVG document that embeds the PNG at its native size. The image is
 *          raster; SVG is a wrapper for design tools that want an .svg file,
 *          not a vectorisation.
 */

const axios = require('axios');
const sharp = require('sharp');
const repo = require('../repository');
const logger = require('../../../logger');
const { rejected, serverError } = require('../helpers/responses');

const log = logger.createChild('imagegen-download');

const FORMATS = {
  png: { ext: 'png', type: 'image/png' },
  jpeg: { ext: 'jpg', type: 'image/jpeg' },
  webp: { ext: 'webp', type: 'image/webp' },
  svg: { ext: 'svg', type: 'image/svg+xml' },
};
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

function imageUrlOf(job) {
  const image = job?.result?.images?.[0];
  return typeof image === 'string' ? image : image?.url || null;
}

function fileBase(job) {
  const name = String(job.source?.advertiser || job.source?.network || 'image')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'image';
  return `recreate-${name}-${job.job_id || job._id}`;
}

async function convert(source, format) {
  const img = sharp(source, { failOn: 'none' }).rotate();
  if (format === 'png') return img.png().toBuffer();
  if (format === 'jpeg') return img.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  if (format === 'webp') return img.webp({ quality: 92 }).toBuffer();
  // svg
  const { data, info } = await img.png().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<image width="${width}" height="${height}" xlink:href="data:image/png;base64,${data.toString('base64')}"/></svg>`,
    'utf8',
  );
}

async function downloadImage(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const format = String(req.query.format || 'png').toLowerCase().replace(/^jpg$/, 'jpeg');
  const spec = FORMATS[format];
  if (!spec) return res.status(400).json(rejected(400, 'Unsupported format. Use png, jpeg, webp or svg.'));

  const job = await repo.getJobById(db, req.params.id, userId);
  if (!job) return res.status(404).json(rejected(404, 'Image not found.'));
  const url = job.status === 'succeeded' ? imageUrlOf(job) : null;
  if (!url) return res.status(404).json(rejected(404, 'This image has no downloadable result.'));

  try {
    const source = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_SOURCE_BYTES, maxBodyLength: MAX_SOURCE_BYTES,
    });
    const body = await convert(Buffer.from(source.data), format);
    res.set({
      'Content-Type': spec.type,
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="${fileBase(job)}.${spec.ext}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(body);
  } catch (err) {
    log.error('Image download/convert failed', { jobId: req.params.id, format, error: err.message });
    return res.status(502).json(serverError(502, 'Could not prepare this download right now.', { error: err.message }));
  }
}

module.exports = { downloadImage, FORMATS };
